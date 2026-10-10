-- Seasons: each 30-day season has its own NFT pass collection, seasonal creatures and hotspot cities.

create table public.seasons (
  id                serial primary key,
  name              text not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  collection        text,                          -- Metaplex Core collection address, set at mint launch
  mint_url          text,                          -- where players mint the pass
  mint_price_tokens numeric,                       -- pass price in the game token
  supply            int,
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.hotspots (
  id        serial primary key,
  season_id int not null references public.seasons(id) on delete cascade,
  name      text not null,
  lat       double precision not null,
  lng       double precision not null,
  radius_m  double precision not null default 3000,
  boost     int not null default 4                  -- seasonal creatures spawn this many times more often here
);

alter table public.species add column season_id int references public.seasons(id);

-- Wallets linked by signature, and the pass NFTs we've seen them hold.
create table public.wallets (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  address     text not null unique check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  verified_at timestamptz not null default now()
);
create table public.wallet_nonces (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  nonce      text not null,
  created_at timestamptz not null default now()
);
create table public.season_passes (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  season_id int not null references public.seasons(id) on delete cascade,
  asset_id  text,
  source    text not null check (source in ('nft','coins','admin')),
  seen_at   timestamptz not null default now(),
  primary key (user_id, season_id)
);

alter table public.game_config add column pass_coins_enabled boolean not null default true; -- in-game pass until the NFT mint is live

alter table public.seasons       enable row level security;
alter table public.hotspots      enable row level security;
alter table public.wallets       enable row level security;
alter table public.wallet_nonces enable row level security;
alter table public.season_passes enable row level security;
create policy "read seasons"  on public.seasons       for select to authenticated using (true);
create policy "read hotspots" on public.hotspots      for select to authenticated using (true);
create policy "own wallet"    on public.wallets       for select to authenticated using (user_id = auth.uid());
create policy "own passes"    on public.season_passes for select to authenticated using (user_id = auth.uid());
grant select on public.seasons, public.hotspots, public.wallets, public.season_passes to authenticated;
revoke all on public.seasons, public.hotspots, public.wallets, public.wallet_nonces, public.season_passes from anon;

create function public.current_season() returns public.seasons
language sql stable set search_path = public as $$
  select * from seasons where starts_at <= now() and ends_at > now() order by starts_at desc limit 1
$$;
revoke execute on function public.current_season() from public, anon, authenticated;

---------------------------------------------------------------------------
-- Season 1 and its creatures (original designs)
---------------------------------------------------------------------------
insert into public.seasons (name, starts_at, ends_at, supply, mint_price_tokens)
values ('Season 1: Lantern Run', now(), now() + interval '30 days', 111, 5000);

insert into public.species (id, name, rarity, entries, xp, catch_chance, flee_chance, spawn_weight, season_id) values
  (8,  'Tidepup',     'c', 1, 12, 0.80, 0.12, 8, 1),
  (9,  'Lanternfox',  'u', 2, 30, 0.65, 0.25, 5, 1),
  (10, 'Glimmerwing', 'u', 2, 30, 0.65, 0.25, 5, 1),
  (11, 'Vaultdrake',  'r', 5, 80, 0.45, 0.45, 2, 1);

insert into public.hotspots (season_id, name, lat, lng, radius_m, boost) values
  (1, 'Times Square, New York', 40.7580, -73.9855, 3000, 4),
  (1, 'Shibuya, Tokyo',         35.6595, 139.7005, 3000, 4),
  (1, 'Covent Garden, London',  51.5117, -0.1240,  3000, 4),
  (1, 'The Louvre, Paris',      48.8606,  2.3376,  3000, 4),
  (1, 'Santa Monica Pier, LA',  34.0094, -118.4973, 3000, 4),
  (1, 'Uptown Charlotte',       35.2271, -80.8431, 4000, 4);

---------------------------------------------------------------------------
-- Spawning: seasonal creatures only during their season, boosted in hotspots
---------------------------------------------------------------------------
create or replace function public.spawn_here() returns int
language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; cur record; have int; need int; i int; d float8; b float8;
  sp smallint; total int; roll int; ss seasons; boost int := 1;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;
  select * into cur from explorer_now(p);
  if cur.lat is null or not cur.arrived then return 0; end if;
  if p.last_spawn_at is not null and p.last_spawn_at > now() - make_interval(secs => cfg.spawn_cooldown_s) then return 0; end if;

  ss := current_season();
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

  select sum(s.spawn_weight * case when s.season_id is not null then boost else 1 end) into total
    from species s where s.season_id is null or s.season_id = ss.id;

  for i in 1..need loop
    roll := floor(random() * total)::int;
    select x.id into sp from (
      select s.id, sum(s.spawn_weight * case when s.season_id is not null then boost else 1 end) over (order by s.id) as cum
        from species s where s.season_id is null or s.season_id = ss.id) x
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
-- Pass: the in-game coin pass now lasts until the season ends
---------------------------------------------------------------------------
create or replace function public.buy_pass() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; bal bigint; p profiles; ss seasons; until_t timestamptz;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  if not cfg.pass_coins_enabled then return jsonb_build_object('error','nft_only'); end if;
  ss := current_season();
  select * into p from profiles where id = auth.uid();
  if has_pass(p) then return jsonb_build_object('error','already'); end if;
  bal := spend_coins(auth.uid(), cfg.pass_price, 'season_pass');
  if bal < 0 then return jsonb_build_object('error','coins','cost',cfg.pass_price); end if;
  until_t := coalesce(ss.ends_at, now() + make_interval(days => cfg.pass_days));
  update profiles set pass_until = until_t where id = auth.uid();
  if ss.id is not null then
    insert into season_passes (user_id, season_id, source) values (auth.uid(), ss.id, 'coins')
      on conflict (user_id, season_id) do nothing;
  end if;
  return jsonb_build_object('coins', bal, 'pass_until', until_t);
end $$;

-- Message the player signs to prove they own a wallet (no transaction, no fees).
create function public.wallet_challenge() returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  n := replace(gen_random_uuid()::text, '-', '');
  insert into wallet_nonces (user_id, nonce) values (auth.uid(), n)
    on conflict (user_id) do update set nonce = excluded.nonce, created_at = now();
  return 'Vault Hunt wants you to link this wallet to your player.' || chr(10) ||
         'This does not move any funds.' || chr(10) || 'Nonce: ' || n;
end $$;

create function public.season_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ss seasons; cfg game_config;
begin
  select * into cfg from game_config;
  ss := current_season();
  if ss.id is null then return null; end if;
  return jsonb_build_object('id', ss.id, 'name', ss.name, 'starts_at', ss.starts_at, 'ends_at', ss.ends_at,
    'collection', ss.collection, 'mint_url', ss.mint_url, 'mint_price_tokens', ss.mint_price_tokens, 'supply', ss.supply,
    'pass_coins_enabled', cfg.pass_coins_enabled,
    'minted', (select count(*) from season_passes where season_id = ss.id and source = 'nft'),
    'species', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from species where season_id = ss.id),
    'hotspots', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'lat', lat, 'lng', lng, 'radius_m', radius_m) order by id), '[]'::jsonb)
                   from hotspots where season_id = ss.id),
    'server_now', now());
end $$;

-- Admin: start a new season and set its mint details.
create function public.admin_set_season_mint(p_collection text, p_mint_url text, p_price numeric, p_supply int) returns void
language plpgsql security definer set search_path = public as $$
declare ss seasons;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  ss := current_season();
  if ss.id is null then raise exception 'no active season'; end if;
  update seasons set collection = nullif(trim(p_collection), ''), mint_url = nullif(trim(p_mint_url), ''),
    mint_price_tokens = p_price, supply = p_supply where id = ss.id;
end $$;

create function public.admin_start_season(p_name text, p_days int) returns int
language plpgsql security definer set search_path = public as $$
declare sid int;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update seasons set ends_at = now() where ends_at > now();
  insert into seasons (name, starts_at, ends_at) values (p_name, now(), now() + make_interval(days => p_days)) returning id into sid;
  return sid;
end $$;

-- Used by the server-side pass check (service role only).
create function public.grant_nft_pass(p_user uuid, p_season int, p_asset text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ss seasons;
begin
  select * into ss from seasons where id = p_season;
  if ss.id is null or ss.ends_at <= now() then return null; end if;
  update profiles set pass_until = greatest(coalesce(pass_until, now()), ss.ends_at) where id = p_user;
  insert into season_passes (user_id, season_id, asset_id, source) values (p_user, p_season, p_asset, 'nft')
    on conflict (user_id, season_id) do update set asset_id = excluded.asset_id, source = 'nft', seen_at = now();
  return ss.ends_at;
end $$;

revoke all on function public.grant_nft_pass(uuid, int, text) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then
  execute 'grant execute on function public.grant_nft_pass(uuid, int, text) to service_role'; end if; end $$;
revoke all on function public.wallet_challenge(), public.season_info(), public.admin_set_season_mint(text, text, numeric, int),
  public.admin_start_season(text, int) from public, anon;
grant execute on function public.wallet_challenge(), public.season_info(), public.admin_set_season_mint(text, text, numeric, int),
  public.admin_start_season(text, int) to authenticated;
