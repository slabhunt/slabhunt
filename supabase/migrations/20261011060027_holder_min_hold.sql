-- Holder rewards count only what a wallet held the whole time for the last N hours (default 24),
-- so tokens can't be passed from wallet to wallet to claim again. NFTs must not have moved in that window either.
alter table game_config add column if not exists holder_min_hold_hours int not null default 24 check (holder_min_hold_hours between 0 and 168);

create or replace function public.admin_holder_hold(p_hours int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_hours is null or p_hours < 0 or p_hours > 168 then raise exception 'hours must be 0 to 168'; end if;
  update game_config set holder_min_hold_hours = p_hours where id;
  return items_info();
end $$;
revoke execute on function public.admin_holder_hold(int) from public, anon;
grant execute on function public.admin_holder_hold(int) to authenticated;

create or replace function public.items_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg game_config; wk date := date_trunc('week', now() at time zone 'utc')::date;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  return jsonb_build_object(
    'cells', coalesce((select qty from item_inventory where user_id = auth.uid() and item = 'power_cell'), 0),
    'holder', jsonb_build_object(
      'enabled', cfg.holder_rewards_enabled, 'can_claim', cfg.holder_rewards_enabled or is_admin(),
      'tiers', cfg.holder_tiers, 'collections', cfg.holder_nft_collections,
      'cells_per_nft', cfg.holder_cells_per_nft, 'max_nft_cells', cfg.holder_max_nft_cells,
      'min_hold_hours', cfg.holder_min_hold_hours,
      'claimed', (select jsonb_build_object('cells', cells, 'token_balance', token_balance, 'nfts', nfts, 'claimed_at', claimed_at)
                  from holder_claims where user_id = auth.uid() and week = wk),
      'week_ends', ((wk + 7)::timestamp at time zone 'utc')),
    'market_fee', cfg.market_fee_pct, 'market_max_each', cfg.market_max_each,
    'listings', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'qty', l.qty, 'price', l.price_coins,
        'each', round(l.price_coins::numeric / l.qty), 'seller', p.display_name, 'mine', l.seller = auth.uid()) order by l.price_coins::numeric / l.qty, l.id)
      from (select * from market_listings where status = 'open' order by price_coins::numeric / qty, id limit 50) l
      join profiles p on p.id = l.seller), '[]'::jsonb),
    'my_listings', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'qty', qty, 'price', price_coins) order by id desc)
      from market_listings where seller = auth.uid() and status = 'open'), '[]'::jsonb));
end $$;
