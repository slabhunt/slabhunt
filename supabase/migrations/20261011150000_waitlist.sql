-- Pre-launch early-access list (slabhunt.fun/signup). Written only by the `signup` edge function (service role);
-- players and visitors have no direct access. Referrals move people up the list.
create table if not exists public.waitlist (
  id bigserial primary key,
  email text not null,
  x_handle text,
  city text,
  kind text,
  code text not null unique,
  referred_by bigint references public.waitlist(id),
  ip_hash text,
  updates_ok boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists waitlist_email_key on public.waitlist (lower(email));
create index if not exists waitlist_ip_recent on public.waitlist (ip_hash, created_at);
create index if not exists waitlist_referred_by on public.waitlist (referred_by);
alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

-- Place in line: more referrals first, then earlier signups.
create or replace function public.waitlist_place(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (
    select w.id, w.code, w.created_at, (select count(*) from waitlist r where r.referred_by = w.id) as refs from waitlist w
  ), me as (select * from s where id = p_id)
  select jsonb_build_object(
    'code', me.code,
    'referrals', me.refs,
    'position', 1 + (select count(*) from s where s.refs > me.refs or (s.refs = me.refs and s.created_at < me.created_at)),
    'total', (select count(*) from waitlist)
  ) from me;
$$;
revoke execute on function public.waitlist_place(bigint) from public, anon, authenticated;

create or replace function public.waitlist_join(p_email text, p_x text, p_city text, p_kind text, p_ref text, p_ip_hash text, p_updates boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_id bigint;
  v_ref bigint;
  v_code text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then return jsonb_build_object('error', 'email'); end if;
  select id into v_id from waitlist where lower(email) = v_email;
  if v_id is not null then return waitlist_place(v_id) || jsonb_build_object('already', true); end if;
  if (select count(*) from waitlist where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('error', 'slow_down');
  end if;
  select id into v_ref from waitlist where code = upper(trim(coalesce(p_ref, '')));
  loop
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from waitlist where code = v_code);
  end loop;
  insert into waitlist (email, x_handle, city, kind, code, referred_by, ip_hash, updates_ok)
  values (v_email, nullif(left(trim(regexp_replace(coalesce(p_x, ''), '^@', '')), 30), ''), nullif(left(trim(coalesce(p_city, '')), 80), ''),
          nullif(left(trim(coalesce(p_kind, '')), 30), ''), v_code, v_ref, p_ip_hash, coalesce(p_updates, false))
  returning id into v_id;
  return waitlist_place(v_id);
end $$;
revoke execute on function public.waitlist_join(text, text, text, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.waitlist_status(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select waitlist_place(id) from waitlist where code = upper(trim(p_code))), jsonb_build_object('error', 'not_found'));
$$;
revoke execute on function public.waitlist_status(text) from public, anon, authenticated;

-- Admins: totals, top cities and the latest signups (emails included, so admins only).
create or replace function public.admin_waitlist(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'total', (select count(*) from waitlist),
    'today', (select count(*) from waitlist where created_at > now() - interval '24 hours'),
    'cities', coalesce((select jsonb_agg(c) from (select initcap(city) as city, count(*) as n from waitlist where city is not null group by initcap(city) order by n desc limit 15) c), '[]'::jsonb),
    'kinds', coalesce((select jsonb_object_agg(coalesce(kind, 'unsaid'), n) from (select kind, count(*) n from waitlist group by kind) k), '{}'::jsonb),
    'latest', coalesce((select jsonb_agg(r) from (
      select w.email, w.x_handle, w.city, w.kind, w.updates_ok, w.created_at,
             (select count(*) from waitlist x where x.referred_by = w.id) as referrals
      from waitlist w order by w.created_at desc limit greatest(1, least(p_limit, 1000))) r), '[]'::jsonb)
  );
end $$;
revoke execute on function public.admin_waitlist(int) from public, anon;
grant execute on function public.admin_waitlist(int) to authenticated;
