-- Daily throws: every player gets free throws each day (UTC), then can buy packs with earned coins.
-- Coins are earned in the game only, so nothing here sells throws for money or the token.
alter table game_config
  add column if not exists free_throws_per_day int not null default 30,
  add column if not exists throw_pack_size int not null default 10,
  add column if not exists throw_pack_price int not null default 50;

alter table profiles
  add column if not exists throws_day date,
  add column if not exists throws_used int not null default 0,
  add column if not exists bonus_throws int not null default 0;

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
  -- Each throw uses one of today's free throws, then a bought one.
  if p.throws_day is distinct from (now() at time zone 'utc')::date then
    update profiles set throws_day = (now() at time zone 'utc')::date, throws_used = 0 where id = auth.uid() returning * into p;
  end if;
  if p.throws_used < cfg.free_throws_per_day then
    update profiles set throws_used = throws_used + 1 where id = auth.uid();
  elsif p.bonus_throws > 0 then
    update profiles set bonus_throws = bonus_throws - 1 where id = auth.uid();
  else
    return jsonb_build_object('result','no_throws','pack_size',cfg.throw_pack_size,'pack_price',cfg.throw_pack_price);
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
    'throws_free', cfg.free_throws_per_day,
    'throws_used', case when p.throws_day = (now() at time zone 'utc')::date then p.throws_used else 0 end,
    'bonus_throws', p.bonus_throws,
    'throw_pack_size', cfg.throw_pack_size, 'throw_pack_price', cfg.throw_pack_price,
    'throws_reset_at', (((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc'),
    'server_now', now());
end $$;

create or replace function public.buy_throws(p_packs int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; bal bigint; cost bigint; b int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_packs is null or p_packs < 1 or p_packs > 10 then return jsonb_build_object('error','packs'); end if;
  select * into cfg from game_config;
  cost := p_packs::bigint * cfg.throw_pack_price;
  bal := spend_coins(auth.uid(), cost, 'throws');
  if bal < 0 then return jsonb_build_object('error','coins','cost',cost); end if;
  update profiles set bonus_throws = bonus_throws + p_packs * cfg.throw_pack_size
   where id = auth.uid() returning bonus_throws into b;
  return jsonb_build_object('coins', bal, 'bonus_throws', b);
end $$;
