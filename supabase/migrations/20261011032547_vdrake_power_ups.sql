-- $VDRAKE power-ups. Players buy points with the token, then choose where each point goes:
-- more daily throws, a faster explorer, or a wider sight radius. Points and levels last for the current season.
-- Switched off (token_upgrades_enabled = false) until the token launches and legal review signs off; admins can test.
-- Each payment is split on-chain in one transaction: part burned, the rest sent to the card vault,
-- the map-drops treasury and the development multisig (token_split, percent).
-- Catches made with power-up throws pay no raffle entries or coins unless token_throws_pay_rewards is turned on.
alter table game_config
  add column if not exists token_upgrades_enabled boolean not null default false,
  add column if not exists token_cluster text not null default 'devnet' check (token_cluster in ('devnet','mainnet-beta')),
  add column if not exists token_mint text,
  add column if not exists token_decimals int not null default 6,
  add column if not exists token_split jsonb not null default '{"burn":40,"vault":35,"drops":15,"dev":10}',
  add column if not exists token_vault_wallet text,
  add column if not exists token_drops_wallet text,
  add column if not exists token_dev_wallet text,
  add column if not exists upgrade_tiers jsonb not null default '[{"tier":1,"name":"Spark","points":1,"price":0},{"tier":2,"name":"Surge","points":3,"price":0},{"tier":3,"name":"Overdrive","points":7,"price":0}]',
  add column if not exists upgrade_max_level int not null default 5,
  add column if not exists upgrade_throws_per_level int not null default 10,
  add column if not exists upgrade_speed_pct_per_level int not null default 25,
  add column if not exists upgrade_sight_m_per_level int not null default 50,
  add column if not exists token_throws_pay_rewards boolean not null default false;

create table if not exists public.player_upgrades (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id int not null,
  points int not null default 0 check (points >= 0),     -- bought, not placed yet
  throws_lvl int not null default 0,
  speed_lvl int not null default 0,
  sight_lvl int not null default 0,
  primary key (user_id, season_id)
);
alter table public.player_upgrades enable row level security;
create policy "own upgrades" on public.player_upgrades for select using (user_id = auth.uid());

create table if not exists public.token_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id int not null,
  tier int not null,
  points int not null,
  price numeric not null,
  cluster text not null,
  mint text not null,
  splits jsonb not null,           -- burn % and each wallet's %, fixed when the purchase starts
  decimals int not null,
  status text not null default 'pending' check (status in ('pending','paid')),
  signature text unique,
  payer text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.token_purchases enable row level security;
create policy "own purchases" on public.token_purchases for select using (user_id = auth.uid());

-- This season's power-up levels for a player (zeros if none).
create or replace function public.upgrade_levels(p_user uuid)
returns table (points int, throws_lvl int, speed_lvl int, sight_lvl int)
language sql stable security definer set search_path = public as $$
  select coalesce(max(u.points), 0), coalesce(max(u.throws_lvl), 0), coalesce(max(u.speed_lvl), 0), coalesce(max(u.sight_lvl), 0)
  from player_upgrades u where u.user_id = p_user and u.season_id = coalesce((current_season()).id, 0)
$$;

create or replace function public.sight_m(p profiles) returns double precision
language sql stable set search_path = public as $$
  select greatest(
    c.base_sight_m,
    case when coalesce(p.pass_until > now(), false) then c.pass_sight_m else 0 end,
    case when p.vault_holder then c.holder_sight_m else 0 end,
    case when p.sight_boost_until > now() then c.boost_sight_m else 0 end)
    + (select sight_lvl from upgrade_levels(p.id)) * c.upgrade_sight_m_per_level
  from game_config c
$$;

create or replace function public.travel_to(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; cur record; secs float8; dist float8; cost int := 0; bal bigint; ul record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_lat not between -85 and 85 or p_lng not between -180 and 180 then raise exception 'bad destination'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;
  if p.exp_to_lat is null then
    update profiles set exp_from_lat = p_lat, exp_from_lng = p_lng, exp_to_lat = p_lat, exp_to_lng = p_lng,
      exp_depart_at = now(), exp_arrive_at = now() where id = auth.uid() returning * into p;
    return explorer_json(p) || jsonb_build_object('cost', 0, 'coins', p.coins);
  end if;
  if not has_pass(p) then return jsonb_build_object('error','pass'); end if;
  select * into cur from explorer_now(p);
  dist := distance_m(cur.lat, cur.lng, p_lat, p_lng);
  if dist > cfg.free_hop_m then
    cost := least(cfg.travel_base_coins + ceil((dist - cfg.free_hop_m) / (cfg.travel_km_per_coin * 1000))::int, cfg.travel_max_coins);
    bal := spend_coins(auth.uid(), cost, 'travel');
    if bal < 0 then return jsonb_build_object('error','coins','cost',cost,'coins',p.coins); end if;
  end if;
  -- Speed power-up: each level makes the explorer faster.
  select * into ul from upgrade_levels(auth.uid());
  secs := least(greatest(dist / (cfg.travel_speed_mps * (1 + ul.speed_lvl * cfg.upgrade_speed_pct_per_level / 100.0)), cfg.travel_min_s), cfg.travel_max_s);
  update profiles set exp_from_lat = cur.lat, exp_from_lng = cur.lng, exp_to_lat = p_lat, exp_to_lng = p_lng,
    exp_depart_at = now(), exp_arrive_at = now() + make_interval(secs => secs)
   where id = auth.uid() returning * into p;
  return explorer_json(p) || jsonb_build_object('cost', cost, 'coins', p.coins);
end $$;

create or replace function public.catch_drop(p_drop uuid, p_quality real,
  p_gps_lat double precision default null, p_gps_lng double precision default null, p_gps_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; d drops; s species; cur record; r int; chance float8;
  walked boolean := false; bonus int := 0; recent int; pot pots; want int; paid int := 0; bal bigint;
  today int; awarded int; ul record; token_throw boolean := false;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;
  if p.last_attempt_at is not null and p.last_attempt_at > now() - make_interval(secs => cfg.attempt_cooldown_ms / 1000.0) then
    return jsonb_build_object('result','cooldown');
  end if;
  update profiles set last_attempt_at = now() where id = auth.uid();
  select count(*) into recent from catches where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent >= cfg.max_catches_per_hour then return jsonb_build_object('result','limit'); end if;
  select * into d from drops where id = p_drop for update;
  if not found or d.caught_by is not null or d.expires_at <= now() then
    return jsonb_build_object('result','gone');
  end if;
  if p_gps_lat is not null and p_gps_accuracy is not null and p_gps_accuracy <= cfg.max_accuracy_m
     and distance_m(d.lat, d.lng, p_gps_lat, p_gps_lng) <= cfg.catch_radius_m + least(p_gps_accuracy, 30)
     and report_position(p_gps_lat, p_gps_lng, p_gps_accuracy) then
    walked := true; bonus := cfg.walk_bonus_entries;
  end if;
  if not walked then
    select * into cur from explorer_now(p);
    if cur.lat is null or not cur.arrived then return jsonb_build_object('result','traveling'); end if;
    if distance_m(d.lat, d.lng, cur.lat, cur.lng) > cfg.catch_radius_m then return jsonb_build_object('result','too_far'); end if;
  end if;
  -- Each throw uses one of today's free throws, then a bought one.
  if p.throws_day is distinct from (now() at time zone 'utc')::date then
    update profiles set throws_day = (now() at time zone 'utc')::date, throws_used = 0 where id = auth.uid() returning * into p;
  end if;
  select * into ul from upgrade_levels(auth.uid());
  if p.throws_used < cfg.free_throws_per_day then
    update profiles set throws_used = throws_used + 1 where id = auth.uid();
  elsif p.throws_used < cfg.free_throws_per_day + ul.throws_lvl * cfg.upgrade_throws_per_level then
    -- Power-up throws (bought with $VDRAKE). Unless legal review allows it, their catches pay no entries or coins.
    update profiles set throws_used = throws_used + 1 where id = auth.uid();
    token_throw := not cfg.token_throws_pay_rewards;
  elsif p.bonus_throws > 0 then
    update profiles set bonus_throws = bonus_throws - 1 where id = auth.uid();
  else
    return jsonb_build_object('result','no_throws','pack_size',cfg.throw_pack_size,'pack_price',cfg.throw_pack_price);
  end if;
  select * into s from species where id = d.species_id;
  chance := s.catch_chance * (0.5 + 0.5 * least(greatest(coalesce(p_quality, 0), 0), 1));
  if random() < chance then
    today := entries_today(auth.uid());
    awarded := case when token_throw then 0 else least(s.entries + bonus, greatest(cfg.daily_entry_cap - today, 0)) end;
    select id into r from rounds where status = 'open';
    update drops set caught_by = auth.uid(), caught_at = now() where id = d.id;
    insert into catches (user_id, drop_id, species_id, round_id, entries, xp)
      values (auth.uid(), d.id, s.id, r, awarded, s.xp);
    update profiles set xp = xp + s.xp, catches = catches + 1 where id = auth.uid();
    want := case s.rarity when 'l' then cfg.bounty_l when 'r' then cfg.bounty_r when 'u' then cfg.bounty_u else cfg.bounty_c end;
    if has_pass(p) then want := want * cfg.pass_bounty_mult; end if;
    select * into pot from pots where active and remaining > 0 order by id desc limit 1 for update;
    if pot.id is not null and not token_throw then
      paid := least(want, pot.remaining);
      update pots set remaining = remaining - paid where id = pot.id;
      bal := add_coins(auth.uid(), paid, 'bounty', d.id::text);
    end if;
    if s.rarity <> 'c' then
      insert into chat_messages (user_id, kind, body)
        values (auth.uid(), 'catch', 'caught a ' || s.name
          || case s.rarity when 'l' then ' (LEGENDARY!)' when 'r' then ' (rare!)' else '' end
          || case when walked then ' on foot' else '' end);
    end if;
    return jsonb_build_object('result','caught','entries',awarded,'capped',not token_throw and awarded < s.entries + bonus,'token_throw',token_throw,
      'xp',s.xp,'species',s.id,'walked',walked,'coins_won',paid);
  elsif random() < s.flee_chance then
    update drops set expires_at = now() where id = d.id;
    return jsonb_build_object('result','fled');
  else
    return jsonb_build_object('result','escaped');
  end if;
end $$;

create or replace function public.my_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; cfg game_config; pot pots; ul record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from profiles where id = auth.uid();
  select * into cfg from game_config;
  select * into pot from pots where active order by id desc limit 1;
  select * into ul from upgrade_levels(p.id);
  return jsonb_build_object(
    'coins', p.coins, 'sight_m', sight_m(p), 'vault_holder', p.vault_holder,
    'has_pass', has_pass(p), 'pass_until', p.pass_until, 'pass_price', cfg.pass_price, 'pass_days', cfg.pass_days,
    'pass_sight_m', cfg.pass_sight_m, 'pass_bounty_mult', cfg.pass_bounty_mult,
    'daily_cap', cfg.daily_entry_cap, 'entries_today', entries_today(p.id),
    'boost_until', p.sight_boost_until, 'boost_cost', cfg.boost_cost, 'boost_minutes', cfg.boost_minutes,
    'free_hop_m', cfg.free_hop_m, 'km_per_coin', cfg.travel_km_per_coin,
    'travel_base', cfg.travel_base_coins, 'travel_max', cfg.travel_max_coins,
    'pull_price', cfg.pull_price, 'turbo_pct', cfg.turbo_buyback_pct, 'sellback_days', cfg.sellback_days,
    'bounty', jsonb_build_object('c', cfg.bounty_c, 'u', cfg.bounty_u, 'r', cfg.bounty_r, 'l', cfg.bounty_l),
    'pot', case when pot.id is null then null else jsonb_build_object('id', pot.id, 'name', pot.name, 'total', pot.total_coins, 'remaining', pot.remaining) end,
    'throws_free', cfg.free_throws_per_day + ul.throws_lvl * cfg.upgrade_throws_per_level,
    'throws_base', cfg.free_throws_per_day, 'throws_power', ul.throws_lvl * cfg.upgrade_throws_per_level,
    'throws_used', case when p.throws_day = (now() at time zone 'utc')::date then p.throws_used else 0 end,
    'bonus_throws', p.bonus_throws,
    'throw_pack_size', cfg.throw_pack_size, 'throw_pack_price', cfg.throw_pack_price,
    'throws_reset_at', (((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc'),
    'server_now', now());
end $$;

-- Power-ups panel: settings, prices and this player's levels.
create or replace function public.power_ups() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg game_config; ul record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into ul from upgrade_levels(auth.uid());
  return jsonb_build_object(
    'enabled', cfg.token_upgrades_enabled, 'can_buy', cfg.token_upgrades_enabled or is_admin(),
    'cluster', cfg.token_cluster, 'mint', cfg.token_mint, 'split', cfg.token_split,
    'wallets', jsonb_build_object('vault', cfg.token_vault_wallet, 'drops', cfg.token_drops_wallet, 'dev', cfg.token_dev_wallet),
    'tiers', cfg.upgrade_tiers, 'max_level', cfg.upgrade_max_level,
    'per_level', jsonb_build_object('throws', cfg.upgrade_throws_per_level, 'speed_pct', cfg.upgrade_speed_pct_per_level, 'sight_m', cfg.upgrade_sight_m_per_level),
    'throws_pay_rewards', cfg.token_throws_pay_rewards,
    'points', ul.points, 'levels', jsonb_build_object('throws', ul.throws_lvl, 'speed', ul.speed_lvl, 'sight', ul.sight_lvl),
    'season', (current_season()).name);
end $$;

-- Put one unspent point into a track: 'throws', 'speed' or 'sight'.
create or replace function public.place_power_up(p_track text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; u player_upgrades; sid int := coalesce((current_season()).id, 0);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_track not in ('throws','speed','sight') then return jsonb_build_object('error','track'); end if;
  select * into cfg from game_config;
  select * into u from player_upgrades where user_id = auth.uid() and season_id = sid for update;
  if u.user_id is null or u.points < 1 then return jsonb_build_object('error','points'); end if;
  if (p_track = 'throws' and u.throws_lvl >= cfg.upgrade_max_level) or (p_track = 'speed' and u.speed_lvl >= cfg.upgrade_max_level)
     or (p_track = 'sight' and u.sight_lvl >= cfg.upgrade_max_level) then
    return jsonb_build_object('error','max');
  end if;
  update player_upgrades set points = points - 1,
    throws_lvl = throws_lvl + (p_track = 'throws')::int,
    speed_lvl = speed_lvl + (p_track = 'speed')::int,
    sight_lvl = sight_lvl + (p_track = 'sight')::int
   where user_id = auth.uid() and season_id = sid;
  return power_ups();
end $$;

-- Step 1 of a purchase (called by the powerup function as the player): record what they're buying and the price.
create or replace function public.start_token_purchase(p_tier int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; t jsonb; pid uuid; sp jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  if not (cfg.token_upgrades_enabled or is_admin()) then return jsonb_build_object('error','off'); end if;
  if cfg.token_mint is null or cfg.token_vault_wallet is null or cfg.token_drops_wallet is null or cfg.token_dev_wallet is null
     or coalesce((cfg.token_split->>'burn')::int, 0) + coalesce((cfg.token_split->>'vault')::int, 0)
      + coalesce((cfg.token_split->>'drops')::int, 0) + coalesce((cfg.token_split->>'dev')::int, 0) <> 100 then
    return jsonb_build_object('error','not_set_up');
  end if;
  sp := jsonb_build_object('burn_pct', coalesce((cfg.token_split->>'burn')::int, 0), 'to', jsonb_build_array(
    jsonb_build_object('key','vault','wallet',cfg.token_vault_wallet,'pct',coalesce((cfg.token_split->>'vault')::int, 0)),
    jsonb_build_object('key','drops','wallet',cfg.token_drops_wallet,'pct',coalesce((cfg.token_split->>'drops')::int, 0)),
    jsonb_build_object('key','dev','wallet',cfg.token_dev_wallet,'pct',coalesce((cfg.token_split->>'dev')::int, 0))));
  select e.v into t from jsonb_array_elements(cfg.upgrade_tiers) as e(v) where (e.v->>'tier')::int = p_tier;
  if t is null or coalesce((t->>'price')::numeric, 0) <= 0 then return jsonb_build_object('error','tier'); end if;
  insert into token_purchases (user_id, season_id, tier, points, price, cluster, mint, splits, decimals)
    values (auth.uid(), coalesce((current_season()).id, 0), p_tier, (t->>'points')::int, (t->>'price')::numeric,
            cfg.token_cluster, cfg.token_mint, sp, cfg.token_decimals)
    returning id into pid;
  return jsonb_build_object('purchase_id', pid, 'price', (t->>'price')::numeric, 'points', (t->>'points')::int,
    'cluster', cfg.token_cluster, 'mint', cfg.token_mint, 'splits', sp, 'decimals', cfg.token_decimals);
end $$;

-- Step 2 (server only, after the powerup function has checked the payment on-chain): add the points.
create or replace function public.credit_token_purchase(p_id uuid, p_signature text, p_payer text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tp token_purchases;
begin
  select * into tp from token_purchases where id = p_id for update;
  if tp.id is null then return jsonb_build_object('error','unknown'); end if;
  if tp.status = 'paid' then return jsonb_build_object('points', tp.points, 'already', true); end if;
  if exists (select 1 from token_purchases where signature = p_signature) then return jsonb_build_object('error','reused'); end if;
  update token_purchases set status = 'paid', signature = p_signature, payer = p_payer, paid_at = now() where id = p_id;
  insert into player_upgrades (user_id, season_id, points) values (tp.user_id, tp.season_id, tp.points)
    on conflict (user_id, season_id) do update set points = player_upgrades.points + excluded.points;
  return jsonb_build_object('points', tp.points);
end $$;
revoke execute on function public.credit_token_purchase(uuid, text, text) from public, anon, authenticated;
grant execute on function public.credit_token_purchase(uuid, text, text) to service_role;

-- Admin: token settings, tier prices (whole $VDRAKE) and the payment split [burn, vault, drops, dev] in percent.
create or replace function public.admin_power_up_settings(p_enabled boolean, p_cluster text, p_mint text,
  p_vault text, p_drops text, p_dev text, p_prices numeric[], p_split int[], p_pay_rewards boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tiers jsonb;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_split is not null and (array_length(p_split, 1) <> 4 or (select sum(x) from unnest(p_split) x) <> 100
      or (select min(x) from unnest(p_split) x) < 0) then
    raise exception 'split must be 4 numbers that add up to 100';
  end if;
  select jsonb_agg(case when p_prices is not null and array_length(p_prices, 1) >= (e.v->>'tier')::int
                        then jsonb_set(e.v, '{price}', to_jsonb(p_prices[(e.v->>'tier')::int])) else e.v end order by (e.v->>'tier')::int)
    into tiers from game_config c, jsonb_array_elements(c.upgrade_tiers) as e(v);
  update game_config set token_upgrades_enabled = coalesce(p_enabled, token_upgrades_enabled),
    token_cluster = coalesce(nullif(p_cluster, ''), token_cluster),
    token_mint = coalesce(nullif(trim(p_mint), ''), token_mint),
    token_vault_wallet = coalesce(nullif(trim(p_vault), ''), token_vault_wallet),
    token_drops_wallet = coalesce(nullif(trim(p_drops), ''), token_drops_wallet),
    token_dev_wallet = coalesce(nullif(trim(p_dev), ''), token_dev_wallet),
    token_split = case when p_split is null then token_split
      else jsonb_build_object('burn', p_split[1], 'vault', p_split[2], 'drops', p_split[3], 'dev', p_split[4]) end,
    upgrade_tiers = coalesce(tiers, upgrade_tiers),
    token_throws_pay_rewards = coalesce(p_pay_rewards, token_throws_pay_rewards)
   where id;
  return power_ups();
end $$;
