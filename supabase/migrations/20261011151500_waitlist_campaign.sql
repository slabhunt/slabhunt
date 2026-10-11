-- Early-access signup campaign: a Solana wallet (for prize/allowlist delivery only; any wallet perk still needs a
-- signature-verified wallet in the game), an X handle, and the X tasks on the pinned gameplay post. X doesn't let us
-- confirm likes/reposts without its paid API, so we store what the person ticked plus their quote-post link to spot-check.
alter table public.waitlist add column if not exists wallet text;
alter table public.waitlist add column if not exists quote_url text;
alter table public.waitlist add column if not exists tasks jsonb not null default '{}'::jsonb;
alter table public.waitlist add column if not exists checked text; -- admin review: null, 'ok' or 'bad'
create unique index if not exists waitlist_wallet_key on public.waitlist (wallet) where wallet is not null;
create unique index if not exists waitlist_x_key on public.waitlist (lower(x_handle)) where x_handle is not null;

alter table public.game_config add column if not exists signup_post_url text;

create or replace function public.waitlist_join_v2(p_email text, p_x text, p_wallet text, p_quote_url text, p_tasks jsonb,
  p_city text, p_kind text, p_ref text, p_ip_hash text, p_updates boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_x text := nullif(trim(regexp_replace(coalesce(p_x, ''), '^@', '')), '');
  v_wallet text := nullif(trim(coalesce(p_wallet, '')), '');
  v_quote text := nullif(trim(coalesce(p_quote_url, '')), '');
  v_id bigint;
  v_ref bigint;
  v_code text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then return jsonb_build_object('error', 'email'); end if;
  if v_x is null or v_x !~ '^[A-Za-z0-9_]{1,15}$' then return jsonb_build_object('error', 'x'); end if;
  if v_wallet is null or v_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return jsonb_build_object('error', 'wallet'); end if;
  if v_quote is null or v_quote !~* ('^https://(x|twitter)\.com/' || v_x || '/status/[0-9]{5,25}([/?].*)?$') then
    return jsonb_build_object('error', 'quote');
  end if;
  select id into v_id from waitlist where lower(email) = v_email or lower(x_handle) = lower(v_x) or wallet = v_wallet limit 1;
  if v_id is not null then return jsonb_build_object('already', true); end if;
  if (select count(*) from waitlist where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('error', 'slow_down');
  end if;
  select id into v_ref from waitlist where code = upper(trim(coalesce(p_ref, '')));
  loop
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from waitlist where code = v_code);
  end loop;
  insert into waitlist (email, x_handle, wallet, quote_url, tasks, city, kind, code, referred_by, ip_hash, updates_ok)
  values (v_email, v_x, v_wallet, left(v_quote, 300),
          jsonb_build_object('like', coalesce((p_tasks->>'like')::boolean, false), 'comment', coalesce((p_tasks->>'comment')::boolean, false),
                             'quote', true, 'follow', coalesce((p_tasks->>'follow')::boolean, false)),
          nullif(left(trim(coalesce(p_city, '')), 80), ''), nullif(left(trim(coalesce(p_kind, '')), 30), ''),
          v_code, v_ref, p_ip_hash, coalesce(p_updates, false))
  returning id into v_id;
  return waitlist_place(v_id);
end $$;
revoke execute on function public.waitlist_join_v2(text, text, text, text, jsonb, text, text, text, text, boolean) from public, anon, authenticated;

-- What the signup page needs: the pinned post to like/comment/quote. Server-only (the edge function serves it).
create or replace function public.waitlist_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('post_url', signup_post_url, 'total', (select count(*) from waitlist)) from game_config limit 1;
$$;
revoke execute on function public.waitlist_config() from public, anon, authenticated;

create or replace function public.admin_set_signup_post(p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_url is not null and p_url <> '' and p_url !~* '^https://(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{5,25}' then
    return jsonb_build_object('error', 'url');
  end if;
  update game_config set signup_post_url = nullif(trim(p_url), '') where id;
  return jsonb_build_object('post_url', (select signup_post_url from game_config limit 1));
end $$;
revoke execute on function public.admin_set_signup_post(text) from public, anon;
grant execute on function public.admin_set_signup_post(text) to authenticated;

-- Admin: mark a signup checked ('ok') or not ('bad') after looking at their quote post.
create or replace function public.admin_waitlist_check(p_x text, p_result text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_result not in ('ok', 'bad') then return jsonb_build_object('error', 'result'); end if;
  update waitlist set checked = p_result where lower(x_handle) = lower(regexp_replace(p_x, '^@', ''));
  return jsonb_build_object('ok', found);
end $$;
revoke execute on function public.admin_waitlist_check(text, text) from public, anon;
grant execute on function public.admin_waitlist_check(text, text) to authenticated;

-- Admin list, now with wallet, quote link and review state.
create or replace function public.admin_waitlist_v2(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'total', (select count(*) from waitlist),
    'today', (select count(*) from waitlist where created_at > now() - interval '24 hours'),
    'unchecked', (select count(*) from waitlist where checked is null),
    'post_url', (select signup_post_url from game_config limit 1),
    'cities', coalesce((select jsonb_agg(c) from (select initcap(city) as city, count(*) as n from waitlist where city is not null group by initcap(city) order by n desc limit 15) c), '[]'::jsonb),
    'latest', coalesce((select jsonb_agg(r) from (
      select w.email, w.x_handle, w.wallet, w.quote_url, w.tasks, w.checked, w.city, w.kind, w.created_at,
             (select count(*) from waitlist x where x.referred_by = w.id) as referrals
      from waitlist w order by w.created_at desc limit greatest(1, least(p_limit, 1000))) r), '[]'::jsonb)
  );
end $$;
revoke execute on function public.admin_waitlist_v2(int) from public, anon;
grant execute on function public.admin_waitlist_v2(int) to authenticated;
