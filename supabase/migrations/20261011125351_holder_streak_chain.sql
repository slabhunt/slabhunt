-- Holder streaks: weekly windows must chain (claims at most 8 days apart).
create or replace function public.credit_holder_reward_v2(p_user uuid, p_wallet text, p_balance numeric, p_week_balance numeric,
  p_nfts int, p_day_cells int, p_week_cells int, p_nft_cells int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare wk date := date_trunc('week', now() at time zone 'utc')::date; v_full boolean := p_week_cells > 0;
  prev holder_claims; s int := 0; m numeric := 1; bonus int := 0; total int;
begin
  if p_day_cells + p_nft_cells < 1 then return jsonb_build_object('error','not_eligible'); end if;
  if v_full then
    select * into prev from holder_claims where user_id = p_user and wallet = p_wallet and week = wk - 7;
    -- Streak continues only if the last full week was claimed at most 8 days ago, so the 7-day windows leave at most
    -- a 1-day gap: one bag of tokens can't keep week-long streaks going in two wallets.
    s := case when prev.full_week and prev.claimed_at > now() - interval '8 days' then prev.streak + 1 else 1 end;
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

revoke execute on function public.credit_holder_reward_v2(uuid, text, numeric, numeric, int, int, int, int) from public, anon, authenticated;
grant execute on function public.credit_holder_reward_v2(uuid, text, numeric, numeric, int, int, int, int) to service_role;
