-- Season Passes are minted during the season BEFORE the one they power up, with their tier hidden.
-- When the pass's season starts, every minted pass gets its tier from public drand randomness (a round fixed in
-- advance: the first one about a minute after the season starts, so it doesn't exist while anyone can still mint).
-- The deck (e.g. 294 Common, 84 Uncommon, 30 Rare, 9 Epic, 3 Legendary for 420) is shuffled with that randomness and
-- dealt to the minted passes in address order. Anyone can redo it on /verify.
-- NFT passes count only while linked to the account that holds the NFT (season_passes.asset_id set); a pass that
-- moves to another account is unlinked from the old one.
alter table public.seasons
  add column if not exists reveal_round bigint,
  add column if not exists reveal_randomness text,
  add column if not exists revealed_at timestamptz,
  add column if not exists tier_split int[];

create table if not exists public.season_pass_assets (
  season_id int not null references public.seasons(id) on delete cascade,
  asset_id text not null,
  position int not null,
  tier int not null check (tier between 1 and 5),
  primary key (season_id, asset_id)
);
alter table public.season_pass_assets enable row level security;
create policy "read revealed passes" on public.season_pass_assets for select using (true);
revoke insert, update, delete on public.season_pass_assets from anon, authenticated;

-- Pass perks: a coin pass (pass_until) or an NFT pass linked for the current season.
create or replace function public.has_pass(p profiles) returns boolean
language sql stable set search_path = public as $$
  select coalesce(p.pass_until > now(), false)
      or exists (select 1 from season_passes sp where sp.user_id = p.id and sp.season_id = (current_season()).id
                  and sp.source = 'nft' and sp.asset_id is not null)
$$;

create or replace function public.pass_tier(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select sp.tier from season_passes sp
     where sp.user_id = p_user and sp.season_id = (current_season()).id and sp.source = 'nft' and sp.asset_id is not null), 0)
$$;

-- drand quicknet: the first round at least 60 s after the given time.
create or replace function public.drand_round_after(p_at timestamptz) returns bigint
language sql immutable as $$
  select floor((extract(epoch from p_at) + 60 - 1692803367) / 3)::bigint + 2
$$;

-- Default tier deck for a supply: ~70 / 20 / 7 / 2 / rest (at least 1 Legendary). Same rounding as make-metadata.ts.
create or replace function public.default_tier_split(p_supply int) returns int[]
language sql immutable as $$
  select array[c, u, r, e, greatest(1, p_supply - c - u - r - e)]
  from (select round(p_supply * 0.7)::int c, round(p_supply * 0.2)::int u, round(p_supply * 0.0715)::int r, round(p_supply * 0.0215)::int e) x
$$;

-- The season whose pass is on sale now: the next season to start (its mint runs until it starts).
create or replace function public.next_pass_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
    'collection', s.collection, 'candy_machine', s.candy_machine, 'supply', s.supply,
    'tier_split', coalesce(s.tier_split, default_tier_split(coalesce(s.supply, 420))), 'reveal_round', s.reveal_round,
    'mine', (select sp.asset_id from season_passes sp where sp.season_id = s.id and sp.user_id = auth.uid() and sp.asset_id is not null))
  from seasons s where s.starts_at > now() order by s.starts_at limit 1
$$;

-- Admin: set up the pass mint for a season (normally the next one). The reveal round is fixed from its start time.
create or replace function public.admin_set_pass_mint(p_season int, p_collection text, p_candy_machine text, p_supply int, p_split int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ss seasons; sp int[]; sup int;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into ss from seasons where id = p_season;
  if ss.id is null then raise exception 'no such season'; end if;
  if ss.revealed_at is not null then raise exception 'this season''s passes are already revealed'; end if;
  if coalesce(p_collection, '') <> '' and p_collection !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then raise exception 'collection is not a Solana address'; end if;
  if coalesce(p_candy_machine, '') <> '' and p_candy_machine !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then raise exception 'candy machine is not a Solana address'; end if;
  sup := coalesce(p_supply, ss.supply, 420);
  sp := coalesce(p_split, default_tier_split(sup));
  if array_length(sp, 1) <> 5 or (select sum(x) from unnest(sp) x) <> sup then
    raise exception 'tier split must be 5 numbers adding up to the supply';
  end if;
  update seasons set collection = nullif(p_collection, ''), candy_machine = nullif(p_candy_machine, ''),
    supply = sup, tier_split = sp, reveal_round = drand_round_after(starts_at) where id = ss.id;
  return next_pass_info();
end $$;

-- Server only: link a pass NFT to the account holding it. The current holder wins: an NFT that moved is unlinked
-- from the previous account. Tier comes from the reveal (0 until then).
create or replace function public.register_season_pass(p_user uuid, p_season int, p_asset text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ss seasons; t int;
begin
  select * into ss from seasons where id = p_season;
  if ss.id is null or ss.ends_at <= now() then return jsonb_build_object('error','season_over'); end if;
  select tier into t from season_pass_assets where season_id = p_season and asset_id = p_asset;
  update season_passes set asset_id = null, tier = 0, seen_at = now()
   where season_id = p_season and asset_id = p_asset and user_id <> p_user;
  insert into season_passes (user_id, season_id, asset_id, source, tier) values (p_user, p_season, p_asset, 'nft', coalesce(t, 0))
    on conflict (user_id, season_id) do update set asset_id = excluded.asset_id, source = 'nft', tier = excluded.tier, seen_at = now();
  return jsonb_build_object('season', ss.id, 'tier', coalesce(t, 0), 'active', ss.starts_at <= now(), 'starts_at', ss.starts_at);
end $$;

-- Server only: seasons that have started, have a collection, and aren't revealed yet.
create or replace function public.pass_reveals_due() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'collection', collection, 'reveal_round', reveal_round,
    'split', coalesce(tier_split, default_tier_split(coalesce(supply, 420)))) order by id), '[]'::jsonb)
  from seasons where collection is not null and reveal_round is not null and revealed_at is null and starts_at <= now()
$$;

-- Server only: store the reveal and give linked holders their tier.
create or replace function public.store_pass_reveal(p_season int, p_randomness text, p_assets jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare ss seasons; n int;
begin
  select * into ss from seasons where id = p_season for update;
  if ss.id is null or ss.revealed_at is not null then return 0; end if;
  insert into season_pass_assets (season_id, asset_id, position, tier)
    select p_season, a->>'asset', (a->>'position')::int, (a->>'tier')::int from jsonb_array_elements(p_assets) a;
  get diagnostics n = row_count;
  update seasons set reveal_randomness = p_randomness, revealed_at = now() where id = p_season;
  update season_passes sp set tier = a.tier from season_pass_assets a
   where sp.season_id = p_season and a.season_id = p_season and a.asset_id = sp.asset_id;
  return n;
end $$;

-- Public: everything to check a season's reveal.
create or replace function public.pass_reveal_public(p_season int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'collection', s.collection,
    'reveal_round', s.reveal_round, 'randomness', s.reveal_randomness, 'revealed_at', s.revealed_at,
    'split', coalesce(s.tier_split, default_tier_split(coalesce(s.supply, 420))),
    'assets', coalesce((select jsonb_agg(jsonb_build_object('asset', a.asset_id, 'position', a.position, 'tier', a.tier) order by a.position)
      from season_pass_assets a where a.season_id = s.id), '[]'::jsonb))
  from seasons s where s.id = p_season
$$;

create or replace function public.season_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ss seasons; cfg game_config;
begin
  select * into cfg from game_config;
  ss := current_season();
  if ss.id is null then return null; end if;
  return jsonb_build_object('id', ss.id, 'name', ss.name, 'starts_at', ss.starts_at, 'ends_at', ss.ends_at,
    'collection', ss.collection, 'mint_url', ss.mint_url, 'mint_price_tokens', ss.mint_price_tokens, 'supply', ss.supply,
    'candy_machine', ss.candy_machine, 'cluster', cfg.token_cluster, 'revealed', ss.revealed_at is not null,
    'has_whitelist', false, 'next_pass', next_pass_info(),
    'pass_coins_enabled', cfg.pass_coins_enabled,
    'minted', (select count(*) from season_passes where season_id = ss.id and source = 'nft' and asset_id is not null),
    'species', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from species where season_id = ss.id),
    'hotspots', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'lat', lat, 'lng', lng, 'radius_m', radius_m) order by id), '[]'::jsonb)
                   from hotspots where season_id = ss.id),
    'server_now', now());
end $$;

revoke execute on function public.register_season_pass(uuid, int, text), public.pass_reveals_due(), public.store_pass_reveal(int, text, jsonb),
  public.drand_round_after(timestamptz), public.default_tier_split(int) from public, anon, authenticated;
grant execute on function public.register_season_pass(uuid, int, text), public.pass_reveals_due(), public.store_pass_reveal(int, text, jsonb) to service_role;
revoke execute on function public.admin_set_pass_mint(int, text, text, int, int[]), public.next_pass_info() from public, anon;
grant execute on function public.admin_set_pass_mint(int, text, text, int, int[]), public.next_pass_info() to authenticated;
revoke execute on function public.pass_reveal_public(int) from public;
grant execute on function public.pass_reveal_public(int) to anon, authenticated;
