-- Free Vault Draw tickets: every player earns tickets each week from play (1 per 100 XP, up to 20) and from a
-- daily check-in (1 a day). They can be used on any open draw. The per-draw ticket cap is never higher than what a
-- free player can earn in a week, so coins (or later $VDRAKE) can match a free player's odds but never beat them.
alter table game_config
  add column if not exists draw_xp_per_ticket int not null default 100,
  add column if not exists draw_play_ticket_cap int not null default 20,
  add column if not exists draw_checkin_tickets int not null default 1;

create table if not exists public.draw_checkins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.draw_checkins enable row level security;
create policy "own checkins" on public.draw_checkins for select using (user_id = auth.uid());

create table if not exists public.free_ticket_use (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week date not null,
  used int not null default 0,
  primary key (user_id, week)
);
alter table public.free_ticket_use enable row level security;
create policy "own free tickets" on public.free_ticket_use for select using (user_id = auth.uid());

-- Most tickets one player can hold in one draw: the configured cap, but never above a free player's weekly maximum.
create or replace function public.draw_cap() returns int
language sql stable security definer set search_path = public as $$
  select least(draw_max_tickets, draw_play_ticket_cap + 7 * draw_checkin_tickets) from game_config
$$;

-- This week's free tickets for the signed-in player.
create or replace function public.my_free_tickets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg game_config; wk date := date_trunc('week', now() at time zone 'utc')::date; xp int; play int; chk int; used int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select coalesce(sum(c.xp), 0) into xp from catches c where c.user_id = auth.uid() and c.created_at >= wk::timestamp at time zone 'utc';
  play := least(cfg.draw_play_ticket_cap, xp / greatest(cfg.draw_xp_per_ticket, 1));
  select count(*) * cfg.draw_checkin_tickets into chk from draw_checkins where user_id = auth.uid() and day >= wk;
  select coalesce(max(f.used), 0) into used from free_ticket_use f where f.user_id = auth.uid() and f.week = wk;
  return jsonb_build_object('week', wk, 'xp', xp, 'xp_per_ticket', cfg.draw_xp_per_ticket, 'play', play,
    'play_cap', cfg.draw_play_ticket_cap, 'checkins', chk, 'used', used, 'available', greatest(play + chk - used, 0),
    'cap', draw_cap(),
    'checked_in_today', exists (select 1 from draw_checkins where user_id = auth.uid() and day = (now() at time zone 'utc')::date),
    'week_ends', ((wk + 7)::timestamp at time zone 'utc'));
end $$;

create or replace function public.daily_checkin() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into draw_checkins (user_id, day) values (auth.uid(), (now() at time zone 'utc')::date) on conflict do nothing;
  return my_free_tickets();
end $$;

-- Put free tickets into a draw.
create or replace function public.enter_vault_draw_free(p_draw bigint, p_tickets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d vault_draws; f jsonb; have int; wk date := date_trunc('week', now() at time zone 'utc')::date;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_tickets is null or p_tickets < 1 then return jsonb_build_object('error','tickets'); end if;
  select * into d from vault_draws where id = p_draw;
  if d.id is null or d.status <> 'open' or d.ends_at <= now() then return jsonb_build_object('error','closed'); end if;
  perform pg_advisory_xact_lock(hashtext('free_tickets' || auth.uid()::text));
  f := my_free_tickets();
  if (f->>'available')::int < p_tickets then return jsonb_build_object('error','free','available',(f->>'available')::int); end if;
  select coalesce(coin_tickets + token_tickets, 0) into have from vault_draw_tickets where draw_id = d.id and user_id = auth.uid();
  if coalesce(have, 0) + p_tickets > draw_cap() then return jsonb_build_object('error','max','max',draw_cap()); end if;
  insert into free_ticket_use (user_id, week, used) values (auth.uid(), wk, p_tickets)
    on conflict (user_id, week) do update set used = free_ticket_use.used + excluded.used;
  -- Free tickets count the same as any other ticket in the draw.
  insert into vault_draw_tickets (draw_id, user_id, coin_tickets) values (d.id, auth.uid(), p_tickets)
    on conflict (draw_id, user_id) do update set coin_tickets = vault_draw_tickets.coin_tickets + excluded.coin_tickets;
  return jsonb_build_object('tickets', coalesce(have, 0) + p_tickets, 'free', my_free_tickets());
end $$;

-- Coin tickets and $VDRAKE tickets now use the fair cap.
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
  if coalesce(have, 0) + p_tickets > draw_cap() then return jsonb_build_object('error','max','max',draw_cap(),'have',coalesce(have,0)); end if;
  price := p_tickets::bigint * coalesce((cfg.draw_ticket_coins->>d.tier)::bigint, 0);
  if price <= 0 then return jsonb_build_object('error','closed'); end if;
  bal := spend_coins(auth.uid(), price, 'vault_draw', d.id::text);
  if bal < 0 then return jsonb_build_object('error','coins','cost',price); end if;
  insert into vault_draw_tickets (draw_id, user_id, coin_tickets) values (d.id, auth.uid(), p_tickets)
    on conflict (draw_id, user_id) do update set coin_tickets = vault_draw_tickets.coin_tickets + excluded.coin_tickets;
  return jsonb_build_object('coins', bal, 'tickets', coalesce(have, 0) + p_tickets);
end $$;

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
  if coalesce(have, 0) + p_tickets > draw_cap() then return jsonb_build_object('error','max','max',draw_cap()); end if;
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
