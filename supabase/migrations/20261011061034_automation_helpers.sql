-- Helpers for scheduled jobs. The scheduler proves itself with a random secret that lives only in the database vault.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'Header secret for scheduled edge function calls');
  end if;
end $$;

create or replace function public.cron_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(p_secret) >= 32 and p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'), false)
$$;

-- Weekly holder auto-credit bookkeeping: who was checked this week, so each wallet is looked up at most every 12 hours.
create table if not exists public.holder_auto_checks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week date not null,
  status text not null,
  checked_at timestamptz not null default now(),
  primary key (user_id, week)
);
alter table public.holder_auto_checks enable row level security;

create or replace function public.holder_auto_candidates(p_limit int) returns table (user_id uuid, address text)
language sql stable security definer set search_path = public as $$
  select w.user_id, w.address from wallets w
   where w.verified
     and not exists (select 1 from holder_claims c where c.user_id = w.user_id and c.week = date_trunc('week', now() at time zone 'utc')::date)
     and not exists (select 1 from holder_auto_checks k where k.user_id = w.user_id and k.week = date_trunc('week', now() at time zone 'utc')::date
                       and k.checked_at > now() - interval '12 hours')
   order by (select k.checked_at from holder_auto_checks k where k.user_id = w.user_id order by k.checked_at desc limit 1) nulls first
   limit least(greatest(p_limit, 1), 50)
$$;

create or replace function public.holder_mark_checked(p_user uuid, p_status text) returns void
language sql security definer set search_path = public as $$
  insert into holder_auto_checks (user_id, week, status) values (p_user, date_trunc('week', now() at time zone 'utc')::date, left(p_status, 40))
  on conflict (user_id, week) do update set status = excluded.status, checked_at = now()
$$;

revoke execute on function public.cron_secret_ok(text), public.holder_auto_candidates(int), public.holder_mark_checked(uuid, text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text), public.holder_auto_candidates(int), public.holder_mark_checked(uuid, text) to service_role;
revoke all on public.holder_auto_checks from anon, authenticated;
