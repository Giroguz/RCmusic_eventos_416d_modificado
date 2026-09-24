-- PACK TODOS LOS GÉNEROS — canonical isolated Supabase bootstrap.
-- Mirrors the schema applied to project uwvhpodseawpsqunplld.
-- Apply ONLY to the independent PACK TODOS LOS GÉNEROS project, never RCmusic_eventos.

-- PACK TODOS LOS GÉNEROS: minimal, isolated Supabase schema for the DJ library PWA.
-- The admin starts with an unknown random code and must set a new code through verified email recovery.
create extension if not exists pgcrypto;

create table if not exists public.dj_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email))),
  display_name text not null default 'DJ',
  role text not null default 'dj' check (role in ('dj','admin')),
  access_code_hash text,
  access_code_display text,
  demo_code text,
  demo_used_at timestamptz,
  approved boolean not null default false,
  blocked boolean not null default false,
  plan_type text not null default 'none' check (plan_type in ('none','fifteen','monthly','annual','admin','trial')),
  plan_started_at timestamptz,
  plan_expires_at timestamptz,
  plan_paused_at timestamptz,
  plan_paused_remaining_seconds bigint not null default 0,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.dj_sessions (
  token_hash text primary key,
  dj_id uuid not null references public.dj_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);
create index if not exists dj_sessions_expiry_idx on public.dj_sessions(expires_at);

create table if not exists public.subscription_settings (
  id boolean primary key default true check (id = true),
  demo_days integer not null default 1 check (demo_days between 1 and 3650),
  fifteen_days integer not null default 15,
  monthly_days integer not null default 30,
  annual_days integer not null default 365,
  fifteen_price numeric(10,2) not null default 25,
  monthly_price numeric(10,2) not null default 35,
  annual_price numeric(10,2) not null default 340,
  fifteen_price_usd numeric(10,2) not null default 0,
  monthly_price_usd numeric(10,2) not null default 0,
  annual_price_usd numeric(10,2) not null default 0,
  yape_qr text,
  yape_number text,
  updated_at timestamptz not null default now()
);
insert into public.subscription_settings(id) values (true) on conflict (id) do nothing;

create table if not exists public.subscription_payment_proofs (
  id uuid primary key default gen_random_uuid(),
  dj_id uuid not null references public.dj_accounts(id) on delete cascade,
  plan_type text not null check (plan_type in ('fifteen','monthly','annual')),
  proof_image text not null check (char_length(proof_image) <= 1500000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.dj_accounts(id),
  reviewer_notes text
);
create index if not exists subscription_payment_proofs_status_idx on public.subscription_payment_proofs(status, submitted_at desc);
create index if not exists subscription_payment_proofs_dj_idx on public.subscription_payment_proofs(dj_id, submitted_at desc);

alter table public.dj_accounts enable row level security;
alter table public.dj_sessions enable row level security;
alter table public.subscription_settings enable row level security;
alter table public.subscription_payment_proofs enable row level security;
revoke all on public.dj_accounts, public.dj_sessions, public.subscription_settings, public.subscription_payment_proofs from anon, authenticated;

insert into public.dj_accounts(email,display_name,role,access_code_hash,approved,plan_type)
values ('djgian7785@gmail.com','PACK DJ Administrator','admin',encode(digest(gen_random_uuid()::text,'sha256'),'hex'),true,'admin')
on conflict (email) do update set role='admin',approved=true,plan_type='admin';

create or replace function public._dj_access(p_token text)
returns setof public.dj_accounts
language sql stable security definer set search_path=public,extensions as $$
  select d.* from public.dj_accounts d
  join public.dj_sessions s on s.dj_id=d.id
  where s.token_hash=encode(digest(p_token,'sha256'),'hex')
    and s.expires_at>now() and d.approved and not d.blocked
    and (d.role='admin' or (d.plan_expires_at is not null and d.plan_expires_at>now()))
  limit 1
$$;
revoke all on function public._dj_access(text) from public,anon,authenticated;

create or replace function public.dj_login(p_email text,p_code text)
returns table(session_token text,dj_id uuid,email text,display_name text,role text,plan_type text,plan_started_at timestamptz,plan_expires_at timestamptz,days_used integer,days_remaining integer,is_active boolean)
language plpgsql security definer set search_path=public,extensions as $$
declare d public.dj_accounts; raw_token text; used integer:=0; remaining integer:=0;
begin
  select * into d from public.dj_accounts where email=lower(trim(p_email)) limit 1;
  if d.id is null or d.access_code_hash is null or d.access_code_hash<>encode(digest(trim(p_code),'sha256'),'hex') or not d.approved or d.blocked then raise exception 'Invalid DJ credentials'; end if;
  raw_token:=encode(gen_random_bytes(32),'hex');
  insert into public.dj_sessions(token_hash,dj_id) values(encode(digest(raw_token,'sha256'),'hex'),d.id);
  update public.dj_accounts set last_login_at=now() where id=d.id;
  if d.role<>'admin' then
    used:=greatest(0,floor(extract(epoch from least(now(),d.plan_expires_at)-d.plan_started_at)/86400)::integer);
    remaining:=greatest(0,floor(extract(epoch from d.plan_expires_at-now())/86400)::integer);
  end if;
  return query select raw_token,d.id,d.email,d.display_name,d.role,d.plan_type,d.plan_started_at,d.plan_expires_at,used,remaining,true;
end $$;
grant execute on function public.dj_login(text,text) to anon,authenticated;

create or replace function public.dj_check_access(p_token text)
returns table(dj_id uuid,email text,display_name text,role text,plan_type text,plan_started_at timestamptz,plan_expires_at timestamptz,days_used integer,days_remaining integer,is_active boolean)
language sql security definer set search_path=public,extensions as $$
  select d.id,d.email,d.display_name,d.role,d.plan_type,d.plan_started_at,d.plan_expires_at,
    case when d.plan_started_at is null or d.plan_expires_at is null then 0 else greatest(0,floor(extract(epoch from least(now(),d.plan_expires_at)-d.plan_started_at)/86400)::integer) end,
    case when d.plan_expires_at is null then 0 else greatest(0,floor(extract(epoch from d.plan_expires_at-now())/86400)::integer) end,
    true from public._dj_access(p_token) d
$$;
grant execute on function public.dj_check_access(text) to anon,authenticated;

create or replace function public.dj_logout(p_token text)
returns void language sql security definer set search_path=public,extensions as $$
  delete from public.dj_sessions where token_hash=encode(digest(p_token,'sha256'),'hex')
$$;
grant execute on function public.dj_logout(text) to anon,authenticated;

create or replace function public.dj_start_trial(p_email text,p_display_name text)
returns table(email text,display_name text,generated_code text,plan_expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare normalized_email text; verified_email text; confirmed_at timestamptz; a public.dj_accounts; code text; duration integer;
begin
  normalized_email:=lower(trim(p_email));
  if normalized_email='' or position('@' in normalized_email)<2 or auth.uid() is null then raise exception 'Email verification required'; end if;
  select lower(u.email),u.email_confirmed_at into verified_email,confirmed_at from auth.users u where u.id=auth.uid();
  if verified_email is null or verified_email<>normalized_email or confirmed_at is null then raise exception 'Email verification required'; end if;
  duration:=coalesce((select demo_days from public.subscription_settings where id=true),1);
  select * into a from public.dj_accounts where email=normalized_email limit 1;
  if a.id is not null then
    if a.role='admin' then raise exception 'Demo unavailable for admin'; end if;
    if a.plan_type='trial' and a.demo_code is not null and a.plan_expires_at>now() then return query select a.email,a.display_name,a.demo_code,a.plan_expires_at; return; end if;
    if a.demo_used_at is not null then raise exception 'Demo already used'; end if;
    if a.plan_type in ('fifteen','monthly','annual') and a.plan_expires_at>now() then raise exception 'Active plan already exists'; end if;
    code:=upper(substr(encode(gen_random_bytes(8),'hex'),1,10));
    update public.dj_accounts set display_name=coalesce(nullif(trim(p_display_name),''),display_name,'DJ Demo'),access_code_hash=encode(digest(code,'sha256'),'hex'),access_code_display=code,demo_code=code,demo_used_at=now(),approved=true,blocked=false,plan_type='trial',plan_started_at=now(),plan_expires_at=now()+make_interval(days=>duration) where id=a.id returning * into a;
    return query select a.email,a.display_name,a.demo_code,a.plan_expires_at; return;
  end if;
  code:=upper(substr(encode(gen_random_bytes(8),'hex'),1,10));
  insert into public.dj_accounts(email,display_name,access_code_hash,access_code_display,demo_code,demo_used_at,approved,blocked,plan_type,plan_started_at,plan_expires_at)
    values(normalized_email,coalesce(nullif(trim(p_display_name),''),'DJ Demo'),encode(digest(code,'sha256'),'hex'),code,code,now(),true,false,'trial',now(),now()+make_interval(days=>duration)) returning * into a;
  return query select a.email,a.display_name,a.demo_code,a.plan_expires_at;
end $$;
grant execute on function public.dj_start_trial(text,text) to anon,authenticated;

create or replace function public.dj_set_admin_code(p_new_code text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare verified_email text; confirmed_at timestamptz;
begin
  if auth.uid() is null or char_length(trim(p_new_code))<8 then raise exception 'Verified email and an 8 character code are required'; end if;
  select lower(email),email_confirmed_at into verified_email,confirmed_at from auth.users where id=auth.uid();
  if verified_email<>'djgian7785@gmail.com' or confirmed_at is null then raise exception 'Verified administrator email required'; end if;
  update public.dj_accounts set access_code_hash=encode(digest(trim(p_new_code),'sha256'),'hex'),access_code_display=trim(p_new_code),approved=true,blocked=false,role='admin',plan_type='admin' where email='djgian7785@gmail.com' and role='admin';
  if not found then raise exception 'Administrator account not found'; end if;
  return true;
end $$;
revoke all on function public.dj_set_admin_code(text) from public,anon;
grant execute on function public.dj_set_admin_code(text) to authenticated;

create or replace function public.get_demo_days()
returns integer language sql stable security definer set search_path=public as $$ select coalesce((select demo_days from public.subscription_settings where id=true),1) $$;
grant execute on function public.get_demo_days() to anon,authenticated;

create or replace function public.get_subscription_plan_prices()
returns table(plan_type text,days integer,price_pen numeric)
language sql stable security definer set search_path=public as $$
  select * from (values
    ('fifteen',(select fifteen_days from public.subscription_settings where id=true),(select fifteen_price from public.subscription_settings where id=true)),
    ('monthly',(select monthly_days from public.subscription_settings where id=true),(select monthly_price from public.subscription_settings where id=true)),
    ('annual',(select annual_days from public.subscription_settings where id=true),(select annual_price from public.subscription_settings where id=true))
  ) as p(plan_type,days,price_pen)
$$;
grant execute on function public.get_subscription_plan_prices() to anon,authenticated;

create or replace function public.get_subscription_qr()
returns text language sql security definer set search_path=public as $$ select yape_qr from public.subscription_settings where id=true limit 1 $$;
grant execute on function public.get_subscription_qr() to anon,authenticated;
create or replace function public.get_subscription_yape_number()
returns text language sql security definer set search_path=public as $$ select yape_number from public.subscription_settings where id=true limit 1 $$;
grant execute on function public.get_subscription_yape_number() to anon,authenticated;

create or replace function public.submit_subscription_proof(p_token text,p_plan_type text,p_proof_image text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare d public.dj_accounts; proof_id uuid;
begin
  select a.* into d from public.dj_accounts a join public.dj_sessions s on s.dj_id=a.id where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and a.approved and not a.blocked and a.role='dj' limit 1;
  if d.id is null then raise exception 'DJ session required'; end if;
  if p_plan_type not in ('fifteen','monthly','annual') or p_proof_image is null or char_length(p_proof_image)>1500000 then raise exception 'Invalid plan proof'; end if;
  insert into public.subscription_payment_proofs(dj_id,plan_type,proof_image,status) values(d.id,p_plan_type,p_proof_image,'pending') returning id into proof_id;
  return proof_id;
end $$;
grant execute on function public.submit_subscription_proof(text,text,text) to anon,authenticated;

create or replace function public.admin_list_djs(p_token text)
returns table(id uuid,email text,display_name text,role text,approved boolean,blocked boolean,plan_type text,plan_started_at timestamptz,plan_expires_at timestamptz,days_used integer,days_remaining integer,is_active boolean,generated_code text,plan_paused_remaining_seconds bigint)
language plpgsql security definer set search_path=public,extensions as $$
declare a public.dj_accounts;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'')<>'admin' or a.email<>'djgian7785@gmail.com' then raise exception 'Admin only'; end if;
  return query select d.id,d.email,d.display_name,d.role,d.approved,d.blocked,d.plan_type,d.plan_started_at,d.plan_expires_at,
    case when d.plan_started_at is null or d.plan_expires_at is null then 0 else greatest(0,floor(extract(epoch from least(now(),d.plan_expires_at)-d.plan_started_at)/86400)::integer) end,
    case when d.blocked then greatest(0,floor(d.plan_paused_remaining_seconds/86400)::integer) when d.plan_expires_at is null then 0 else greatest(0,floor(extract(epoch from d.plan_expires_at-now())/86400)::integer) end,
    (d.approved and not d.blocked and (d.role='admin' or d.plan_expires_at>now())),coalesce(nullif(d.access_code_display,''),nullif(d.demo_code,'')),
    case when d.blocked then d.plan_paused_remaining_seconds else null end from public.dj_accounts d order by d.created_at desc;
end $$;
grant execute on function public.admin_list_djs(text) to anon,authenticated;

create or replace function public.admin_list_subscription_proofs(p_token text)
returns table(id uuid,dj_id uuid,plan_type text,proof_image text,status text,submitted_at timestamptz,reviewed_at timestamptz,reviewer_notes text)
language plpgsql security definer set search_path=public,extensions as $$
declare a public.dj_accounts;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'')<>'admin' or a.email<>'djgian7785@gmail.com' then raise exception 'Admin only'; end if;
  return query select p.id,p.dj_id,p.plan_type,p.proof_image,p.status,p.submitted_at,p.reviewed_at,p.reviewer_notes from public.subscription_payment_proofs p order by p.submitted_at desc;
end $$;
grant execute on function public.admin_list_subscription_proofs(text) to anon,authenticated;

create or replace function public.admin_review_subscription_proof(p_token text,p_proof_id uuid,p_status text,p_notes text default null)
returns table(id uuid,dj_id uuid,plan_type text,proof_image text,status text,submitted_at timestamptz,reviewed_at timestamptz,reviewer_notes text)
language plpgsql security definer set search_path=public,extensions as $$
declare a public.dj_accounts; p public.subscription_payment_proofs; duration integer;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'')<>'admin' or a.email<>'djgian7785@gmail.com' then raise exception 'Admin only'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Invalid review status'; end if;
  select * into p from public.subscription_payment_proofs where id=p_proof_id for update;
  if not found or p.status<>'pending' then raise exception 'Pending proof not found'; end if;
  update public.subscription_payment_proofs set status=p_status,reviewed_at=now(),reviewed_by=a.id,reviewer_notes=nullif(trim(p_notes),'') where id=p_proof_id returning * into p;
  if p_status='approved' then
    select case p.plan_type when 'fifteen' then fifteen_days when 'monthly' then monthly_days when 'annual' then annual_days else null end into duration from public.subscription_settings where id=true;
    update public.dj_accounts set approved=true,blocked=false,plan_type=p.plan_type,plan_started_at=now(),plan_expires_at=now()+make_interval(days=>duration),plan_paused_at=null,plan_paused_remaining_seconds=0 where id=p.dj_id and role='dj';
  end if;
  return query select p.id,p.dj_id,p.plan_type,p.proof_image,p.status,p.submitted_at,p.reviewed_at,p.reviewer_notes;
end $$;
grant execute on function public.admin_review_subscription_proof(text,uuid,text,text) to anon,authenticated;

create or replace function public.request_admin_code(p_email text)
returns boolean language sql security definer set search_path=public as $$ select true $$;
grant execute on function public.request_admin_code(text) to anon,authenticated;

create or replace function public.cleanup_expired_demo_codes()
returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin
  update public.dj_accounts set demo_code=null,access_code_display=null,access_code_hash=null where plan_type='trial' and plan_expires_at<=now() and demo_code is not null;
  get diagnostics n=row_count; return n; end $$;
revoke all on function public.cleanup_expired_demo_codes() from public,anon,authenticated;
