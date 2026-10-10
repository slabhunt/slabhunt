-- Genesis whitelist: the first 100 players (by signup) who link a wallet get a free mint.
-- The first collection (Season 1) is 420 passes.
alter table public.game_config add column whitelist_size int not null default 100;
update public.seasons set supply = 420 where id = 1;

create function public.whitelist_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg game_config; signup_rank int; wl_rank int; has_wallet boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select exists (select 1 from wallets where user_id = auth.uid()) into has_wallet;
  select r into signup_rank from (select id, row_number() over (order by created_at, id) r from profiles) x where x.id = auth.uid();
  select r into wl_rank from (
    select p.id, row_number() over (order by p.created_at, p.id) r
      from profiles p join wallets w on w.user_id = p.id) x where x.id = auth.uid();
  return jsonb_build_object(
    'size', cfg.whitelist_size,
    'signup_rank', signup_rank,
    'has_wallet', has_wallet,
    'rank', wl_rank,
    'on_list', wl_rank is not null and wl_rank <= cfg.whitelist_size,
    'spots_taken', least((select count(*) from wallets), cfg.whitelist_size));
end $$;

create function public.admin_whitelist() returns table (rank bigint, display_name text, address text)
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select whitelist_size into n from game_config;
  return query
    select x.r, x.display_name, x.address from (
      select row_number() over (order by p.created_at, p.id) r, p.display_name, w.address
        from profiles p join wallets w on w.user_id = p.id) x
    where x.r <= n order by x.r;
end $$;

revoke all on function public.whitelist_status(), public.admin_whitelist() from public, anon;
grant execute on function public.whitelist_status(), public.admin_whitelist() to authenticated;
