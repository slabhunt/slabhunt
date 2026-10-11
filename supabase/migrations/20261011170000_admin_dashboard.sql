-- Live presence + the admin dashboard.
-- heartbeat(): the game calls it every minute while open; it marks you active and returns how many players are online
-- (active in the last 3 minutes). admin_dashboard() and admin_player_map() are admins only. The map never returns exact
-- spots: positions are snapped to a ~0.5 degree grid (tens of km) and only areas are returned, never players.
alter table public.profiles add column if not exists active_at timestamptz;
create index if not exists profiles_active_at on public.profiles (active_at);

create or replace function public.heartbeat() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('online', 0); end if;
  update profiles set active_at = now() where id = auth.uid() and (active_at is null or active_at < now() - interval '20 seconds');
  return jsonb_build_object('online', (select count(*) from profiles where active_at > now() - interval '3 minutes'));
end $$;
revoke execute on function public.heartbeat() from public, anon;
grant execute on function public.heartbeat() to authenticated;

create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare day0 date := (now() at time zone 'utc')::date;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'players', jsonb_build_object(
      'total', (select count(*) from profiles),
      'online', (select count(*) from profiles where active_at > now() - interval '3 minutes'),
      'active_24h', (select count(*) from profiles where active_at > now() - interval '24 hours'),
      'active_7d', (select count(*) from profiles where active_at > now() - interval '7 days'),
      'new_24h', (select count(*) from profiles where created_at > now() - interval '24 hours'),
      'new_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
      'with_wallet', (select count(distinct user_id) from wallets),
      'pass_holders', (select count(*) from profiles where pass_until > now())),
    'play', jsonb_build_object(
      'catches_24h', (select count(*) from catches where created_at > now() - interval '24 hours'),
      'catches_total', (select count(*) from catches),
      'creatures_live', (select count(*) from drops where caught_by is null and expires_at > now()),
      'chat_24h', (select count(*) from chat_messages where created_at > now() - interval '24 hours'),
      'gacha_pulls_24h', (select count(*) from gacha_pulls where created_at > now() - interval '24 hours'),
      'mapped_areas', (select count(*) from spawn_cells where status = 'ready')),
    'economy', jsonb_build_object(
      'coins_held', (select coalesce(sum(coins), 0) from profiles),
      'earned_24h', (select coalesce(sum(delta), 0) from coin_ledger where delta > 0 and created_at > now() - interval '24 hours'),
      'spent_24h', (select coalesce(-sum(delta), 0) from coin_ledger where delta < 0 and created_at > now() - interval '24 hours'),
      'pot_remaining', (select coalesce(sum(remaining), 0) from pots where active),
      'pot_total', (select coalesce(sum(total_coins), 0) from pots where active)),
    'draws', jsonb_build_object(
      'round', (select jsonb_build_object('id', id, 'prize', prize_name, 'status', status, 'opened_at', opened_at) from rounds order by id desc limit 1),
      'vault_open', (select count(*) from vault_draws where status = 'open'),
      'cards_in_pool', (select count(*) from gacha_cards where status = 'pool')),
    'signups', jsonb_build_object(
      'total', (select count(*) from waitlist),
      'today', (select count(*) from waitlist where created_at > now() - interval '24 hours'),
      'unchecked', (select count(*) from waitlist where checked is null)),
    'daily', (select jsonb_agg(jsonb_build_object('day', d::date,
        'players', (select count(*) from profiles where created_at::date = d::date),
        'catches', (select count(*) from catches where created_at::date = d::date),
        'signups', (select count(*) from waitlist where created_at::date = d::date)) order by d)
      from generate_series(day0 - 13, day0, interval '1 day') d),
    'top', coalesce((select jsonb_agg(t) from (
      select display_name as name, catches, coins, active_at from profiles order by catches desc, created_at limit 10) t), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(t) from (
      select p.display_name as name, s.name as species, c.created_at as at from catches c
        join profiles p on p.id = c.user_id join species s on s.id = c.species_id
       order by c.created_at desc limit 15) t), '[]'::jsonb)
  );
end $$;
revoke execute on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;

-- Where players are, by general area only (~0.5 degree cells). Counts players whose explorer was last in each cell.
create or replace function public.admin_player_map() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return coalesce((select jsonb_agg(a) from (
    select round(((floor(lat * 2) + 0.5) / 2)::numeric, 2) as lat, round(((floor(lng * 2) + 0.5) / 2)::numeric, 2) as lng,
           count(*) as players, count(*) filter (where online) as online
      from (select coalesce(exp_to_lat, last_lat) as lat, coalesce(exp_to_lng, last_lng) as lng,
                   coalesce(active_at > now() - interval '3 minutes', false) as online from profiles) x
     where lat is not null and lng is not null
     group by 1, 2) a), '[]'::jsonb);
end $$;
revoke execute on function public.admin_player_map() from public, anon;
grant execute on function public.admin_player_map() to authenticated;
