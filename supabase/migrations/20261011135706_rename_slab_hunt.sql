-- The game is now called Slab Hunt: the wallet-link message players sign says so.
create or replace function public.wallet_challenge() returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  n := replace(gen_random_uuid()::text, '-', '');
  insert into wallet_nonces (user_id, nonce) values (auth.uid(), n)
    on conflict (user_id) do update set nonce = excluded.nonce, created_at = now();
  return 'Slab Hunt wants you to link this wallet to your player.' || chr(10) ||
         'This does not move any funds.' || chr(10) || 'Nonce: ' || n;
end $$;
