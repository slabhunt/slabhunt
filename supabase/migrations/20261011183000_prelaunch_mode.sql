-- Pre-launch mode. While game_config.prelaunch is true, slabhunt.fun opens on the early-access signup page and only
-- admins can enter the game; on the server, spawn_here gives creatures to admins only. Turn it off on /admin at launch.
alter table public.game_config add column if not exists prelaunch boolean not null default true;

-- Public: is the game open yet? (no player data)
create or replace function public.site_mode() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('prelaunch', coalesce((select prelaunch from game_config limit 1), true));
$$;
revoke execute on function public.site_mode() from public;
grant execute on function public.site_mode() to anon, authenticated;

create or replace function public.admin_set_prelaunch(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update game_config set prelaunch = coalesce(p_on, prelaunch) where id;
  return site_mode();
end $$;
revoke execute on function public.admin_set_prelaunch(boolean) from public, anon;
grant execute on function public.admin_set_prelaunch(boolean) to authenticated;

create or replace function public.spawn_here()
returns integer language plpgsql security definer set search_path = public as $function$
declare cfg game_config; p profiles; cur record; have int; need int; i int; d float8; b float8;
  sp smallint; total int; roll int; ss seasons; boost int := 1; since timestamptz; spot record; plat float8; plng float8;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  -- Before launch only admins get creatures (so nobody farms coins or entries early).
  if cfg.prelaunch and not is_admin() then return 0; end if;
  select * into p from profiles where id = auth.uid() for update;
  select * into cur from explorer_now(p);
  if cur.lat is null or not cur.arrived then return 0; end if;
  perform queue_spawn_area(cur.lat, cur.lng);
  if p.last_spawn_at is not null and p.last_spawn_at > now() - make_interval(secs => cfg.spawn_cooldown_s) then return 0; end if;
  ss := current_season();
  since := coalesce(ss.starts_at, '-infinity'::timestamptz);
  if ss.id is not null then
    select coalesce(max(h.boost), 1) into boost from hotspots h
     where h.season_id = ss.id and distance_m(h.lat, h.lng, cur.lat, cur.lng) <= h.radius_m;
  end if;
  select count(*) into have from drops
   where caught_by is null and expires_at > now()
     and lat between cur.lat - 0.005 and cur.lat + 0.005
     and lng between cur.lng - 0.007 and cur.lng + 0.007
     and distance_m(lat, lng, cur.lat, cur.lng) <= 500;
  need := greatest(cfg.drops_per_area - have, 0);
  select sum(s.spawn_weight * case when s.season_id = ss.id then boost else 1 end) into total
    from species s where s.season_id is null or s.season_id in (select id from seasons where starts_at <= since);
  for i in 1..need loop
    roll := floor(random() * total)::int;
    select x.id into sp from (
      select s.id, sum(s.spawn_weight * case when s.season_id = ss.id then boost else 1 end) over (order by s.id) as cum
        from species s where s.season_id is null or s.season_id in (select id from seasons where starts_at <= since)) x
     where x.cum > roll order by x.cum limit 1;
    select * into spot from pick_spawn_point(cur.lat, cur.lng, 60, 400);
    if spot.lat is not null then
      plat := spot.lat; plng := spot.lng;
    else
      d := 60 + random() * 340;
      b := random() * 2 * pi();
      plat := cur.lat + (d * cos(b)) / 111320;
      plng := cur.lng + (d * sin(b)) / (111320 * cos(radians(cur.lat)));
    end if;
    insert into drops (species_id, lat, lng, expires_at)
    values (sp, plat, plng, now() + make_interval(mins => 10 + floor(random() * 15)::int));
  end loop;
  update profiles set last_spawn_at = now() where id = auth.uid();
  return need;
end $function$;
