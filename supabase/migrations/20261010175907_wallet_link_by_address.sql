-- Link a wallet just by pasting its address (no signature). One player per address.
-- A player who later proves ownership by signing takes the address over (see the wallet function).
alter table public.wallets add column verified boolean not null default true;
alter table public.wallets alter column verified set default false;

create function public.link_wallet_address(p_address text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a text := trim(p_address); other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if a !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return jsonb_build_object('error','bad_address'); end if;
  select user_id into other from wallets where address = a;
  if other is not null and other <> auth.uid() then return jsonb_build_object('error','taken'); end if;
  insert into wallets (user_id, address, verified, verified_at) values (auth.uid(), a, false, now())
    on conflict (user_id) do update set address = excluded.address, verified = false, verified_at = now();
  update profiles set wallet = coalesce(wallet, a) where id = auth.uid();
  return jsonb_build_object('linked', a, 'verified', false);
end $$;
revoke all on function public.link_wallet_address(text) from public, anon;
grant execute on function public.link_wallet_address(text) to authenticated;
