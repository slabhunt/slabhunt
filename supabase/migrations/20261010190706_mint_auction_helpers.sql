---------------------------------------------------------------------------
-- Internal helpers
---------------------------------------------------------------------------
-- Split coins already taken from a player across the flywheel (same split as spend_coins).
create function public.route_spend(p_user uuid, p_amount bigint, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare cfg game_config; pot_share bigint; cards bigint; burn bigint; team bigint; pid int;
begin
  if p_amount <= 0 then return; end if;
  select * into cfg from game_config;
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
end $$;

-- Open an auction for every creature that debuts in a season (Season 1 also gets the core creatures).
create function public.ensure_season_auctions(p_season int)
returns int language plpgsql security definer set search_path = public as $$
declare cfg game_config; ss seasons; n int;
begin
  select * into cfg from game_config;
  select * into ss from seasons where id = p_season;
  if ss.id is null then return 0; end if;
  insert into creature_auctions (species_id, season_id, supply, min_bid, opens_at, closes_at)
  select s.id, ss.id,
         case s.rarity when 'l' then cfg.mint_supply_l when 'r' then cfg.mint_supply_r when 'u' then cfg.mint_supply_u else cfg.mint_supply_c end,
         case s.rarity when 'l' then cfg.min_bid_l when 'r' then cfg.min_bid_r when 'u' then cfg.min_bid_u else cfg.min_bid_c end,
         greatest(ss.starts_at, now()), ss.ends_at
    from species s
   where s.season_id = ss.id or (s.season_id is null and ss.id = (select min(id) from seasons))
  on conflict (species_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Close an auction: top bids win and pay in tokens; losing bids get the refund share back.
create function public.settle_auction(p_auction int)
returns void language plpgsql security definer set search_path = public as $$
declare a creature_auctions; cfg game_config; b record; back bigint; fee bigint := 0; sp species;
begin
  select * into a from creature_auctions where id = p_auction for update;
  if a.id is null or a.status <> 'open' or a.closes_at > now() then return; end if;
  select * into cfg from game_config;
  select * into sp from species where id = a.species_id;
  for b in
    select ab.user_id, ab.amount,
           row_number() over (order by ab.amount desc, ab.updated_at) as rk
      from auction_bids ab where ab.auction_id = a.id and ab.status = 'active'
  loop
    if b.rk <= a.supply then
      update auction_bids set status = 'won', token_price = b.amount * cfg.tokens_per_coin
       where auction_id = a.id and user_id = b.user_id;
      perform route_spend(b.user_id, b.amount, 'creature_mint');
      if sp.rarity in ('r','l') then
        insert into chat_messages (user_id, kind, body)
          values (b.user_id, 'catch', 'won a ' || case sp.rarity when 'l' then 'Legendary' else 'Rare' end || ' ' || sp.name || ' mint!');
      end if;
    else
      back := b.amount * cfg.auction_refund_pct / 100;
      fee := fee + (b.amount - back);
      update auction_bids set status = 'lost', refund = back where auction_id = a.id and user_id = b.user_id;
      if back > 0 then perform add_coins(b.user_id, back, 'auction_refund', a.id::text); end if;
    end if;
  end loop;
  if fee > 0 then update treasury_pools set balance = balance + fee where name = 'buyback'; end if;
  update creature_auctions set status = 'settled', settled_at = now() where id = a.id;
end $$;

create function public.settle_due_auctions()
returns void language plpgsql security definer set search_path = public as $$
declare ss seasons; aid int;
begin
  ss := current_season();
  if ss.id is not null then perform ensure_season_auctions(ss.id); end if;
  for aid in select id from creature_auctions where status = 'open' and closes_at <= now() loop
    perform settle_auction(aid);
  end loop;
end $$;

revoke execute on function public.route_spend(uuid, bigint, text), public.ensure_season_auctions(int),
  public.settle_auction(int), public.settle_due_auctions() from public, anon, authenticated;
