-- Hourly: NFT passes still linked to an account whose verified wallet no longer holds them get unlinked.
create or replace function public.pass_links_to_check() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'season_id', sp.season_id, 'asset', sp.asset_id,
           'wallet', (select w.address from wallets w where w.user_id = sp.user_id and w.verified))), '[]'::jsonb)
  from season_passes sp join seasons s on s.id = sp.season_id
  where sp.source = 'nft' and sp.asset_id is not null and s.ends_at > now()
$$;

create or replace function public.unlink_season_pass(p_user uuid, p_season int, p_asset text) returns void
language sql security definer set search_path = public as $$
  update season_passes set asset_id = null, tier = 0, seen_at = now()
   where user_id = p_user and season_id = p_season and asset_id = p_asset
$$;

revoke execute on function public.pass_links_to_check(), public.unlink_season_pass(uuid, int, text) from public, anon, authenticated;
grant execute on function public.pass_links_to_check(), public.unlink_season_pass(uuid, int, text) to service_role;
