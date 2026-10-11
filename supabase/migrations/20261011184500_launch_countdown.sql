-- Launch time for the countdown on the home/signup page (midnight New York, Oct 12 2026 = 04:00 UTC). Admins can move it.
alter table public.game_config add column if not exists launch_at timestamptz default '2026-10-12 04:00:00+00';

create or replace function public.site_mode() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('prelaunch', coalesce(prelaunch, true), 'launch_at', launch_at, 'server_now', now())
    from game_config limit 1;
$$;
revoke execute on function public.site_mode() from public;
grant execute on function public.site_mode() to anon, authenticated;

create or replace function public.admin_set_launch_at(p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update game_config set launch_at = p_at where id;
  return site_mode();
end $$;
revoke execute on function public.admin_set_launch_at(timestamptz) from public, anon;
grant execute on function public.admin_set_launch_at(timestamptz) to authenticated;
