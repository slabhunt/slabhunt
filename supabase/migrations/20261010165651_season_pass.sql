-- Season Pass and free walking mode.
-- Free players move by walking (GPS). The pass unlocks explorer travel, more sight and bigger coin bounties.
-- Raffle entries per catch are the SAME for everyone, with the same daily cap, so paying never buys odds.

alter table public.game_config
  add column pass_price       int not null default 5000,
  add column pass_days        int not null default 30,
  add column pass_sight_m     double precision not null default 500,
  add column pass_bounty_mult int not null default 10,
  add column daily_entry_cap  int not null default 20;

alter table public.profiles add column pass_until timestamptz;

create function public.has_pass(p public.profiles) returns boolean
language sql stable set search_path = public as $$ select coalesce(p.pass_until > now(), false) $$;

create or replace function public.sight_m(p public.profiles) returns float8
language sql stable set search_path = public as $$
  select greatest(
    c.base_sight_m,
    case when coalesce(p.pass_until > now(), false) then c.pass_sight_m else 0 end,
    case when p.vault_holder then c.holder_sight_m else 0 end,
    case when p.sight_boost_until > now() then c.boost_sight_m else 0 end)
  from game_config c
$$;
revoke execute on function public.has_pass(public.profiles), public.sight_m(public.profiles) from public, anon, authenticated;

create function public.entries_today(p_user uuid) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(entries), 0)::int from catches where user_id = p_user and created_at > now() - interval '24 hours'
$$;
revoke execute on function public.entries_today(uuid) from public, anon, authenticated;

-- Free mode: your explorer is wherever you're really standing.
create function public.sync_walker(p_lat float8, p_lng float8, p_accuracy float8) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not report_position(p_lat, p_lng, p_accuracy) then
    return jsonb_build_object('error','gps');
  end if;
  update profiles set exp_from_lat = p_lat, exp_from_lng = p_lng, exp_to_lat = p_lat, exp_to_lng = p_lng,
    exp_depart_at = now(), exp_arrive_at = now() where id = auth.uid() returning * into p;
  return explorer_json(p);
end $$;

-- Explorer travel now needs a pass (first placement is still free for everyone).
create or replace function public.travel_to(p_lat float8, p_lng float8) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; cur record; secs float8; dist float8; cost int := 0; bal bigint;
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
  secs := least(greatest(dist / cfg.travel_speed_mps, cfg.travel_min_s), cfg.travel_max_s);
  update profiles set exp_from_lat = cur.lat, exp_from_lng = cur.lng, exp_to_lat = p_lat, exp_to_lng = p_lng,
    exp_depart_at = now(), exp_arrive_at = now() + make_interval(secs => secs)
   where id = auth.uid() returning * into p;
  return explorer_json(p) || jsonb_build_object('cost', cost, 'coins', p.coins);
end $$;

-- Catching: equal entries for everyone up to the daily cap; pass holders earn bigger coin bounties.
create or replace function public.catch_drop(p_drop uuid, p_quality real,
  p_gps_lat float8 default null, p_gps_lng float8 default null, p_gps_accuracy float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; d drops; s species; cur record; r int; chance float8;
  walked boolean := false; bonus int := 0; recent int; pot pots; want int; paid int := 0; bal bigint;
  today int; awarded int;
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
  select * into s from species where id = d.species_id;
  chance := s.catch_chance * (0.5 + 0.5 * least(greatest(coalesce(p_quality, 0), 0), 1));
  if random() < chance then
    today := entries_today(auth.uid());
    awarded := least(s.entries + bonus, greatest(cfg.daily_entry_cap - today, 0));
    select id into r from rounds where status = 'open';
    update drops set caught_by = auth.uid(), caught_at = now() where id = d.id;
    insert into catches (user_id, drop_id, species_id, round_id, entries, xp)
      values (auth.uid(), d.id, s.id, r, awarded, s.xp);
    update profiles set xp = xp + s.xp, catches = catches + 1 where id = auth.uid();
    want := case s.rarity when 'r' then cfg.bounty_r when 'u' then cfg.bounty_u else cfg.bounty_c end;
    if has_pass(p) then want := want * cfg.pass_bounty_mult; end if;
    select * into pot from pots where active and remaining > 0 order by id desc limit 1 for update;
    if pot.id is not null then
      paid := least(want, pot.remaining);
      update pots set remaining = remaining - paid where id = pot.id;
      bal := add_coins(auth.uid(), paid, 'bounty', d.id::text);
    end if;
    if s.rarity <> 'c' then
      insert into chat_messages (user_id, kind, body)
        values (auth.uid(), 'catch', 'caught a ' || s.name || case when s.rarity = 'r' then ' (rare!)' else '' end
          || case when walked then ' on foot' else '' end);
    end if;
    return jsonb_build_object('result','caught','entries',awarded,'capped',awarded < s.entries + bonus,
      'xp',s.xp,'species',s.id,'walked',walked,'coins_won',paid);
  elsif random() < s.flee_chance then
    update drops set expires_at = now() where id = d.id;
    return jsonb_build_object('result','fled');
  else
    return jsonb_build_object('result','escaped');
  end if;
end $$;

create function public.buy_pass() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; bal bigint; p profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  bal := spend_coins(auth.uid(), cfg.pass_price, 'season_pass');
  if bal < 0 then return jsonb_build_object('error','coins','cost',cfg.pass_price); end if;
  update profiles set pass_until = greatest(coalesce(pass_until, now()), now()) + make_interval(days => cfg.pass_days)
   where id = auth.uid() returning * into p;
  return jsonb_build_object('coins', bal, 'pass_until', p.pass_until);
end $$;

create function public.admin_grant_pass(p_user uuid, p_days int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update profiles set pass_until = greatest(coalesce(pass_until, now()), now()) + make_interval(days => p_days)
   where id = p_user returning pass_until into t;
  return t;
end $$;

create or replace function public.my_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; cfg game_config; pot pots;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from profiles where id = auth.uid();
  select * into cfg from game_config;
  select * into pot from pots where active order by id desc limit 1;
  return jsonb_build_object(
    'coins', p.coins, 'sight_m', sight_m(p), 'vault_holder', p.vault_holder,
    'has_pass', has_pass(p), 'pass_until', p.pass_until, 'pass_price', cfg.pass_price, 'pass_days', cfg.pass_days,
    'pass_sight_m', cfg.pass_sight_m, 'pass_bounty_mult', cfg.pass_bounty_mult,
    'daily_cap', cfg.daily_entry_cap, 'entries_today', entries_today(p.id),
    'boost_until', p.sight_boost_until, 'boost_cost', cfg.boost_cost, 'boost_minutes', cfg.boost_minutes,
    'free_hop_m', cfg.free_hop_m, 'km_per_coin', cfg.travel_km_per_coin,
    'travel_base', cfg.travel_base_coins, 'travel_max', cfg.travel_max_coins,
    'pull_price', cfg.pull_price, 'turbo_pct', cfg.turbo_buyback_pct, 'sellback_days', cfg.sellback_days,
    'bounty', jsonb_build_object('c', cfg.bounty_c, 'u', cfg.bounty_u, 'r', cfg.bounty_r),
    'pot', case when pot.id is null then null else jsonb_build_object('id', pot.id, 'name', pot.name, 'total', pot.total_coins, 'remaining', pot.remaining) end,
    'server_now', now());
end $$;

revoke all on function public.sync_walker(float8, float8, float8), public.buy_pass(), public.admin_grant_pass(uuid, int) from public, anon;
grant execute on function public.sync_walker(float8, float8, float8), public.buy_pass(), public.admin_grant_pass(uuid, int) to authenticated;
