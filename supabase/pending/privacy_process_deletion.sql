-- NOT APPLIED YET: needs approval because it deletes a player's personal rows.
-- Privacy tools, part 2 (server only): remove one player's personal data when their deletion request is processed.
-- Prize wins, token payments and signed-terms dates stay for legal records, with the name and network details removed.
-- Server only: remove a player's personal data. The account function then locks the login.
create or replace function public.process_account_deletion(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tag text := 'deleted-' || left(md5(p_user::text || clock_timestamp()::text), 8);
begin
  update profiles set display_name = tag, wallet = null, last_lat = null, last_lng = null,
    exp_from_lat = null, exp_from_lng = null, exp_to_lat = null, exp_to_lng = null, vault_holder = false
   where id = p_user;
  delete from wallets where user_id = p_user;
  delete from wallet_nonces where user_id = p_user;
  delete from chat_messages where user_id = p_user;
  delete from draw_checkins where user_id = p_user;
  delete from vault_draw_tickets t using vault_draws d where t.draw_id = d.id and d.status = 'open' and t.user_id = p_user;
  update terms_acceptances set signed_name = 'deleted', ip = null, user_agent = null where user_id = p_user;
  update account_deletion_requests set status = 'done', processed_at = now() where user_id = p_user and status = 'pending';
  return jsonb_build_object('user', p_user, 'name', tag);
end $$;
revoke execute on function public.process_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.process_account_deletion(uuid) to service_role;

