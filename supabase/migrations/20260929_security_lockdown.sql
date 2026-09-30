-- Security hardening for RCmusic_eventos public data.
-- Direct reads are limited to attendees who joined by event code; private payment proofs
-- and demo history are accessible only to verified SECURITY DEFINER RPCs.

-- Sensitive tables must never be exposed through direct anon/authenticated REST access.
do $$
begin
  if to_regclass('public.dj_demo_history') is not null then
    execute 'alter table public.dj_demo_history enable row level security';
    execute 'revoke all privileges on table public.dj_demo_history from public, anon, authenticated';
  end if;
  if to_regclass('public.subscription_payment_proofs') is not null then
    execute 'alter table public.subscription_payment_proofs enable row level security';
    execute 'revoke all privileges on table public.subscription_payment_proofs from public, anon, authenticated';
  end if;
  if to_regclass('public.subscription_settings') is not null then
    execute 'alter table public.subscription_settings enable row level security';
    execute 'revoke all privileges on table public.subscription_settings from public, anon, authenticated';
  end if;
  if to_regclass('public.request_likes') is not null then
    execute 'alter table public.request_likes enable row level security';
    execute 'revoke all privileges on table public.request_likes from public, anon, authenticated';
  end if;
end
$$;

-- Attendee membership is created only after the event code has been checked by an RPC.
create table if not exists public.attendee_event_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.attendee_event_access enable row level security;
revoke all privileges on table public.attendee_event_access from public, anon, authenticated;
grant select on table public.attendee_event_access to authenticated;
drop policy if exists attendee_can_read_own_event_access on public.attendee_event_access;
create policy attendee_can_read_own_event_access on public.attendee_event_access
  for select to authenticated using (user_id = auth.uid());

-- Small per-anonymous-account throttle for invalid event-code guesses.
create table if not exists public.attendee_event_join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.attendee_event_join_attempts enable row level security;
revoke all privileges on table public.attendee_event_join_attempts from public, anon, authenticated;

create or replace function public.attendee_join_event(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_failed integer;
  v_window timestamptz;
  v_locked timestamptz;
begin
  if v_user_id is null then raise exception 'Anonymous session required'; end if;

  select failed_attempts, window_started_at, locked_until
    into v_failed, v_window, v_locked
    from public.attendee_event_join_attempts where user_id = v_user_id for update;
  if v_locked is not null and v_locked > now() then return null; end if;

  select e.id into v_event_id
    from public.events e
    where upper(trim(coalesce(e.code, e.access_code, ''))) = upper(trim(coalesce(p_code, '')))
      and coalesce(e.is_live, true)
      and e.finalized_at is null
    limit 1;

  if v_event_id is null then
    if v_window is null or v_window < now() - interval '10 minutes' then
      insert into public.attendee_event_join_attempts(user_id, failed_attempts, window_started_at, locked_until)
      values (v_user_id, 1, now(), null)
      on conflict (user_id) do update set failed_attempts = 1, window_started_at = now(), locked_until = null;
    else
      v_failed := coalesce(v_failed, 0) + 1;
      update public.attendee_event_join_attempts
        set failed_attempts = v_failed,
            locked_until = case when v_failed >= 8 then now() + interval '10 minutes' else null end
        where user_id = v_user_id;
    end if;
    return null;
  end if;

  delete from public.attendee_event_join_attempts where user_id = v_user_id;
  insert into public.attendee_event_access(user_id, event_id, joined_at)
    values (v_user_id, v_event_id, now())
    on conflict (user_id, event_id) do update set joined_at = excluded.joined_at;
  return v_event_id;
end;
$$;
revoke all on function public.attendee_join_event(text) from public, anon;
grant execute on function public.attendee_join_event(text) to authenticated;

-- Remove broad public policies. Attendees may only read the event they joined.
drop policy if exists "public can read events" on public.events;
drop policy if exists "public read live events" on public.events;
drop policy if exists attendees_read_joined_events on public.events;
create policy attendees_read_joined_events on public.events
  for select to authenticated using (
    exists (select 1 from public.attendee_event_access a
      where a.event_id = events.id and a.user_id = auth.uid())
  );

-- Column privileges prevent exposing internal owner IDs and payment-proof images.
revoke all privileges on table public.events from public, anon, authenticated;
grant select (id, code, name, dj_name, contact, yape_number, thank_you,
              qr_image_url, tips_required, finalized_at, tip_currency, tip_amount,
              created_at, is_live)
  on table public.events to authenticated;

-- Public request creation must go through the token-validating RPC, not direct REST.
drop policy if exists "public can read requests" on public.song_requests;
drop policy if exists "public read event requests" on public.song_requests;
drop policy if exists "public create requests" on public.song_requests;
drop policy if exists "signed in users can request" on public.song_requests;
drop policy if exists attendees_read_joined_requests on public.song_requests;
create policy attendees_read_joined_requests on public.song_requests
  for select to authenticated using (
    exists (select 1 from public.attendee_event_access a
      where a.event_id = song_requests.event_id and a.user_id = auth.uid())
  );
revoke all privileges on table public.song_requests from public, anon, authenticated;
grant select (id, event_id, video_id, title, artist, thumbnail, requester, dedication, likes, status, created_at)
  on table public.song_requests to authenticated;

-- Likes are written through like_request(), never directly through REST.
alter table public.request_likes enable row level security;
revoke all privileges on table public.request_likes from public, anon, authenticated;

-- RPCs continue to handle writes, but only for an attendee who joined that event.
drop function if exists public.submit_song_request(uuid,text,text,text,text,text,text,text);
create function public.submit_song_request(
  p_event_id uuid, p_video_id text, p_title text, p_artist text, p_thumbnail text,
  p_requester text, p_dedication text, p_payment_proof text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  event_row public.events;
  inserted_request public.song_requests;
begin
  if auth.uid() is null or not exists (
    select 1 from public.attendee_event_access a
    where a.user_id = auth.uid() and a.event_id = p_event_id
  ) then raise exception 'Event access denied'; end if;
  select * into event_row from public.events where id = p_event_id and coalesce(is_live, true);
  if event_row.id is null then raise exception 'Event not found'; end if;
  if event_row.finalized_at is not null then raise exception 'Event finalized'; end if;
  if coalesce(event_row.tips_required, false) and nullif(trim(coalesce(p_payment_proof, '')), '') is null then
    raise exception 'Payment proof required';
  end if;
  if char_length(coalesce(p_title, '')) = 0 or char_length(p_title) > 200 then raise exception 'Invalid song title'; end if;
  if char_length(coalesce(p_artist, '')) = 0 or char_length(p_artist) > 200 then raise exception 'Invalid artist'; end if;
  insert into public.song_requests(event_id, video_id, title, artist, thumbnail, requester, dedication, payment_proof)
    values (p_event_id, trim(p_video_id), trim(p_title), trim(p_artist), trim(coalesce(p_thumbnail, '')),
      left(coalesce(nullif(trim(p_requester), ''), 'Anónimo'), 60), nullif(left(trim(coalesce(p_dedication, '')), 150), ''),
      nullif(left(trim(coalesce(p_payment_proof, '')), 1200000), ''))
    returning * into inserted_request;
  return jsonb_build_object(
    'id', inserted_request.id,
    'event_id', inserted_request.event_id,
    'video_id', inserted_request.video_id,
    'title', inserted_request.title,
    'artist', inserted_request.artist,
    'thumbnail', inserted_request.thumbnail,
    'requester', inserted_request.requester,
    'dedication', inserted_request.dedication,
    'likes', inserted_request.likes,
    'status', inserted_request.status,
    'created_at', inserted_request.created_at
  );
end;
$$;
revoke all on function public.submit_song_request(uuid,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_song_request(uuid,text,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.like_request(request_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select event_id into v_event_id from public.song_requests where id = request_uuid;
  if v_event_id is null or not exists (
    select 1 from public.attendee_event_access a
    where a.user_id = auth.uid() and a.event_id = v_event_id
  ) then raise exception 'Event access denied'; end if;
  insert into public.request_likes(request_id, voter_id) values (request_uuid, auth.uid()) on conflict do nothing;
  if found then update public.song_requests set likes = coalesce(likes, 0) + 1 where id = request_uuid; end if;
end;
$$;
revoke all on function public.like_request(uuid) from public;
grant execute on function public.like_request(uuid) to anon, authenticated;

-- Keep event/request Realtime, but let RLS and column grants limit the payload.
alter table public.events replica identity full;
alter table public.song_requests replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.song_requests;
exception when duplicate_object or undefined_object then null;
end $$;
