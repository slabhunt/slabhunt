-- Tiered Season Pass NFTs. Each pass has a Tier attribute: Common 1, Uncommon 2, Rare 3, Epic 4, Legendary 5.
-- While the season runs, the tier adds that many free power-up levels to every track (throws, speed, sight),
-- on top of any levels the player bought, up to the max of 5. Legendary maxes everything. Coin passes have tier 0.
alter table public.season_passes add column if not exists tier int not null default 0 check (tier between 0 and 5);

-- Pass tier for the current season (0 = none).
create or replace function public.pass_tier(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select sp.tier from season_passes sp join profiles p on p.id = sp.user_id
     where sp.user_id = p_user and sp.season_id = (current_season()).id and p.pass_until > now()), 0)
$$;

-- Effective levels: bought levels + pass tier, capped at the max level.
create or replace function public.upgrade_levels(p_user uuid)
returns table(points integer, throws_lvl integer, speed_lvl integer, sight_lvl integer)
language sql stable security definer set search_path = public as $$
  with b as (
    select coalesce(max(u.points), 0) points, coalesce(max(u.throws_lvl), 0) t, coalesce(max(u.speed_lvl), 0) s, coalesce(max(u.sight_lvl), 0) g
    from player_upgrades u where u.user_id = p_user and u.season_id = coalesce((current_season()).id, 0)),
  x as (select pass_tier(p_user) tier, (select upgrade_max_level from game_config) mx)
  select b.points::int, least(x.mx, b.t + x.tier)::int, least(x.mx, b.s + x.tier)::int, least(x.mx, b.g + x.tier)::int from b, x
$$;

-- Placing a point: refuse once the track is maxed, counting the pass tier.
create or replace function public.place_power_up(p_track text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; u player_upgrades; sid int := coalesce((current_season()).id, 0); eff record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_track not in ('throws','speed','sight') then return jsonb_build_object('error','track'); end if;
  select * into cfg from game_config;
  select * into u from player_upgrades where user_id = auth.uid() and season_id = sid for update;
  if u.user_id is null or u.points < 1 then return jsonb_build_object('error','points'); end if;
  select * into eff from upgrade_levels(auth.uid());
  if (p_track = 'throws' and eff.throws_lvl >= cfg.upgrade_max_level) or (p_track = 'speed' and eff.speed_lvl >= cfg.upgrade_max_level)
     or (p_track = 'sight' and eff.sight_lvl >= cfg.upgrade_max_level) then
    return jsonb_build_object('error','max');
  end if;
  update player_upgrades set points = points - 1,
    throws_lvl = throws_lvl + (p_track = 'throws')::int,
    speed_lvl = speed_lvl + (p_track = 'speed')::int,
    sight_lvl = sight_lvl + (p_track = 'sight')::int
   where user_id = auth.uid() and season_id = sid;
  return power_ups();
end $$;

-- Server only: switch on an NFT pass with its tier. Re-checking replaces the asset and tier (no keeping a higher
-- tier after the NFT has moved on). One NFT activates one account per season (unique index on asset).
create or replace function public.grant_nft_pass_tier(p_user uuid, p_season int, p_asset text, p_tier int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ss seasons;
begin
  if p_tier < 1 or p_tier > 5 then raise exception 'bad tier'; end if;
  select * into ss from seasons where id = p_season;
  if ss.id is null or ss.ends_at <= now() then return null; end if;
  update profiles set pass_until = greatest(coalesce(pass_until, now()), ss.ends_at) where id = p_user;
  insert into season_passes (user_id, season_id, asset_id, source, tier) values (p_user, p_season, p_asset, 'nft', p_tier)
    on conflict (user_id, season_id) do update set asset_id = excluded.asset_id, source = 'nft', tier = excluded.tier, seen_at = now();
  return ss.ends_at;
end $$;
revoke execute on function public.grant_nft_pass_tier(uuid, int, text, int), public.pass_tier(uuid) from public, anon, authenticated;
grant execute on function public.grant_nft_pass_tier(uuid, int, text, int) to service_role;

-- power_ups(): add the pass tier so the panel can show "+N from your Season Pass".
create or replace function public.power_ups() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg game_config; ul record; tier int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into ul from upgrade_levels(auth.uid());
  tier := pass_tier(auth.uid());
  return jsonb_build_object(
    'enabled', cfg.token_upgrades_enabled, 'can_buy', cfg.token_upgrades_enabled or is_admin(),
    'cluster', cfg.token_cluster, 'mint', cfg.token_mint, 'split', cfg.token_split,
    'wallets', jsonb_build_object('vault', cfg.token_vault_wallet, 'drops', cfg.token_drops_wallet, 'dev', cfg.token_dev_wallet),
    'tiers', cfg.upgrade_tiers, 'coin_tiers', cfg.coin_power_up_tiers, 'max_level', cfg.upgrade_max_level,
    'per_level', jsonb_build_object('throws', cfg.upgrade_throws_per_level, 'speed_pct', cfg.upgrade_speed_pct_per_level, 'sight_m', cfg.upgrade_sight_m_per_level),
    'throws_pay_rewards', cfg.token_throws_pay_rewards,
    'points', ul.points, 'levels', jsonb_build_object('throws', ul.throws_lvl, 'speed', ul.speed_lvl, 'sight', ul.sight_lvl),
    'pass_tier', tier,
    'season', (current_season()).name);
end $$;

-- Free whitelist mint is gone: every pass is bought. The whitelist card no longer promises a free mint.
alter table game_config add column if not exists free_mint_enabled boolean not null default false;
