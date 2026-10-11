-- Weekly Vault Draws replace coin gacha pulls. Each draw raffles one real card from the vault (Common, Rare or
-- Epic tier). Players buy tickets with coins they earned (1,000 / 10,000 / 100,000). $VDRAKE tickets exist but stay
-- off (draw_tokens_enabled) until launch and legal sign-off. Coins can be spent here or on the Spark power-up,
-- but never turn into $VDRAKE.
alter table game_config
  add column if not exists coin_gacha_enabled boolean not null default false,
  add column if not exists draw_ticket_coins jsonb not null default '{"common":1000,"rare":10000,"epic":100000}',
  add column if not exists draw_ticket_tokens jsonb not null default '{"common":1000,"rare":10000,"epic":100000}',
  add column if not exists draw_tokens_enabled boolean not null default false,
  add column if not exists draw_max_tickets int not null default 50,
  add column if not exists coin_power_up_tiers jsonb not null default '{"1":25000}';

create table if not exists public.vault_draws (
  id bigint generated always as identity primary key,
  tier text not null check (tier in ('common','rare','epic')),
  card_id bigint not null references public.gacha_cards(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open','drawn','no_entries')),
  winner uuid references public.profiles(id),
  drawn_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists vault_draws_one_open_per_card on public.vault_draws (card_id) where status = 'open';
alter table public.vault_draws enable row level security;
create policy "read draws" on public.vault_draws for select using (true);

create table if not exists public.vault_draw_tickets (
  draw_id bigint not null references public.vault_draws(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  coin_tickets int not null default 0,
  token_tickets int not null default 0,
  primary key (draw_id, user_id)
);
alter table public.vault_draw_tickets enable row level security;
create policy "own tickets" on public.vault_draw_tickets for select using (user_id = auth.uid());

alter table public.token_purchases
  add column if not exists kind text not null default 'powerup' check (kind in ('powerup','draw')),
  add column if not exists draw_id bigint references public.vault_draws(id),
  add column if not exists tickets int not null default 0;

-- Coin gacha pulls are off unless an admin turns them back on.
create or replace function public.gacha_pull(p_turbo boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; bal bigint; total int; roll int; t text; c gacha_cards; buy int := 0; pid bigint; auto boolean := false;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  if not cfg.coin_gacha_enabled then return jsonb_build_object('error','off'); end if;
  select sum(o.weight) into total from gacha_odds o
   where exists (select 1 from gacha_cards g where g.tier = o.tier and g.status = 'pool');
  if total is null then return jsonb_build_object('error','empty'); end if;
  bal := spend_coins(auth.uid(), cfg.pull_price, 'gacha');
  if bal < 0 then return jsonb_build_object('error','coins','cost',cfg.pull_price); end if;
  roll := floor(random() * total)::int;
  select x.tier into t from (
    select o.tier, sum(o.weight) over (order by o.sort) as cum from gacha_odds o
     where exists (select 1 from gacha_cards g where g.tier = o.tier and g.status = 'pool')) x
   where x.cum > roll order by x.cum limit 1;
  select * into c from gacha_cards where tier = t and status = 'pool' order by random() limit 1 for update skip locked;
  if c.id is null then
    bal := add_coins(auth.uid(), cfg.pull_price, 'gacha_refund');
    return jsonb_build_object('error','busy');
  end if;
  if t = 'common' and p_turbo then
    auto := true;
    buy := c.value_coins * cfg.turbo_buyback_pct / 100;
    bal := add_coins(auth.uid(), buy, 'turbo_sell', c.id::text);
  else
    update gacha_cards set status = 'won', won_by = auth.uid(), won_at = now() where id = c.id;
  end if;
  insert into gacha_pulls (user_id, card_id, tier, price, auto_sold, buyback)
    values (auth.uid(), c.id, t, cfg.pull_price, auto, buy) returning id into pid;
  if t in ('rare','epic') then
    insert into chat_messages (user_id, kind, body)
      values (auth.uid(), 'catch', 'ripped ' || c.name || case when c.grade <> '' then ' ' || c.grade else '' end || ' (' || t || ')!');
  end if;
  return jsonb_build_object('pull_id', pid, 'tier', t, 'card', jsonb_build_object(
      'id', c.id, 'name', c.name, 'grade', c.grade, 'value', c.value_coins, 'image_url', c.image_url),
    'auto_sold', auto, 'buyback', buy, 'coins', bal);
end $$;

-- Draw every open draw whose time is up: one winner, weighted by tickets.
create or replace function public.settle_vault_draws() returns void
language plpgsql security definer set search_path = public as $$
declare d vault_draws; total int; roll int; w uuid; c gacha_cards; nm text;
begin
  for d in select * from vault_draws where status = 'open' and ends_at <= now() for update skip locked loop
    select coalesce(sum(coin_tickets + token_tickets), 0) into total from vault_draw_tickets where draw_id = d.id;
    if total = 0 then
      update vault_draws set status = 'no_entries', drawn_at = now() where id = d.id;
      continue;
    end if;
    roll := floor(random() * total)::int;
    select x.user_id into w from (
      select user_id, sum(coin_tickets + token_tickets) over (order by user_id) as cum
      from vault_draw_tickets where draw_id = d.id and coin_tickets + token_tickets > 0) x
     where x.cum > roll order by x.cum limit 1;
    update vault_draws set status = 'drawn', winner = w, drawn_at = now() where id = d.id;
    update gacha_cards set status = 'won', won_by = w, won_at = now() where id = d.card_id returning * into c;
    select display_name into nm from profiles where id = w;
    insert into chat_messages (user_id, kind, body)
      values (w, 'draw', left(coalesce(nm, 'A hunter') || ' won the ' || d.tier || ' Vault Draw: ' || c.name
        || case when c.grade <> '' then ' ' || c.grade else '' end || '!', 280));
  end loop;
end $$;
revoke execute on function public.settle_vault_draws() from public, anon, authenticated;

-- Everything the Vault Draws panel needs.
create or replace function public.vault_draws_list() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform settle_vault_draws();
  select * into cfg from game_config;
  return jsonb_build_object(
    'coin_gacha', cfg.coin_gacha_enabled,
    'ticket_coins', cfg.draw_ticket_coins, 'ticket_tokens', cfg.draw_ticket_tokens,
    'tokens_enabled', cfg.draw_tokens_enabled, 'can_buy_tokens', cfg.draw_tokens_enabled or is_admin(),
    'max_tickets', cfg.draw_max_tickets,
    'draws', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'tier', d.tier, 'ends_at', d.ends_at,
        'card', jsonb_build_object('name', c.name, 'grade', c.grade, 'image_url', c.image_url, 'value', c.value_coins),
        'total', coalesce((select sum(coin_tickets + token_tickets) from vault_draw_tickets t where t.draw_id = d.id), 0),
        'players', (select count(*) from vault_draw_tickets t where t.draw_id = d.id),
        'mine', coalesce((select coin_tickets + token_tickets from vault_draw_tickets t where t.draw_id = d.id and t.user_id = auth.uid()), 0))
        order by case d.tier when 'epic' then 0 when 'rare' then 1 else 2 end, d.ends_at)
      from vault_draws d join gacha_cards c on c.id = d.card_id where d.status = 'open'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('tier', d.tier, 'card', c.name || case when c.grade <> '' then ' ' || c.grade else '' end,
          'winner', p.display_name, 'mine', d.winner = auth.uid(), 'drawn_at', d.drawn_at) r
        from vault_draws d join gacha_cards c on c.id = d.card_id left join profiles p on p.id = d.winner
        where d.status = 'drawn' order by d.drawn_at desc limit 8) x), '[]'::jsonb),
    'pool', case when is_admin() then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'grade', c.grade, 'tier', c.tier) order by c.id)
        from gacha_cards c where c.status = 'pool' and not exists (select 1 from vault_draws d where d.card_id = c.id and d.status = 'open')), '[]'::jsonb) end);
end $$;

-- Buy draw tickets with earned coins (spent through the usual coin split).
create or replace function public.enter_vault_draw(p_draw bigint, p_tickets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; d vault_draws; price bigint; have int; bal bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_tickets is null or p_tickets < 1 or p_tickets > 1000 then return jsonb_build_object('error','tickets'); end if;
  select * into cfg from game_config;
  select * into d from vault_draws where id = p_draw;
  if d.id is null or d.status <> 'open' or d.ends_at <= now() then return jsonb_build_object('error','closed'); end if;
  select coalesce(coin_tickets + token_tickets, 0) into have from vault_draw_tickets where draw_id = d.id and user_id = auth.uid();
  if coalesce(have, 0) + p_tickets > cfg.draw_max_tickets then return jsonb_build_object('error','max','max',cfg.draw_max_tickets,'have',coalesce(have,0)); end if;
  price := p_tickets::bigint * coalesce((cfg.draw_ticket_coins->>d.tier)::bigint, 0);
  if price <= 0 then return jsonb_build_object('error','closed'); end if;
  bal := spend_coins(auth.uid(), price, 'vault_draw', d.id::text);
  if bal < 0 then return jsonb_build_object('error','coins','cost',price); end if;
  insert into vault_draw_tickets (draw_id, user_id, coin_tickets) values (d.id, auth.uid(), p_tickets)
    on conflict (draw_id, user_id) do update set coin_tickets = vault_draw_tickets.coin_tickets + excluded.coin_tickets;
  return jsonb_build_object('coins', bal, 'tickets', coalesce(have, 0) + p_tickets);
end $$;

-- Step 1 of buying draw tickets with $VDRAKE (called by the powerup function as the player).
create or replace function public.start_token_draw_purchase(p_draw bigint, p_tickets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; d vault_draws; per numeric; have int; pid uuid; sp jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  if not (cfg.draw_tokens_enabled or is_admin()) then return jsonb_build_object('error','off'); end if;
  if p_tickets is null or p_tickets < 1 or p_tickets > 1000 then return jsonb_build_object('error','tickets'); end if;
  select * into d from vault_draws where id = p_draw;
  if d.id is null or d.status <> 'open' or d.ends_at <= now() + interval '3 minutes' then return jsonb_build_object('error','closed'); end if;
  select coalesce(coin_tickets + token_tickets, 0) into have from vault_draw_tickets where draw_id = d.id and user_id = auth.uid();
  if coalesce(have, 0) + p_tickets > cfg.draw_max_tickets then return jsonb_build_object('error','max','max',cfg.draw_max_tickets); end if;
  per := coalesce((cfg.draw_ticket_tokens->>d.tier)::numeric, 0);
  if per <= 0 then return jsonb_build_object('error','tier'); end if;
  if cfg.token_mint is null or cfg.token_vault_wallet is null or cfg.token_drops_wallet is null or cfg.token_dev_wallet is null then
    return jsonb_build_object('error','not_set_up');
  end if;
  sp := jsonb_build_object('burn_pct', coalesce((cfg.token_split->>'burn')::int, 0), 'to', jsonb_build_array(
    jsonb_build_object('key','vault','wallet',cfg.token_vault_wallet,'pct',coalesce((cfg.token_split->>'vault')::int, 0)),
    jsonb_build_object('key','drops','wallet',cfg.token_drops_wallet,'pct',coalesce((cfg.token_split->>'drops')::int, 0)),
    jsonb_build_object('key','dev','wallet',cfg.token_dev_wallet,'pct',coalesce((cfg.token_split->>'dev')::int, 0))));
  insert into token_purchases (user_id, season_id, tier, points, price, cluster, mint, splits, decimals, kind, draw_id, tickets)
    values (auth.uid(), coalesce((current_season()).id, 0), 0, 0, per * p_tickets, cfg.token_cluster, cfg.token_mint, sp,
            cfg.token_decimals, 'draw', d.id, p_tickets)
    returning id into pid;
  return jsonb_build_object('purchase_id', pid, 'price', per * p_tickets, 'points', 0, 'tickets', p_tickets,
    'cluster', cfg.token_cluster, 'mint', cfg.token_mint, 'splits', sp, 'decimals', cfg.token_decimals);
end $$;

-- Step 2 (server only, after the payment is checked on-chain): add power-up points or draw tickets.
create or replace function public.credit_token_purchase(p_id uuid, p_signature text, p_payer text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tp token_purchases;
begin
  select * into tp from token_purchases where id = p_id for update;
  if tp.id is null then return jsonb_build_object('error','unknown'); end if;
  if tp.status = 'paid' then return jsonb_build_object('points', tp.points, 'tickets', tp.tickets, 'already', true); end if;
  if exists (select 1 from token_purchases where signature = p_signature) then return jsonb_build_object('error','reused'); end if;
  update token_purchases set status = 'paid', signature = p_signature, payer = p_payer, paid_at = now() where id = p_id;
  if tp.kind = 'draw' then
    insert into vault_draw_tickets (draw_id, user_id, token_tickets) values (tp.draw_id, tp.user_id, tp.tickets)
      on conflict (draw_id, user_id) do update set token_tickets = vault_draw_tickets.token_tickets + excluded.token_tickets;
    return jsonb_build_object('tickets', tp.tickets);
  end if;
  insert into player_upgrades (user_id, season_id, points) values (tp.user_id, tp.season_id, tp.points)
    on conflict (user_id, season_id) do update set points = player_upgrades.points + excluded.points;
  return jsonb_build_object('points', tp.points);
end $$;
revoke execute on function public.credit_token_purchase(uuid, text, text) from public, anon, authenticated;
grant execute on function public.credit_token_purchase(uuid, text, text) to service_role;

-- Spark (and any tier listed in coin_power_up_tiers) can be bought with earned coins. Coins are spent, never converted.
create or replace function public.buy_power_up_coins(p_tier int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; cost bigint; pts int; bal bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  cost := (cfg.coin_power_up_tiers->>p_tier::text)::bigint;
  if cost is null or cost <= 0 then return jsonb_build_object('error','tier'); end if;
  select (e.v->>'points')::int into pts from jsonb_array_elements(cfg.upgrade_tiers) as e(v) where (e.v->>'tier')::int = p_tier;
  if pts is null or pts < 1 then return jsonb_build_object('error','tier'); end if;
  bal := spend_coins(auth.uid(), cost, 'power_up');
  if bal < 0 then return jsonb_build_object('error','coins','cost',cost); end if;
  insert into player_upgrades (user_id, season_id, points) values (auth.uid(), coalesce((current_season()).id, 0), pts)
    on conflict (user_id, season_id) do update set points = player_upgrades.points + excluded.points;
  return power_ups() || jsonb_build_object('coins', bal);
end $$;

create or replace function public.power_ups() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg game_config; ul record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into ul from upgrade_levels(auth.uid());
  return jsonb_build_object(
    'enabled', cfg.token_upgrades_enabled, 'can_buy', cfg.token_upgrades_enabled or is_admin(),
    'cluster', cfg.token_cluster, 'mint', cfg.token_mint, 'split', cfg.token_split,
    'wallets', jsonb_build_object('vault', cfg.token_vault_wallet, 'drops', cfg.token_drops_wallet, 'dev', cfg.token_dev_wallet),
    'tiers', cfg.upgrade_tiers, 'coin_tiers', cfg.coin_power_up_tiers, 'max_level', cfg.upgrade_max_level,
    'per_level', jsonb_build_object('throws', cfg.upgrade_throws_per_level, 'speed_pct', cfg.upgrade_speed_pct_per_level, 'sight_m', cfg.upgrade_sight_m_per_level),
    'throws_pay_rewards', cfg.token_throws_pay_rewards,
    'points', ul.points, 'levels', jsonb_build_object('throws', ul.throws_lvl, 'speed', ul.speed_lvl, 'sight', ul.sight_lvl),
    'season', (current_season()).name);
end $$;

-- Admin: put a vault card up for a draw.
create or replace function public.admin_open_vault_draw(p_card bigint, p_tier text, p_days numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c gacha_cards; did bigint;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_tier not in ('common','rare','epic') then raise exception 'tier must be common, rare or epic'; end if;
  select * into c from gacha_cards where id = p_card;
  if c.id is null or c.status <> 'pool' then raise exception 'that card is not in the vault'; end if;
  insert into vault_draws (tier, card_id, ends_at)
    values (p_tier, p_card, now() + make_interval(secs => greatest(coalesce(p_days, 7), 0.01) * 86400))
    returning id into did;
  insert into chat_messages (user_id, kind, body)
    values (auth.uid(), 'draw', left('New ' || p_tier || ' Vault Draw: ' || c.name || case when c.grade <> '' then ' ' || c.grade else '' end
      || '. Get your tickets in the Gacha tab!', 280));
  return jsonb_build_object('draw_id', did);
end $$;

-- Admin: ticket prices (coins and $VDRAKE per tier), per-player cap, and the $VDRAKE ticket switch.
create or replace function public.admin_vault_draw_settings(p_coins jsonb, p_tokens jsonb, p_tokens_enabled boolean,
  p_max int, p_coin_power_ups jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update game_config set
    draw_ticket_coins = coalesce(p_coins, draw_ticket_coins),
    draw_ticket_tokens = coalesce(p_tokens, draw_ticket_tokens),
    draw_tokens_enabled = coalesce(p_tokens_enabled, draw_tokens_enabled),
    draw_max_tickets = coalesce(nullif(p_max, 0), draw_max_tickets),
    coin_power_up_tiers = coalesce(p_coin_power_ups, coin_power_up_tiers)
   where id;
  return vault_draws_list();
end $$;
