-- Global developer control for song previews. Default behavior remains enabled.
create table if not exists public.app_feature_settings (
  id integer primary key check (id = 1),
  song_preview_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.app_feature_settings
  add column if not exists song_preview_enabled boolean not null default true;
alter table public.app_feature_settings
  add column if not exists updated_at timestamptz not null default now();

insert into public.app_feature_settings (id, song_preview_enabled)
values (1, true)
on conflict (id) do nothing;

alter table public.app_feature_settings enable row level security;
revoke all on table public.app_feature_settings from public, anon, authenticated;
grant select on table public.app_feature_settings to anon, authenticated;
drop policy if exists app_feature_settings_public_read on public.app_feature_settings;
create policy app_feature_settings_public_read
  on public.app_feature_settings
  for select
  to anon, authenticated
  using (id = 1);

create or replace function public.get_song_preview_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select s.song_preview_enabled from public.app_feature_settings s where s.id = 1),
    true
  );
$$;
revoke all on function public.get_song_preview_enabled() from public;
grant execute on function public.get_song_preview_enabled() to anon, authenticated;

create or replace function public.admin_set_song_preview_enabled(p_token text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.dj_accounts%rowtype;
  v_saved boolean;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  v_actor := public._dj_access(p_token);
  if v_actor.id is null
     or v_actor.role is distinct from 'admin'
     or lower(coalesce(v_actor.email, '')) <> 'djgianfrancoromerodechosica@gmail.com' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  insert into public.app_feature_settings (id, song_preview_enabled, updated_at)
  values (1, coalesce(p_enabled, true), now())
  on conflict (id) do update
    set song_preview_enabled = excluded.song_preview_enabled,
        updated_at = now()
  returning song_preview_enabled into v_saved;

  return v_saved;
end;
$$;
revoke all on function public.admin_set_song_preview_enabled(text, boolean) from public;
grant execute on function public.admin_set_song_preview_enabled(text, boolean) to anon, authenticated;

-- Keep realtime in sync for all connected attendee and DJ clients.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_feature_settings'
  ) then
    alter publication supabase_realtime add table public.app_feature_settings;
  end if;
end;
$$;
