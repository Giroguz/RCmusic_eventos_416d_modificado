-- Notification destinations configurable from the Developer Panel.
alter table public.subscription_settings add column if not exists notification_email text;
alter table public.subscription_settings add column if not exists notification_whatsapp text;
insert into public.subscription_settings(id, notification_email, notification_whatsapp)
values (true, 'djgianfrancoromerodechosica@gmail.com', '51930912484')
on conflict (id) do nothing;
update public.subscription_settings
set notification_email = coalesce(notification_email, 'djgianfrancoromerodechosica@gmail.com'),
    notification_whatsapp = coalesce(notification_whatsapp, '51930912484')
where id=true;

drop function if exists public.admin_get_notification_settings(text);
create or replace function public.admin_get_notification_settings(p_token text)
returns table(notification_email text, notification_whatsapp text)
language plpgsql security definer set search_path=public as $$
declare a public.dj_accounts;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'') <> 'admin' or a.email <> 'djgianfrancoromerodechosica@gmail.com' then raise exception 'Admin only'; end if;
  return query select s.notification_email, s.notification_whatsapp from public.subscription_settings as s where s.id=true;
end $$;
grant execute on function public.admin_get_notification_settings(text) to anon, authenticated;

drop function if exists public.admin_set_notification_settings(text,text,text);
create or replace function public.admin_set_notification_settings(p_token text,p_notification_email text,p_notification_whatsapp text)
returns table(notification_email text, notification_whatsapp text)
language plpgsql security definer set search_path=public as $$
declare a public.dj_accounts; result public.subscription_settings;
begin
  select * into a from public._dj_access(p_token);
  if coalesce(a.role,'') <> 'admin' or a.email <> 'djgianfrancoromerodechosica@gmail.com' then raise exception 'Admin only'; end if;
  if nullif(trim(p_notification_email),'') is not null and position('@' in trim(p_notification_email)) < 2 then raise exception 'Invalid notification email'; end if;
  if nullif(regexp_replace(trim(p_notification_whatsapp),'[^0-9]','','g'),'') is not null and length(regexp_replace(trim(p_notification_whatsapp),'[^0-9]','','g')) < 8 then raise exception 'Invalid notification WhatsApp'; end if;
  update public.subscription_settings as s set
    notification_email = nullif(lower(trim(p_notification_email)),''),
    notification_whatsapp = nullif(regexp_replace(trim(p_notification_whatsapp),'[^0-9]','','g'),''),
    updated_at = now()
  where s.id=true returning s.* into result;
  return query select result.notification_email, result.notification_whatsapp;
end $$;
grant execute on function public.admin_set_notification_settings(text,text,text) to anon, authenticated;
