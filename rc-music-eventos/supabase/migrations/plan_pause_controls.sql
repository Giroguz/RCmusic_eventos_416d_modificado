-- Pause plan countdown when a DJ is blocked and resume it when unblocked.
-- Apply after developer_controls.sql.

alter table public.dj_accounts
  add column if not exists plan_paused_at timestamptz,
  add column if not exists plan_paused_remaining_seconds bigint not null default 0;

update public.dj_accounts
set plan_paused_remaining_seconds = greatest(0, floor(extract(epoch from plan_expires_at - now()))::bigint),
    plan_paused_at = coalesce(plan_paused_at, now())
where blocked = true and plan_expires_at is not null and coalesce(plan_paused_remaining_seconds, 0) = 0;

drop function if exists public.admin_list_djs(text);
create or replace function public.admin_list_djs(p_token text)
returns table(id uuid,email text,display_name text,role text,approved boolean,blocked boolean,plan_type text,plan_started_at timestamptz,plan_expires_at timestamptz,days_used integer,days_remaining integer,is_active boolean,generated_code text,plan_paused_remaining_seconds bigint)
language plpgsql security definer set search_path=public as $$
declare a public.dj_accounts;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'') <> 'admin' or a.email <> 'djgianfrancoromerodechosica@gmail.com' then raise exception 'Admin only'; end if;
  return query select d.id,d.email,d.display_name,d.role,d.approved,d.blocked,d.plan_type,d.plan_started_at,d.plan_expires_at,
    case when d.plan_started_at is null then 0 else greatest(0,floor(extract(epoch from least(now(),d.plan_expires_at)-d.plan_started_at)/86400)::integer) end,
    case when d.blocked then greatest(0,floor(coalesce(d.plan_paused_remaining_seconds,0)/86400)::integer)
         when d.plan_expires_at is null then 0 else greatest(0,floor(extract(epoch from d.plan_expires_at-now())/86400)::integer) end,
    (d.approved and not d.blocked and (d.role='admin' or d.plan_expires_at>now())),
    coalesce(nullif(d.access_code_display,''),nullif(d.demo_code,'')),
    case when d.blocked then coalesce(d.plan_paused_remaining_seconds,0) else null end
  from public.dj_accounts d order by d.created_at desc;
end $$;
grant execute on function public.admin_list_djs(text) to anon, authenticated;

drop function if exists public.admin_set_dj_state(text,uuid,boolean,boolean);
create or replace function public.admin_set_dj_state(p_token text,p_dj_id uuid,p_approved boolean,p_blocked boolean)
returns table(id uuid,email text,display_name text,role text,approved boolean,blocked boolean,plan_type text,plan_started_at timestamptz,plan_expires_at timestamptz,days_used integer,days_remaining integer,is_active boolean,generated_code text,plan_paused_remaining_seconds bigint)
language plpgsql security definer set search_path=public as $$
declare a public.dj_accounts; d public.dj_accounts;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'') <> 'admin' or a.email <> 'djgianfrancoromerodechosica@gmail.com' then raise exception 'Admin only'; end if;
  update public.dj_accounts as dja set
    approved = p_approved,
    blocked = p_blocked,
    plan_paused_remaining_seconds = case
      when p_blocked and not dja.blocked then greatest(0,floor(extract(epoch from coalesce(dja.plan_expires_at,now())-now()))::bigint)
      when p_blocked then coalesce(dja.plan_paused_remaining_seconds,0)
      else 0 end,
    plan_paused_at = case when p_blocked and not dja.blocked then now() when p_blocked then dja.plan_paused_at else null end,
    plan_expires_at = case
      when not p_blocked and dja.blocked and coalesce(dja.plan_paused_remaining_seconds,0) > 0
        then now() + make_interval(secs => dja.plan_paused_remaining_seconds::double precision)
      else dja.plan_expires_at end
  where dja.id=p_dj_id and dja.role='dj' returning dja.* into d;
  return query select d.id,d.email,d.display_name,d.role,d.approved,d.blocked,d.plan_type,d.plan_started_at,d.plan_expires_at,0,
    case when d.blocked then greatest(0,floor(coalesce(d.plan_paused_remaining_seconds,0)/86400)::integer)
         when d.plan_expires_at is null then 0 else greatest(0,floor(extract(epoch from d.plan_expires_at-now())/86400)::integer) end,
    (d.approved and not d.blocked and d.plan_expires_at>now()),null::text,
    case when d.blocked then coalesce(d.plan_paused_remaining_seconds,0) else null end;
end $$;
grant execute on function public.admin_set_dj_state(text,uuid,boolean,boolean) to anon, authenticated;

drop function if exists public.admin_set_dj_plan(text,uuid,text);
create or replace function public.admin_set_dj_plan(p_token text,p_dj_id uuid,p_plan_type text)
returns table(id uuid,email text,display_name text,role text,approved boolean,blocked boolean,plan_type text,plan_started_at timestamptz,plan_expires_at timestamptz,days_used integer,days_remaining integer,is_active boolean,generated_code text,plan_paused_remaining_seconds bigint)
language plpgsql security definer set search_path=public as $$
declare a public.dj_accounts; d public.dj_accounts; p_days integer;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'') <> 'admin' or a.email <> 'djgianfrancoromerodechosica@gmail.com' or p_plan_type not in ('none','fifteen','monthly','annual') then raise exception 'Admin only or invalid plan'; end if;
  select case p_plan_type when 'fifteen' then fifteen_days when 'monthly' then monthly_days when 'annual' then annual_days else null end into p_days from public.subscription_settings where public.subscription_settings.id=true;
  update public.dj_accounts as dja set
    plan_type=p_plan_type,
    plan_started_at=case when p_plan_type='none' then null else coalesce(dja.plan_started_at, now()) end,
    plan_expires_at=case when p_days is null then null else greatest(coalesce(dja.plan_expires_at, now()), now())+make_interval(days => p_days) end,
    plan_paused_remaining_seconds=case when dja.blocked and p_days is not null then coalesce(dja.plan_paused_remaining_seconds, greatest(0,floor(extract(epoch from coalesce(dja.plan_expires_at,now())-now()))::bigint)) + (p_days::bigint * 86400) else 0 end,
    plan_paused_at=case when dja.blocked and p_days is not null then coalesce(dja.plan_paused_at, now()) else null end
  where dja.id=p_dj_id and dja.role='dj' returning dja.* into d;
  return query select d.id,d.email,d.display_name,d.role,d.approved,d.blocked,d.plan_type,d.plan_started_at,d.plan_expires_at,0,
    case when d.blocked then greatest(0,floor(coalesce(d.plan_paused_remaining_seconds,0)/86400)::integer)
         when d.plan_expires_at is null then 0 else greatest(0,floor(extract(epoch from d.plan_expires_at-now())/86400)::integer) end,
    (d.approved and not d.blocked and d.plan_expires_at>now()),null::text,
    case when d.blocked then coalesce(d.plan_paused_remaining_seconds,0) else null end;
end $$;
grant execute on function public.admin_set_dj_plan(text,uuid,text) to anon, authenticated;

drop function if exists public.admin_extend_dj_plan(text,uuid,integer);
create or replace function public.admin_extend_dj_plan(p_token text,p_dj_id uuid,p_days integer)
returns table(id uuid,email text,display_name text,role text,approved boolean,blocked boolean,plan_type text,plan_started_at timestamptz,plan_expires_at timestamptz,days_used integer,days_remaining integer,is_active boolean,generated_code text,plan_paused_remaining_seconds bigint)
language plpgsql security definer set search_path=public as $$
declare a public.dj_accounts; d public.dj_accounts;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'') <> 'admin' or a.email <> 'djgianfrancoromerodechosica@gmail.com' then raise exception 'Admin only'; end if;
  if p_days not between 1 and 3650 then raise exception 'Invalid extension'; end if;
  update public.dj_accounts as dja set
    approved=case when dja.blocked then dja.approved else true end,
    blocked=dja.blocked,
    plan_type=case when dja.plan_type in ('monthly','annual','fifteen') then dja.plan_type else 'monthly' end,
    plan_started_at=coalesce(dja.plan_started_at, now()),
    plan_expires_at=greatest(coalesce(dja.plan_expires_at, now()), now()) + make_interval(days => p_days),
    plan_paused_remaining_seconds=case when dja.blocked then coalesce(dja.plan_paused_remaining_seconds,0)+(p_days::bigint*86400) else 0 end,
    plan_paused_at=case when dja.blocked then coalesce(dja.plan_paused_at,now()) else null end
  where dja.id=p_dj_id and dja.role='dj' returning dja.* into d;
  if d.id is null then raise exception 'DJ not found'; end if;
  return query select d.id,d.email,d.display_name,d.role,d.approved,d.blocked,d.plan_type,d.plan_started_at,d.plan_expires_at,0,
    case when d.blocked then greatest(0,floor(coalesce(d.plan_paused_remaining_seconds,0)/86400)::integer)
         else greatest(0,floor(extract(epoch from d.plan_expires_at-now())/86400)::integer) end,
    (d.approved and not d.blocked and d.plan_expires_at>now()),null::text,
    case when d.blocked then coalesce(d.plan_paused_remaining_seconds,0) else null end;
end $$;
grant execute on function public.admin_extend_dj_plan(text,uuid,integer) to anon, authenticated;
