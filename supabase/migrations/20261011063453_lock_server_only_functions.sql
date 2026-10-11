-- Supabase's default privileges grant EXECUTE on new functions to `authenticated` directly, so
-- "revoke ... from public, anon" is not enough. These are server-only: no player may call them.
revoke execute on function public.credit_holder_reward(uuid, text, numeric, int, int),
  public.fair_freeze(text, bigint, jsonb), public.fair_mark_committed(bigint, text, text, text, bigint),
  public.fair_mark_result_tx(bigint, text), public.fair_pending(), public.auto_open_vault_draws(),
  public.fair_settle(bigint, text), public.settle_vault_draws(), public.fair_code(uuid, text, bigint),
  public.hex_to_numeric(text), public.cron_secret_ok(text), public.holder_auto_candidates(int), public.holder_mark_checked(uuid, text)
  from authenticated, anon, public;
grant execute on function public.credit_holder_reward(uuid, text, numeric, int, int),
  public.fair_mark_committed(bigint, text, text, text, bigint), public.fair_mark_result_tx(bigint, text), public.fair_pending(),
  public.auto_open_vault_draws(), public.fair_settle(bigint, text), public.settle_vault_draws(),
  public.cron_secret_ok(text), public.holder_auto_candidates(int), public.holder_mark_checked(uuid, text) to service_role;
alter function public.hex_to_numeric(text) set search_path = public;

-- Stop this happening again: new functions in public are no longer executable by players unless granted.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
