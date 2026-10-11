-- Vault Draws list: include the fair-draw id (proof link) and auto-open settings for admins.
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
    'auto_open', cfg.draw_auto_open, 'auto_days', cfg.draw_auto_days,
    'draws', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'tier', d.tier, 'ends_at', d.ends_at, 'fair_id', d.fair_id,
        'card', jsonb_build_object('name', c.name, 'grade', c.grade, 'image_url', c.image_url, 'value', c.value_coins),
        'total', coalesce((select sum(coin_tickets + token_tickets) from vault_draw_tickets t where t.draw_id = d.id), 0),
        'players', (select count(*) from vault_draw_tickets t where t.draw_id = d.id),
        'mine', coalesce((select coin_tickets + token_tickets from vault_draw_tickets t where t.draw_id = d.id and t.user_id = auth.uid()), 0))
        order by case d.tier when 'epic' then 0 when 'rare' then 1 else 2 end, d.ends_at)
      from vault_draws d join gacha_cards c on c.id = d.card_id where d.status = 'open'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('tier', d.tier, 'card', c.name || case when c.grade <> '' then ' ' || c.grade else '' end,
          'winner', p.display_name, 'mine', d.winner = auth.uid(), 'drawn_at', d.drawn_at, 'fair_id', d.fair_id) r
        from vault_draws d join gacha_cards c on c.id = d.card_id left join profiles p on p.id = d.winner
        where d.status = 'drawn' order by d.drawn_at desc limit 8) x), '[]'::jsonb),
    'pool', case when is_admin() then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'grade', c.grade, 'tier', c.tier) order by c.id)
        from gacha_cards c where c.status = 'pool' and not exists (select 1 from vault_draws d where d.card_id = c.id and d.status = 'open')), '[]'::jsonb) end);
end $$;
