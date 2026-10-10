---------------------------------------------------------------------------
-- Player calls
---------------------------------------------------------------------------
create function public.mint_auctions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform settle_due_auctions();
  select * into cfg from game_config;
  return jsonb_build_object(
    'tokens_per_coin', cfg.tokens_per_coin, 'refund_pct', cfg.auction_refund_pct, 'extend_min', cfg.auction_extend_min,
    'server_now', now(),
    'auctions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'species', a.species_id, 'season', a.season_id, 'supply', a.supply, 'min_bid', a.min_bid,
        'closes_at', a.closes_at, 'status', a.status,
        'bidders', (select count(*) from auction_bids x where x.auction_id = a.id),
        'top', (select max(amount) from auction_bids x where x.auction_id = a.id),
        'cutoff', (select x.amount from auction_bids x where x.auction_id = a.id
                    order by x.amount desc, x.updated_at offset a.supply - 1 limit 1),
        'mine', my.amount, 'my_status', my.status, 'my_refund', my.refund, 'my_price', my.token_price, 'my_paid', my.paid,
        'my_rank', case when my.amount is null then null else
          (select count(*) + 1 from auction_bids x where x.auction_id = a.id
            and (x.amount > my.amount or (x.amount = my.amount and x.updated_at < my.updated_at))) end
      ) order by a.status, a.species_id)
      from creature_auctions a
      left join auction_bids my on my.auction_id = a.id and my.user_id = auth.uid()
      where a.status = 'open' or my.user_id is not null), '[]'::jsonb));
end $$;

create function public.place_bid(p_auction int, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config; a creature_auctions; prev bigint; cut bigint; n int; bal bigint; rk int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into a from creature_auctions where id = p_auction for update;
  if a.id is null then return jsonb_build_object('error','not_found'); end if;
  if a.status <> 'open' or a.closes_at <= now() or a.opens_at > now() then return jsonb_build_object('error','closed'); end if;
  if p_amount < a.min_bid then return jsonb_build_object('error','below_min','min',a.min_bid); end if;
  select amount into prev from auction_bids where auction_id = a.id and user_id = auth.uid();
  if prev is not null and p_amount <= prev then return jsonb_build_object('error','not_higher','current',prev); end if;
  -- When every copy is spoken for, a new bid has to beat the lowest winning bid.
  select count(*) into n from auction_bids where auction_id = a.id and user_id <> auth.uid();
  if n >= a.supply then
    select amount into cut from auction_bids where auction_id = a.id and user_id <> auth.uid()
      order by amount desc, updated_at offset a.supply - 1 limit 1;
    if p_amount <= cut then return jsonb_build_object('error','too_low','cutoff',cut); end if;
  end if;
  select coins into bal from profiles where id = auth.uid() for update;
  if bal < p_amount - coalesce(prev, 0) then return jsonb_build_object('error','coins','need',p_amount - coalesce(prev, 0)); end if;
  bal := add_coins(auth.uid(), -(p_amount - coalesce(prev, 0)), 'auction_bid', a.id::text);
  insert into auction_bids (auction_id, user_id, amount, updated_at) values (a.id, auth.uid(), p_amount, now())
    on conflict (auction_id, user_id) do update set amount = excluded.amount, updated_at = now();
  -- Late bids push the close back so nobody can snipe in the last second.
  if a.closes_at - now() < make_interval(mins => cfg.auction_extend_min) then
    update creature_auctions set closes_at = now() + make_interval(mins => cfg.auction_extend_min) where id = a.id;
  end if;
  select count(*) + 1 into rk from auction_bids where auction_id = a.id and amount > p_amount;
  return jsonb_build_object('ok', true, 'amount', p_amount, 'rank', rk, 'supply', a.supply, 'coins', bal);
end $$;

revoke execute on function public.mint_auctions(), public.place_bid(int, bigint) from public, anon;
grant execute on function public.mint_auctions(), public.place_bid(int, bigint) to authenticated;

select public.ensure_season_auctions((select id from public.seasons where starts_at <= now() and ends_at > now() order by starts_at desc limit 1));
