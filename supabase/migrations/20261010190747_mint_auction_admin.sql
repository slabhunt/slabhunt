---------------------------------------------------------------------------
-- Admin
---------------------------------------------------------------------------
create function public.admin_mint_settings(p_tokens_per_coin numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_tokens_per_coin is null or p_tokens_per_coin <= 0 then raise exception 'rate must be positive'; end if;
  update game_config set tokens_per_coin = p_tokens_per_coin where id;
  -- Wins not yet paid follow the new rate.
  update auction_bids set token_price = amount * p_tokens_per_coin where status = 'won' and paid = false;
end $$;

create function public.admin_mark_mint_paid(p_auction int, p_user uuid, p_tx text, p_asset text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update auction_bids set paid = true, paid_tx = nullif(p_tx, ''), asset_id = nullif(p_asset, '')
   where auction_id = p_auction and user_id = p_user and status = 'won';
end $$;

create function public.admin_mint_report()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'tokens_per_coin', (select tokens_per_coin from game_config),
    'open', (select count(*) from creature_auctions where status = 'open'),
    'settled', (select count(*) from creature_auctions where status = 'settled'),
    'coins_bid', coalesce((select sum(amount) from auction_bids where status = 'active'), 0),
    'won', (select count(*) from auction_bids where status = 'won'),
    'paid', (select count(*) from auction_bids where status = 'won' and paid),
    'tokens_due', coalesce((select sum(token_price) from auction_bids where status = 'won' and not paid), 0),
    'buyback_pool', (select balance from treasury_pools where name = 'buyback'),
    'unpaid', coalesce((select jsonb_agg(jsonb_build_object('auction', b.auction_id, 'user', b.user_id,
        'name', p.display_name, 'species', a.species_id, 'price', b.token_price) order by b.auction_id)
      from auction_bids b join creature_auctions a on a.id = b.auction_id join profiles p on p.id = b.user_id
     where b.status = 'won' and not b.paid), '[]'::jsonb));
end $$;

revoke execute on function public.admin_mint_settings(numeric), public.admin_mark_mint_paid(int, uuid, text, text),
  public.admin_mint_report() from public, anon;
grant execute on function public.admin_mint_settings(numeric), public.admin_mark_mint_paid(int, uuid, text, text),
  public.admin_mint_report() to authenticated;
