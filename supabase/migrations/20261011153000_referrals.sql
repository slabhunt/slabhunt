-- Referral codes = names. A player's code is their username (slabhunt.fun/?ref=name or /signup?ref=name);
-- someone on the early-access list uses their X handle. Referrals are tracked only (no coin rewards here).
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id);
alter table public.profiles add column if not exists referred_at timestamptz;
create index if not exists profiles_referred_by on public.profiles (referred_by);
alter table public.waitlist add column if not exists ref_user uuid references public.profiles(id);
create index if not exists waitlist_ref_user on public.waitlist (ref_user);

-- Same as v2, but the signup's own code is their X handle, and the ref can be a player's username, a list member's
-- X handle, or an old 8-character code.
create or replace function public.waitlist_join_v3(p_email text, p_x text, p_wallet text, p_quote_url text, p_tasks jsonb,
  p_city text, p_kind text, p_ref text, p_ip_hash text, p_updates boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_x text := nullif(trim(regexp_replace(coalesce(p_x, ''), '^@', '')), '');
  v_wallet text := nullif(trim(coalesce(p_wallet, '')), '');
  v_quote text := nullif(trim(coalesce(p_quote_url, '')), '');
  v_ref text := lower(trim(regexp_replace(coalesce(p_ref, ''), '^@', '')));
  v_id bigint;
  v_ref_list bigint;
  v_ref_user uuid;
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
  if v_ref <> '' and v_ref <> lower(v_x) then
    select id into v_ref_user from profiles where lower(display_name) = v_ref;
    if v_ref_user is null then
      select id into v_ref_list from waitlist where lower(code) = v_ref or lower(x_handle) = v_ref limit 1;
    end if;
  end if;
  insert into waitlist (email, x_handle, wallet, quote_url, tasks, city, kind, code, referred_by, ref_user, ip_hash, updates_ok)
  values (v_email, v_x, v_wallet, left(v_quote, 300),
          jsonb_build_object('like', coalesce((p_tasks->>'like')::boolean, false), 'comment', coalesce((p_tasks->>'comment')::boolean, false),
                             'quote', true, 'follow', coalesce((p_tasks->>'follow')::boolean, false)),
          nullif(left(trim(coalesce(p_city, '')), 80), ''), nullif(left(trim(coalesce(p_kind, '')), 30), ''),
          lower(v_x), v_ref_list, v_ref_user, p_ip_hash, coalesce(p_updates, false))
  returning id into v_id;
  return waitlist_place(v_id);
end $$;
revoke execute on function public.waitlist_join_v3(text, text, text, text, jsonb, text, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.waitlist_status_v2(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select waitlist_place(id) from waitlist where lower(code) = lower(trim(p_code)) limit 1), jsonb_build_object('error', 'not_found'));
$$;
revoke execute on function public.waitlist_status_v2(text) from public, anon, authenticated;

-- Who invited a link's visitor (for "Invited by ..." on the signup page). Server-only; the edge function serves it.
create or replace function public.referral_lookup(p_ref text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('name', display_name, 'kind', 'player') from profiles where lower(display_name) = lower(trim(p_ref))),
    (select jsonb_build_object('name', x_handle, 'kind', 'list') from waitlist where lower(code) = lower(trim(p_ref)) or lower(x_handle) = lower(trim(p_ref)) limit 1),
    jsonb_build_object('error', 'not_found'));
$$;
revoke execute on function public.referral_lookup(text) from public, anon, authenticated;

-- A new player says who invited them (the game sends the ?ref= it saw). Once only, within 3 days of joining, not yourself.
create or replace function public.claim_referral(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me profiles; v_ref uuid;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'signed_out'); end if;
  select * into me from profiles where id = auth.uid();
  if me.referred_by is not null then return jsonb_build_object('error', 'already'); end if;
  if me.created_at < now() - interval '3 days' then return jsonb_build_object('error', 'too_late'); end if;
  select id into v_ref from profiles where lower(display_name) = lower(trim(regexp_replace(coalesce(p_ref, ''), '^@', '')));
  if v_ref is null then return jsonb_build_object('error', 'not_found'); end if;
  if v_ref = me.id then return jsonb_build_object('error', 'self'); end if;
  update profiles set referred_by = v_ref, referred_at = now() where id = me.id and referred_by is null;
  return jsonb_build_object('ok', true, 'by', (select display_name from profiles where id = v_ref));
end $$;
revoke execute on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- Your invite links and how many people used them.
create or replace function public.my_referrals()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', p.display_name,
    'players', (select count(*) from profiles r where r.referred_by = p.id),
    'signups', (select count(*) from waitlist w where w.ref_user = p.id),
    'by', (select display_name from profiles b where b.id = p.referred_by)
  ) from profiles p where p.id = auth.uid();
$$;
revoke execute on function public.my_referrals() from public, anon;
grant execute on function public.my_referrals() to authenticated;
