-- Two multipliers:
-- 1. Season Pass coin multiplier tunes itself. Once a day at most, it compares how long the active coin pot will last
--    at the last 24 hours' bounty rate with how long it needs to last (until the season ends, or 30 days). Running
--    out too fast: one step down. Lasting far longer than needed: one step up. Always within the admin's min and max.
-- 2. Holder rewards grow with time held. A week counts when the wallet kept its $VDRAKE for the whole 7 days
--    (lowest balance over 168 hours). Weeks in a row build a streak; the streak multiplies the cells from the
--    whole-week balance. A bag passed between wallets can't keep a week-long streak in more than one wallet.
alter table game_config
  add column if not exists pass_mult_auto boolean not null default true,
  add column if not exists pass_mult_min int not null default 2 check (pass_mult_min between 1 and 20),
  add column if not exists pass_mult_max int not null default 5 check (pass_mult_max between 1 and 20),
  add column if not exists pass_mult_changed_at timestamptz,
  add column if not exists holder_streak_mults jsonb not null default '[{"weeks":2,"mult":1.25},{"weeks":4,"mult":1.5},{"weeks":8,"mult":2}]';

create table if not exists public.pass_mult_log (
  id bigint generated always as identity primary key,
  old_mult int not null,
  new_mult int not null,
  pot_remaining bigint,
  spent_24h bigint,
  runway_days numeric,
  target_days numeric,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.pass_mult_log enable row level security;

alter table public.holder_claims
  add column if not exists week_balance numeric,
  add column if not exists full_week boolean not null default false,
  add column if not exists streak int not null default 0,
  add column if not exists mult numeric not null default 1,
  add column if not exists bonus_cells int not null default 0;

-- Hourly (pg_cron): keep the pass multiplier where the coin pot lasts the season.
create or replace function public.auto_tune_pass_mult() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; pot pots; spent bigint; runway numeric; target numeric; cur int; nxt int; why text;
begin
  select * into cfg from game_config for update;
  if not cfg.pass_mult_auto then return jsonb_build_object('skipped','off'); end if;
  cur := cfg.pass_bounty_mult;
  -- Keep inside the bounds right away if the admin changed them.
  if cur > cfg.pass_mult_max or cur < cfg.pass_mult_min then
    nxt := least(greatest(cur, cfg.pass_mult_min), cfg.pass_mult_max); why := 'outside_bounds';
  else
    if cfg.pass_mult_changed_at is not null and cfg.pass_mult_changed_at > now() - interval '24 hours' then
      return jsonb_build_object('skipped','cooldown');
    end if;
    select * into pot from pots where active order by id desc limit 1;
    if pot.id is null then return jsonb_build_object('skipped','no_pot'); end if;
    select coalesce(sum(delta), 0) into spent from coin_ledger where reason = 'bounty' and created_at > now() - interval '24 hours';
    if spent <= 0 then return jsonb_build_object('skipped','no_activity'); end if;
    runway := pot.remaining::numeric / spent;
    target := greatest(1, extract(epoch from (coalesce((current_season()).ends_at, now() + interval '30 days') - now())) / 86400);
    if runway < target * 0.8 and cur > cfg.pass_mult_min then nxt := cur - 1; why := 'pot_draining';
    elsif runway > target * 1.5 and cur < cfg.pass_mult_max then nxt := cur + 1; why := 'pot_healthy';
    else return jsonb_build_object('skipped','on_target', 'runway_days', round(runway, 1), 'target_days', round(target, 1));
    end if;
  end if;
  update game_config set pass_bounty_mult = nxt, pass_mult_changed_at = now() where id;
  insert into pass_mult_log (old_mult, new_mult, pot_remaining, spent_24h, runway_days, target_days, reason)
    values (cur, nxt, pot.remaining, spent, round(runway, 2), round(target, 2), why);
  return jsonb_build_object('old', cur, 'new', nxt, 'reason', why);
end $$;

-- Admin: auto-tune switch and bounds, plus the recent changes.
create or replace function public.admin_pass_mult(p_auto boolean, p_min int, p_max int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_min is not null and p_max is not null and p_min > p_max then raise exception 'min must be at most max'; end if;
  update game_config set pass_mult_auto = coalesce(p_auto, pass_mult_auto),
    pass_mult_min = coalesce(p_min, pass_mult_min), pass_mult_max = coalesce(p_max, pass_mult_max) where id;
  if p_auto then perform auto_tune_pass_mult(); end if;
  return pass_mult_info();
end $$;

create or replace function public.pass_mult_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('mult', c.pass_bounty_mult, 'auto', c.pass_mult_auto, 'min', c.pass_mult_min, 'max', c.pass_mult_max,
    'log', coalesce((select jsonb_agg(jsonb_build_object('old', l.old_mult, 'new', l.new_mult, 'reason', l.reason,
        'runway', l.runway_days, 'target', l.target_days, 'at', l.created_at) order by l.id desc)
      from (select * from pass_mult_log order by id desc limit 10) l), '[]'::jsonb))
  from game_config c
$$;

-- Admin: holder streak multipliers, e.g. [{"weeks":2,"mult":1.25},{"weeks":4,"mult":1.5},{"weeks":8,"mult":2}].
create or replace function public.admin_holder_streaks(p_mults jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if jsonb_typeof(p_mults) <> 'array' or exists (select 1 from jsonb_array_elements(p_mults) e
      where (e->>'weeks')::int is null or (e->>'weeks')::int < 1 or (e->>'mult')::numeric is null or (e->>'mult')::numeric < 1 or (e->>'mult')::numeric > 5) then
    raise exception 'each step needs weeks >= 1 and mult between 1 and 5';
  end if;
  update game_config set holder_streak_mults = p_mults where id;
  return items_info();
end $$;

-- Server only: credit this week's holder reward with the streak multiplier.
-- p_day_cells: cells for the 24-hour balance tier. p_week_cells: cells for the whole-week balance tier (0 if no full week).
create or replace function public.credit_holder_reward_v2(p_user uuid, p_wallet text, p_balance numeric, p_week_balance numeric,
  p_nfts int, p_day_cells int, p_week_cells int, p_nft_cells int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare wk date := date_trunc('week', now() at time zone 'utc')::date; v_full boolean := p_week_cells > 0;
  prev holder_claims; s int := 0; m numeric := 1; bonus int := 0; total int;
begin
  if p_day_cells + p_nft_cells < 1 then return jsonb_build_object('error','not_eligible'); end if;
  if v_full then
    select * into prev from holder_claims where user_id = p_user and wallet = p_wallet and week = wk - 7;
    s := case when prev.full_week then prev.streak + 1 else 1 end;
    select coalesce(max((e->>'mult')::numeric), 1) into m
      from game_config c, jsonb_array_elements(c.holder_streak_mults) e where (e->>'weeks')::int <= s;
    bonus := floor(p_week_cells * (m - 1));
  end if;
  total := p_day_cells + p_nft_cells + bonus;
  insert into holder_claims (user_id, week, wallet, token_balance, week_balance, nfts, cells, full_week, streak, mult, bonus_cells)
    values (p_user, wk, p_wallet, p_balance, p_week_balance, p_nfts, total, v_full, s, m, bonus);
  insert into item_inventory (user_id, item, qty) values (p_user, 'power_cell', total)
    on conflict (user_id, item) do update set qty = item_inventory.qty + excluded.qty;
  return jsonb_build_object('cells', total, 'streak', s, 'mult', m, 'bonus', bonus);
exception when unique_violation then
  return jsonb_build_object('error','claimed');
end $$;

-- Items card: add streak info and the multiplier steps.
create or replace function public.items_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg game_config; wk date := date_trunc('week', now() at time zone 'utc')::date; v_last holder_claims;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into v_last from holder_claims where user_id = auth.uid() order by week desc limit 1;
  return jsonb_build_object(
    'cells', coalesce((select qty from item_inventory where user_id = auth.uid() and item = 'power_cell'), 0),
    'holder', jsonb_build_object(
      'enabled', cfg.holder_rewards_enabled, 'can_claim', cfg.holder_rewards_enabled or is_admin(),
      'tiers', cfg.holder_tiers, 'collections', cfg.holder_nft_collections,
      'cells_per_nft', cfg.holder_cells_per_nft, 'max_nft_cells', cfg.holder_max_nft_cells,
      'min_hold_hours', cfg.holder_min_hold_hours, 'streak_mults', cfg.holder_streak_mults,
      'streak', case when v_last.week >= wk - 7 and v_last.full_week then v_last.streak else 0 end,
      'claimed', (select jsonb_build_object('cells', cells, 'token_balance', token_balance, 'nfts', nfts, 'claimed_at', claimed_at,
                    'streak', streak, 'mult', mult, 'bonus', bonus_cells, 'full_week', full_week)
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

-- Lock down (AGENTS.md rule 6). New functions start with no player access since 20261011063453.
revoke execute on function public.auto_tune_pass_mult(), public.credit_holder_reward_v2(uuid, text, numeric, numeric, int, int, int, int)
  from public, anon, authenticated;
grant execute on function public.auto_tune_pass_mult(), public.credit_holder_reward_v2(uuid, text, numeric, numeric, int, int, int, int) to service_role;
revoke execute on function public.admin_pass_mult(boolean, int, int), public.pass_mult_info(), public.admin_holder_streaks(jsonb) from public, anon;
grant execute on function public.admin_pass_mult(boolean, int, int), public.pass_mult_info(), public.admin_holder_streaks(jsonb) to authenticated;
revoke all on public.pass_mult_log from anon, authenticated;

-- Run the pass multiplier check hourly.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'vaulthunt-pass-mult') then perform cron.unschedule('vaulthunt-pass-mult'); end if;
end $$;
select cron.schedule('vaulthunt-pass-mult', '23 * * * *', 'select public.auto_tune_pass_mult()');
