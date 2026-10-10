---------------------------------------------------------------------------
-- Spawning: every creature from past seasons stays in the wild; the current season's
-- new creatures are boosted in its hotspots.
---------------------------------------------------------------------------
create or replace function public.spawn_here() returns int
language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; cur record; have int; need int; i int; d float8; b float8;
  sp smallint; total int; roll int; ss seasons; boost int := 1; since timestamptz;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;
  select * into cur from explorer_now(p);
  if cur.lat is null or not cur.arrived then return 0; end if;
  if p.last_spawn_at is not null and p.last_spawn_at > now() - make_interval(secs => cfg.spawn_cooldown_s) then return 0; end if;
  ss := current_season();
  since := coalesce(ss.starts_at, '-infinity'::timestamptz);
  if ss.id is not null then
    select coalesce(max(h.boost), 1) into boost from hotspots h
     where h.season_id = ss.id and distance_m(h.lat, h.lng, cur.lat, cur.lng) <= h.radius_m;
  end if;
  select count(*) into have from drops
   where caught_by is null and expires_at > now()
     and lat between cur.lat - 0.005 and cur.lat + 0.005
     and lng between cur.lng - 0.007 and cur.lng + 0.007
     and distance_m(lat, lng, cur.lat, cur.lng) <= 500;
  need := greatest(cfg.drops_per_area - have, 0);
  select sum(s.spawn_weight * case when s.season_id = ss.id then boost else 1 end) into total
    from species s where s.season_id is null or s.season_id in (select id from seasons where starts_at <= since);
  for i in 1..need loop
    roll := floor(random() * total)::int;
    select x.id into sp from (
      select s.id, sum(s.spawn_weight * case when s.season_id = ss.id then boost else 1 end) over (order by s.id) as cum
        from species s where s.season_id is null or s.season_id in (select id from seasons where starts_at <= since)) x
     where x.cum > roll order by x.cum limit 1;
    d := 60 + random() * 340;
    b := random() * 2 * pi();
    insert into drops (species_id, lat, lng, expires_at) values (
      sp,
      cur.lat + (d * cos(b)) / 111320,
      cur.lng + (d * sin(b)) / (111320 * cos(radians(cur.lat))),
      now() + make_interval(mins => 10 + floor(random() * 15)::int));
  end loop;
  update profiles set last_spawn_at = now() where id = auth.uid();
  return need;
end $$;

---------------------------------------------------------------------------
-- Catching: Legendary bounty and announcement
---------------------------------------------------------------------------
create or replace function public.catch_drop(p_drop uuid, p_quality real,
  p_gps_lat double precision default null, p_gps_lng double precision default null, p_gps_accuracy double precision default null)
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
    want := case s.rarity when 'l' then cfg.bounty_l when 'r' then cfg.bounty_r when 'u' then cfg.bounty_u else cfg.bounty_c end;
    if has_pass(p) then want := want * cfg.pass_bounty_mult; end if;
    select * into pot from pots where active and remaining > 0 order by id desc limit 1 for update;
    if pot.id is not null then
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
    return jsonb_build_object('result','caught','entries',awarded,'capped',awarded < s.entries + bonus,
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
    'bounty', jsonb_build_object('c', cfg.bounty_c, 'u', cfg.bounty_u, 'r', cfg.bounty_r, 'l', cfg.bounty_l),
    'pot', case when pot.id is null then null else jsonb_build_object('id', pot.id, 'name', pot.name, 'total', pot.total_coins, 'remaining', pot.remaining) end,
    'server_now', now());
end $$;
