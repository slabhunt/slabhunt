-- Token economy (in-game balance first; on-chain deposits/withdrawals come later).
-- Flywheel: pots pay creature bounties -> players spend coins on travel, sight and gacha
-- -> each spend is split into the next pot, card buying, burn and team.

---------------------------------------------------------------------------
-- Settings
---------------------------------------------------------------------------
alter table public.game_config
  add column starter_coins      int not null default 200,
  add column free_hop_m         double precision not null default 2000,  -- trips up to 2 km are free
  add column travel_km_per_coin double precision not null default 50,    -- then 1 coin per 50 km
  add column travel_base_coins  int not null default 2,
  add column travel_max_coins   int not null default 50,
  add column base_sight_m       double precision not null default 300,
  add column holder_sight_m     double precision not null default 700,   -- holding a rare vault card
  add column boost_sight_m      double precision not null default 1000,
  add column boost_cost         int not null default 25,
  add column boost_minutes      int not null default 30,
  add column bounty_c           int not null default 5,
  add column bounty_u           int not null default 15,
  add column bounty_r           int not null default 50,
  add column pull_price         int not null default 100,
  add column turbo_buyback_pct  int not null default 85,
  add column sellback_days      int not null default 3,
  add column split_pot_pct      int not null default 50,
  add column split_cards_pct    int not null default 30,
  add column split_burn_pct     int not null default 10,
  add column split_team_pct     int not null default 10;

alter table public.profiles
  add column coins             bigint not null default 0 check (coins >= 0),
  add column vault_holder      boolean not null default false,
  add column sight_boost_until timestamptz;

---------------------------------------------------------------------------
-- Ledger, pots, treasury flows
---------------------------------------------------------------------------
create table public.coin_ledger (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  delta      bigint not null,
  reason     text not null,
  ref        text,
  created_at timestamptz not null default now()
);
create index coin_ledger_user on public.coin_ledger (user_id, created_at desc);

create table public.pots (
  id          serial primary key,
  name        text not null,
  total_coins bigint not null,
  remaining   bigint not null check (remaining >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.treasury_flows (
  id         bigserial primary key,
  source     text not null,
  user_id    uuid references public.profiles(id) on delete set null,
  amount     bigint not null,
  to_pot     bigint not null,
  to_cards   bigint not null,
  to_burn    bigint not null,
  to_team    bigint not null,
  created_at timestamptz not null default now()
);

---------------------------------------------------------------------------
-- Gacha machine
---------------------------------------------------------------------------
create table public.gacha_odds (
  tier   text primary key check (tier in ('common','uncommon','rare','epic')),
  weight int not null,
  sort   int not null
);
insert into public.gacha_odds values ('common',7500,1),('uncommon',2000,2),('rare',400,3),('epic',100,4);

create table public.gacha_cards (
  id          bigserial primary key,
  name        text not null,
  grade       text not null default '',
  tier        text not null references public.gacha_odds(tier),
  value_coins int not null check (value_coins > 0),
  image_url   text,
  mint        text,
  status      text not null default 'pool' check (status in ('pool','won','shipped')),
  won_by      uuid references public.profiles(id),
  won_at      timestamptz,
  created_at  timestamptz not null default now()
);
create index gacha_cards_pool on public.gacha_cards (tier) where status = 'pool';

create table public.gacha_pulls (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  card_id    bigint not null references public.gacha_cards(id),
  tier       text not null,
  price      int not null,
  auto_sold  boolean not null default false,
  sold_back  boolean not null default false,
  buyback    int not null default 0,
  created_at timestamptz not null default now()
);
create index gacha_pulls_user on public.gacha_pulls (user_id, created_at desc);

---------------------------------------------------------------------------
-- Access
---------------------------------------------------------------------------
alter table public.coin_ledger    enable row level security;
alter table public.pots           enable row level security;
alter table public.treasury_flows enable row level security;
alter table public.gacha_odds     enable row level security;
alter table public.gacha_cards    enable row level security;
alter table public.gacha_pulls    enable row level security;

create policy "own ledger"   on public.coin_ledger for select to authenticated using (user_id = auth.uid());
create policy "read pots"    on public.pots        for select to authenticated using (true);
create policy "admin flows"  on public.treasury_flows for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));
create policy "read odds"    on public.gacha_odds  for select to authenticated using (true);
create policy "read cards"   on public.gacha_cards for select to authenticated using (true);
create policy "own pulls"    on public.gacha_pulls for select to authenticated using (user_id = auth.uid());

grant select on public.coin_ledger, public.pots, public.treasury_flows, public.gacha_odds,
  public.gacha_cards, public.gacha_pulls to authenticated;
revoke all on public.coin_ledger, public.pots, public.treasury_flows, public.gacha_odds,
  public.gacha_cards, public.gacha_pulls from anon;

-- Fog of war: creatures are only visible through visible_drops(), never by reading the table.
alter policy "read drops" on public.drops using (false);

---------------------------------------------------------------------------
-- Internal helpers (not callable from the app)
---------------------------------------------------------------------------
create function public.add_coins(p_user uuid, p_delta bigint, p_reason text, p_ref text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare bal bigint;
begin
  update profiles set coins = coins + p_delta where id = p_user returning coins into bal;
  if bal is null then raise exception 'no such player'; end if;
  if bal < 0 then raise exception 'not enough coins'; end if;
  insert into coin_ledger (user_id, delta, reason, ref) values (p_user, p_delta, p_reason, p_ref);
  return bal;
end $$;

-- Charge a player and split the spend across the flywheel.
create function public.spend_coins(p_user uuid, p_amount bigint, p_source text, p_ref text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare cfg game_config; bal bigint; pot_share bigint; cards bigint; burn bigint; team bigint; pid int;
begin
  if p_amount <= 0 then select coins into bal from profiles where id = p_user; return bal; end if;
  select * into cfg from game_config;
  select coins into bal from profiles where id = p_user for update;
  if bal < p_amount then return -1; end if;
  bal := add_coins(p_user, -p_amount, p_source, p_ref);
  pot_share := p_amount * cfg.split_pot_pct / 100;
  cards     := p_amount * cfg.split_cards_pct / 100;
  burn      := p_amount * cfg.split_burn_pct / 100;
  team      := p_amount - pot_share - cards - burn;
  select id into pid from pots where active order by id desc limit 1;
  if pid is not null then
    update pots set remaining = remaining + pot_share, total_coins = total_coins + pot_share where id = pid;
  end if;
  insert into treasury_flows (source, user_id, amount, to_pot, to_cards, to_burn, to_team)
    values (p_source, p_user, p_amount, pot_share, cards, burn, team);
  return bal;
end $$;

create function public.sight_m(p public.profiles) returns float8
language sql stable set search_path = public as $$
  select greatest(
    c.base_sight_m,
    case when p.vault_holder then c.holder_sight_m else 0 end,
    case when p.sight_boost_until > now() then c.boost_sight_m else 0 end)
  from game_config c
$$;

revoke execute on function public.add_coins(uuid, bigint, text, text),
  public.spend_coins(uuid, bigint, text, text), public.sight_m(public.profiles) from public, anon, authenticated;

---------------------------------------------------------------------------
-- Starter coins for everyone (new and existing players)
---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg game_config;
begin
  select * into cfg from game_config;
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(split_part(new.email,'@',1),''),'Hunter'), 24));
  perform add_coins(new.id, cfg.starter_coins, 'starter');
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

do $$ declare r record; s int; begin
  select starter_coins into s from public.game_config;
  for r in select id from public.profiles where coins = 0 loop
    perform public.add_coins(r.id, s, 'starter');
  end loop;
end $$;

---------------------------------------------------------------------------
-- Player-facing functions
---------------------------------------------------------------------------
create function public.my_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; cfg game_config; pot pots;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from profiles where id = auth.uid();
  select * into cfg from game_config;
  select * into pot from pots where active order by id desc limit 1;
  return jsonb_build_object(
    'coins', p.coins, 'sight_m', sight_m(p), 'vault_holder', p.vault_holder,
    'boost_until', p.sight_boost_until, 'boost_cost', cfg.boost_cost, 'boost_minutes', cfg.boost_minutes,
    'free_hop_m', cfg.free_hop_m, 'km_per_coin', cfg.travel_km_per_coin,
    'travel_base', cfg.travel_base_coins, 'travel_max', cfg.travel_max_coins,
    'pull_price', cfg.pull_price, 'turbo_pct', cfg.turbo_buyback_pct, 'sellback_days', cfg.sellback_days,
    'bounty', jsonb_build_object('c', cfg.bounty_c, 'u', cfg.bounty_u, 'r', cfg.bounty_r),
    'pot', case when pot.id is null then null else jsonb_build_object('id', pot.id, 'name', pot.name, 'total', pot.total_coins, 'remaining', pot.remaining) end,
    'server_now', now());
end $$;

-- Creatures within your explorer's sight range.
create function public.visible_drops()
returns table (id uuid, species_id smallint, lat float8, lng float8, expires_at timestamptz, caught_by uuid)
language plpgsql stable security definer set search_path = public as $$
declare p profiles; cur record; r float8; dlat float8; dlng float8;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from profiles pr where pr.id = auth.uid();
  select * into cur from explorer_now(p);
  if cur.lat is null then return; end if;
  r := sight_m(p);
  dlat := r / 111320.0; dlng := r / (111320.0 * greatest(cos(radians(cur.lat)), 0.01));
  return query
    select d.id, d.species_id, d.lat, d.lng, d.expires_at, d.caught_by from drops d
     where d.caught_by is null and d.expires_at > now()
       and d.lat between cur.lat - dlat and cur.lat + dlat
       and d.lng between cur.lng - dlng and cur.lng + dlng
       and distance_m(d.lat, d.lng, cur.lat, cur.lng) <= r
     limit 200;
end $$;

-- Paid sight boost.
create function public.buy_sight_boost() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; bal bigint; p profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  bal := spend_coins(auth.uid(), cfg.boost_cost, 'sight_boost');
  if bal < 0 then return jsonb_build_object('error','coins','cost',cfg.boost_cost); end if;
  update profiles set sight_boost_until = greatest(coalesce(sight_boost_until, now()), now()) + make_interval(mins => cfg.boost_minutes)
   where id = auth.uid() returning * into p;
  return jsonb_build_object('coins', bal, 'boost_until', p.sight_boost_until, 'sight_m', sight_m(p));
end $$;

-- Travel: free short hops, coins for long trips.
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

-- Catching now also pays a coin bounty from the active pot.
create or replace function public.catch_drop(p_drop uuid, p_quality real,
  p_gps_lat float8 default null, p_gps_lng float8 default null, p_gps_accuracy float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; d drops; s species; cur record; r int; chance float8;
  walked boolean := false; bonus int := 0; recent int; pot pots; want int; paid int := 0; bal bigint;
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
    select id into r from rounds where status = 'open';
    update drops set caught_by = auth.uid(), caught_at = now() where id = d.id;
    insert into catches (user_id, drop_id, species_id, round_id, entries, xp)
      values (auth.uid(), d.id, s.id, r, s.entries + bonus, s.xp);
    update profiles set xp = xp + s.xp, catches = catches + 1 where id = auth.uid();
    -- bounty from the active pot
    want := case s.rarity when 'r' then cfg.bounty_r when 'u' then cfg.bounty_u else cfg.bounty_c end;
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
    return jsonb_build_object('result','caught','entries',s.entries + bonus,'xp',s.xp,'species',s.id,
      'walked',walked,'coins_won',paid);
  elsif random() < s.flee_chance then
    update drops set expires_at = now() where id = d.id;
    return jsonb_build_object('result','fled');
  else
    return jsonb_build_object('result','escaped');
  end if;
end $$;

-- Rip a gacha pull. Turbo auto-sells Commons back for coins.
create function public.gacha_pull(p_turbo boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; bal bigint; total int; roll int; t text; c gacha_cards; buy int := 0; pid bigint; auto boolean := false;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  -- only tiers that still have cards can be drawn
  select sum(o.weight) into total from gacha_odds o
   where exists (select 1 from gacha_cards g where g.tier = o.tier and g.status = 'pool');
  if total is null then return jsonb_build_object('error','empty'); end if;

  bal := spend_coins(auth.uid(), cfg.pull_price, 'gacha');
  if bal < 0 then return jsonb_build_object('error','coins','cost',cfg.pull_price); end if;

  roll := floor(random() * total)::int;
  select x.tier into t from (
    select o.tier, sum(o.weight) over (order by o.sort) as cum from gacha_odds o
     where exists (select 1 from gacha_cards g where g.tier = o.tier and g.status = 'pool')) x
   where x.cum > roll order by x.cum limit 1;

  select * into c from gacha_cards where tier = t and status = 'pool' order by random() limit 1 for update skip locked;
  if c.id is null then
    bal := add_coins(auth.uid(), cfg.pull_price, 'gacha_refund');
    return jsonb_build_object('error','busy');
  end if;

  if t = 'common' and p_turbo then
    auto := true;
    buy := c.value_coins * cfg.turbo_buyback_pct / 100;
    bal := add_coins(auth.uid(), buy, 'turbo_sell', c.id::text);
  else
    update gacha_cards set status = 'won', won_by = auth.uid(), won_at = now() where id = c.id;
  end if;
  insert into gacha_pulls (user_id, card_id, tier, price, auto_sold, buyback)
    values (auth.uid(), c.id, t, cfg.pull_price, auto, buy) returning id into pid;
  if t in ('rare','epic') then
    insert into chat_messages (user_id, kind, body)
      values (auth.uid(), 'catch', 'ripped ' || c.name || case when c.grade <> '' then ' ' || c.grade else '' end || ' (' || t || ')!');
  end if;
  return jsonb_build_object('pull_id', pid, 'tier', t, 'card', jsonb_build_object(
      'id', c.id, 'name', c.name, 'grade', c.grade, 'value', c.value_coins, 'image_url', c.image_url),
    'auto_sold', auto, 'buyback', buy, 'coins', bal);
end $$;

-- Sell a won card back within the window.
create function public.gacha_sell_back(p_pull bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; g gacha_pulls; c gacha_cards; buy int; bal bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into g from gacha_pulls where id = p_pull and user_id = auth.uid() for update;
  if g.id is null or g.auto_sold or g.sold_back then return jsonb_build_object('error','not_sellable'); end if;
  if g.created_at < now() - make_interval(days => cfg.sellback_days) then return jsonb_build_object('error','expired'); end if;
  select * into c from gacha_cards where id = g.card_id for update;
  if c.status <> 'won' or c.won_by <> auth.uid() then return jsonb_build_object('error','not_sellable'); end if;
  buy := c.value_coins * cfg.turbo_buyback_pct / 100;
  update gacha_cards set status = 'pool', won_by = null, won_at = null where id = c.id;
  update gacha_pulls set sold_back = true, buyback = buy where id = g.id;
  bal := add_coins(auth.uid(), buy, 'sell_back', c.id::text);
  return jsonb_build_object('buyback', buy, 'coins', bal);
end $$;

---------------------------------------------------------------------------
-- Admin tools
---------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create function public.admin_create_pot(p_name text, p_coins bigint) returns int
language plpgsql security definer set search_path = public as $$
declare pid int;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_coins <= 0 then raise exception 'pot must be positive'; end if;
  update pots set active = false where active;
  insert into pots (name, total_coins, remaining) values (coalesce(nullif(trim(p_name),''),'Pot'), p_coins, p_coins) returning id into pid;
  return pid;
end $$;

create function public.admin_add_card(p_name text, p_grade text, p_tier text, p_value int, p_image_url text, p_mint text)
returns bigint language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  insert into gacha_cards (name, grade, tier, value_coins, image_url, mint)
    values (trim(p_name), coalesce(p_grade,''), p_tier, p_value, nullif(trim(p_image_url),''), nullif(trim(p_mint),''))
    returning id into cid;
  return cid;
end $$;

create function public.admin_grant_coins(p_user uuid, p_amount bigint) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return add_coins(p_user, p_amount, 'admin_grant');
end $$;

create function public.admin_set_holder(p_user uuid, p_holder boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update profiles set vault_holder = p_holder where id = p_user;
end $$;

create function public.admin_treasury() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'spent', coalesce((select sum(amount) from treasury_flows), 0),
    'to_pot', coalesce((select sum(to_pot) from treasury_flows), 0),
    'to_cards', coalesce((select sum(to_cards) from treasury_flows), 0),
    'to_burn', coalesce((select sum(to_burn) from treasury_flows), 0),
    'to_team', coalesce((select sum(to_team) from treasury_flows), 0),
    'coins_in_wallets', coalesce((select sum(coins) from profiles), 0),
    'cards_in_pool', (select count(*) from gacha_cards where status = 'pool'),
    'cards_won', (select count(*) from gacha_cards where status = 'won'));
end $$;

revoke all on function public.my_status(), public.visible_drops(), public.buy_sight_boost(),
  public.gacha_pull(boolean), public.gacha_sell_back(bigint), public.is_admin(),
  public.admin_create_pot(text, bigint), public.admin_add_card(text, text, text, int, text, text),
  public.admin_grant_coins(uuid, bigint), public.admin_set_holder(uuid, boolean), public.admin_treasury()
  from public, anon;
grant execute on function public.my_status(), public.visible_drops(), public.buy_sight_boost(),
  public.gacha_pull(boolean), public.gacha_sell_back(bigint), public.is_admin(),
  public.admin_create_pot(text, bigint), public.admin_add_card(text, text, text, int, text, text),
  public.admin_grant_coins(uuid, bigint), public.admin_set_holder(uuid, boolean), public.admin_treasury()
  to authenticated;

alter publication supabase_realtime add table public.pots;
