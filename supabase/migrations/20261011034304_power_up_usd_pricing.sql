-- Power-up prices in US dollars: the powerup function converts each tier's "usd" to $VDRAKE at the live
-- market price when a purchase starts. Tiers without "usd" (or devnet tests) use the fixed token "price".

-- Server only: start a purchase at a token price the powerup function worked out from the live USD rate.
create or replace function public.start_token_purchase_priced(p_user uuid, p_tier int, p_price numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; t jsonb; pid uuid; sp jsonb; adm boolean;
begin
  select * into cfg from game_config;
  select coalesce(is_admin, false) into adm from profiles where id = p_user;
  if not (cfg.token_upgrades_enabled or adm) then return jsonb_build_object('error','off'); end if;
  if p_price is null or p_price <= 0 then return jsonb_build_object('error','tier'); end if;
  if cfg.token_mint is null or cfg.token_vault_wallet is null or cfg.token_drops_wallet is null or cfg.token_dev_wallet is null
     or coalesce((cfg.token_split->>'burn')::int, 0) + coalesce((cfg.token_split->>'vault')::int, 0)
      + coalesce((cfg.token_split->>'drops')::int, 0) + coalesce((cfg.token_split->>'dev')::int, 0) <> 100 then
    return jsonb_build_object('error','not_set_up');
  end if;
  select e.v into t from jsonb_array_elements(cfg.upgrade_tiers) as e(v) where (e.v->>'tier')::int = p_tier;
  if t is null then return jsonb_build_object('error','tier'); end if;
  sp := jsonb_build_object('burn_pct', coalesce((cfg.token_split->>'burn')::int, 0), 'to', jsonb_build_array(
    jsonb_build_object('key','vault','wallet',cfg.token_vault_wallet,'pct',coalesce((cfg.token_split->>'vault')::int, 0)),
    jsonb_build_object('key','drops','wallet',cfg.token_drops_wallet,'pct',coalesce((cfg.token_split->>'drops')::int, 0)),
    jsonb_build_object('key','dev','wallet',cfg.token_dev_wallet,'pct',coalesce((cfg.token_split->>'dev')::int, 0))));
  insert into token_purchases (user_id, season_id, tier, points, price, cluster, mint, splits, decimals)
    values (p_user, coalesce((current_season()).id, 0), p_tier, (t->>'points')::int, p_price,
            cfg.token_cluster, cfg.token_mint, sp, cfg.token_decimals)
    returning id into pid;
  return jsonb_build_object('purchase_id', pid, 'price', p_price, 'points', (t->>'points')::int,
    'cluster', cfg.token_cluster, 'mint', cfg.token_mint, 'splits', sp, 'decimals', cfg.token_decimals);
end $$;
revoke execute on function public.start_token_purchase_priced(uuid, int, numeric) from public, anon, authenticated;
grant execute on function public.start_token_purchase_priced(uuid, int, numeric) to service_role;

-- Admin: dollar price and points per tier (arrays in tier order; null leaves a value as it is, 0 clears the dollar price).
create or replace function public.admin_power_up_usd(p_usd numeric[], p_points int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tiers jsonb;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select jsonb_agg(
      case when p_points is not null and p_points[(e.v->>'tier')::int] is not null and p_points[(e.v->>'tier')::int] > 0
           then jsonb_set(e.v, '{points}', to_jsonb(p_points[(e.v->>'tier')::int])) else e.v end
      || case when p_usd is not null and p_usd[(e.v->>'tier')::int] is not null
              then jsonb_build_object('usd', p_usd[(e.v->>'tier')::int]) else '{}'::jsonb end
      order by (e.v->>'tier')::int)
    into tiers from game_config c, jsonb_array_elements(c.upgrade_tiers) as e(v);
  update game_config set upgrade_tiers = coalesce(tiers, upgrade_tiers) where id;
  return power_ups();
end $$;
