-- In-app Season Pass mint: the game knows each season's Core Candy Machine and the exact whitelist it was built
-- with (so it can make Merkle proofs). The whitelist stays private: only the passmint function reads it.
alter table public.seasons add column if not exists candy_machine text;

create table if not exists public.season_whitelists (
  season_id int primary key references public.seasons(id) on delete cascade,
  addresses text[] not null,
  merkle_root text not null,
  saved_at timestamptz not null default now()
);
alter table public.season_whitelists enable row level security;
revoke all on public.season_whitelists from anon, authenticated;

-- One pass NFT turns on the pass for one account per season.
create unique index if not exists season_passes_one_asset on public.season_passes (season_id, asset_id) where asset_id is not null;

create or replace function public.admin_set_candy_machine(p_candy_machine text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ss seasons;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_candy_machine is not null and p_candy_machine <> '' and p_candy_machine !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    raise exception 'not a Solana address';
  end if;
  ss := current_season();
  if ss.id is null then raise exception 'no active season'; end if;
  update seasons set candy_machine = nullif(p_candy_machine, '') where id = ss.id;
  return season_info();
end $$;

create or replace function public.season_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ss seasons; cfg game_config;
begin
  select * into cfg from game_config;
  ss := current_season();
  if ss.id is null then return null; end if;
  return jsonb_build_object('id', ss.id, 'name', ss.name, 'starts_at', ss.starts_at, 'ends_at', ss.ends_at,
    'collection', ss.collection, 'mint_url', ss.mint_url, 'mint_price_tokens', ss.mint_price_tokens, 'supply', ss.supply,
    'candy_machine', ss.candy_machine, 'cluster', cfg.token_cluster,
    'has_whitelist', exists (select 1 from season_whitelists w where w.season_id = ss.id),
    'pass_coins_enabled', cfg.pass_coins_enabled,
    'minted', (select count(*) from season_passes where season_id = ss.id and source = 'nft'),
    'species', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from species where season_id = ss.id),
    'hotspots', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'lat', lat, 'lng', lng, 'radius_m', radius_m) order by id), '[]'::jsonb)
                   from hotspots where season_id = ss.id),
    'server_now', now());
end $$;

revoke execute on function public.admin_set_candy_machine(text) from public, anon;
grant execute on function public.admin_set_candy_machine(text) to authenticated;
