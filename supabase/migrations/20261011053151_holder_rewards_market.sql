-- Finishing the flywheel:
-- 1. Admin economy controls (pass coin multiplier, pass coin price).
-- 2. Power-up items: tradeable "Power Cells" that turn into one power-up point when used.
-- 3. Holder rewards: once a week, a verified wallet holding $VDRAKE (and/or Vault Hunt NFTs) claims Power Cells.
--    Rewards are in-game items only, never tokens or money. Off (holder_rewards_enabled) until the token launches.
-- 4. Marketplace: players list Power Cells for coins. A fee (default 5%) is burned. Coins never leave the game.
alter table game_config
  add column if not exists holder_rewards_enabled boolean not null default false,
  add column if not exists holder_tiers jsonb not null default '[{"min":100000,"cells":1},{"min":1000000,"cells":2},{"min":10000000,"cells":4}]',
  add column if not exists holder_nft_collections text[] not null default '{}',
  add column if not exists holder_cells_per_nft int not null default 1,
  add column if not exists holder_max_nft_cells int not null default 3,
  add column if not exists market_fee_pct int not null default 5 check (market_fee_pct between 0 and 50),
  -- Price ceiling per cell, so the market can't be used to funnel big coin piles between accounts.
  add column if not exists market_max_each int not null default 5000 check (market_max_each between 1 and 1000000);

create table if not exists public.item_inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item text not null check (item in ('power_cell')),
  qty int not null default 0 check (qty >= 0),
  primary key (user_id, item)
);
alter table public.item_inventory enable row level security;
create policy "own items" on public.item_inventory for select using (user_id = auth.uid());

create table if not exists public.holder_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week date not null,
  wallet text not null,
  token_balance numeric not null default 0,
  nfts int not null default 0,
  cells int not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, week)
);
-- One claim per wallet per week too, so a wallet can't be shared across accounts.
create unique index if not exists holder_claims_wallet_week on public.holder_claims (wallet, week);
alter table public.holder_claims enable row level security;
create policy "own holder claims" on public.holder_claims for select using (user_id = auth.uid());

create table if not exists public.market_listings (
  id bigint generated always as identity primary key,
  seller uuid not null references public.profiles(id) on delete cascade,
  item text not null check (item in ('power_cell')),
  qty int not null check (qty between 1 and 100),
  price_coins bigint not null check (price_coins between 1 and 100000000),
  status text not null default 'open' check (status in ('open','sold','cancelled')),
  buyer uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists market_open on public.market_listings (status, price_coins) where status = 'open';
alter table public.market_listings enable row level security;
create policy "read listings" on public.market_listings for select using (auth.uid() is not null);

-- Admin: coin economy knobs.
create or replace function public.admin_economy_settings(p_pass_mult int, p_pass_price int, p_market_fee int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update game_config set
    pass_bounty_mult = coalesce(nullif(p_pass_mult, 0), pass_bounty_mult),
    pass_price = coalesce(nullif(p_pass_price, 0), pass_price),
    market_fee_pct = coalesce(p_market_fee, market_fee_pct)
   where id;
  return (select jsonb_build_object('pass_mult', pass_bounty_mult, 'pass_price', pass_price, 'market_fee', market_fee_pct) from game_config);
end $$;

-- Admin: holder reward settings.
create or replace function public.admin_holder_settings(p_enabled boolean, p_tiers jsonb, p_collections text[], p_cells_per_nft int, p_max_nft_cells int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update game_config set
    holder_rewards_enabled = coalesce(p_enabled, holder_rewards_enabled),
    holder_tiers = coalesce(p_tiers, holder_tiers),
    holder_nft_collections = coalesce(p_collections, holder_nft_collections),
    holder_cells_per_nft = coalesce(p_cells_per_nft, holder_cells_per_nft),
    holder_max_nft_cells = coalesce(p_max_nft_cells, holder_max_nft_cells)
   where id;
  return items_info();
end $$;

-- Everything the Items & Market card needs.
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

-- Use Power Cells: each becomes one unplaced power-up point for this season.
create or replace function public.use_power_cells(p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_qty is null or p_qty < 1 then return jsonb_build_object('error','qty'); end if;
  update item_inventory set qty = qty - p_qty where user_id = auth.uid() and item = 'power_cell' and qty >= p_qty;
  if not found then return jsonb_build_object('error','not_enough'); end if;
  insert into player_upgrades (user_id, season_id, points) values (auth.uid(), coalesce((current_season()).id, 0), p_qty)
    on conflict (user_id, season_id) do update set points = player_upgrades.points + excluded.points;
  return items_info();
end $$;

-- Marketplace: list, cancel, buy. Items are held by the listing until it sells or is cancelled.
create or replace function public.market_list(p_qty int, p_price bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 100 or p_price is null or p_price < 1 or p_price > 100000000 then
    return jsonb_build_object('error','bad_listing');
  end if;
  if p_price > p_qty::bigint * (select market_max_each from game_config) then
    return jsonb_build_object('error','too_pricey','max_each',(select market_max_each from game_config));
  end if;
  if (select count(*) from market_listings where seller = auth.uid() and status = 'open') >= 10 then
    return jsonb_build_object('error','too_many');
  end if;
  update item_inventory set qty = qty - p_qty where user_id = auth.uid() and item = 'power_cell' and qty >= p_qty;
  if not found then return jsonb_build_object('error','not_enough'); end if;
  insert into market_listings (seller, item, qty, price_coins) values (auth.uid(), 'power_cell', p_qty, p_price);
  return items_info();
end $$;

create or replace function public.market_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l market_listings;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update market_listings set status = 'cancelled', closed_at = now()
   where id = p_id and seller = auth.uid() and status = 'open' returning * into l;
  if l.id is null then return jsonb_build_object('error','gone'); end if;
  insert into item_inventory (user_id, item, qty) values (l.seller, l.item, l.qty)
    on conflict (user_id, item) do update set qty = item_inventory.qty + excluded.qty;
  return items_info();
end $$;

create or replace function public.market_buy(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l market_listings; cfg game_config; bal bigint; fee bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into l from market_listings where id = p_id and status = 'open' for update;
  if l.id is null then return jsonb_build_object('error','gone'); end if;
  if l.seller = auth.uid() then return jsonb_build_object('error','own'); end if;
  select coins into bal from profiles where id = auth.uid() for update;
  if bal < l.price_coins then return jsonb_build_object('error','coins','cost',l.price_coins); end if;
  fee := l.price_coins * cfg.market_fee_pct / 100;
  perform add_coins(auth.uid(), -l.price_coins, 'market_buy', l.id::text);
  perform add_coins(l.seller, l.price_coins - fee, 'market_sale', l.id::text);  -- the fee is burned (never credited)
  update market_listings set status = 'sold', buyer = auth.uid(), closed_at = now() where id = l.id;
  insert into item_inventory (user_id, item, qty) values (auth.uid(), l.item, l.qty)
    on conflict (user_id, item) do update set qty = item_inventory.qty + excluded.qty;
  return items_info() || jsonb_build_object('bought', l.qty, 'paid', l.price_coins);
end $$;

-- Server only (wallet function, after checking holdings on-chain): credit this week's holder reward.
create or replace function public.credit_holder_reward(p_user uuid, p_wallet text, p_balance numeric, p_nfts int, p_cells int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare wk date := date_trunc('week', now() at time zone 'utc')::date;
begin
  if p_cells < 1 then return jsonb_build_object('error','not_eligible'); end if;
  insert into holder_claims (user_id, week, wallet, token_balance, nfts, cells) values (p_user, wk, p_wallet, p_balance, p_nfts, p_cells);
  insert into item_inventory (user_id, item, qty) values (p_user, 'power_cell', p_cells)
    on conflict (user_id, item) do update set qty = item_inventory.qty + excluded.qty;
  return jsonb_build_object('cells', p_cells);
exception when unique_violation then
  return jsonb_build_object('error','claimed');
end $$;

-- Lock down (AGENTS.md rule 6).
revoke execute on function public.admin_economy_settings(int, int, int), public.admin_holder_settings(boolean, jsonb, text[], int, int),
  public.items_info(), public.use_power_cells(int), public.market_list(int, bigint), public.market_cancel(bigint),
  public.market_buy(bigint), public.credit_holder_reward(uuid, text, numeric, int, int) from public, anon;
grant execute on function public.admin_economy_settings(int, int, int), public.admin_holder_settings(boolean, jsonb, text[], int, int),
  public.items_info(), public.use_power_cells(int), public.market_list(int, bigint), public.market_cancel(bigint),
  public.market_buy(bigint) to authenticated;
grant execute on function public.credit_holder_reward(uuid, text, numeric, int, int) to service_role;
revoke all on public.item_inventory, public.holder_claims, public.market_listings from anon;
revoke insert, update, delete on public.item_inventory, public.holder_claims, public.market_listings from authenticated;
