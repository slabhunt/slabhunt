-- Street-aware spawns. The `spawnmap` edge function turns OpenStreetMap tiles (zoom 14, ~2 km) into lists of clear
-- spots (no roads, rail, buildings or water). spawn_here places creatures on those spots; where an area isn't mapped
-- yet it queues it, asks spawnmap to process it right away, and falls back to the old random placement meanwhile.
create table if not exists public.spawn_cells (
  tile text primary key,                 -- '14/x/y'
  status text not null default 'pending', -- pending | working | ready | failed
  points int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);
create table if not exists public.spawn_points (
  id bigserial primary key,
  tile text not null references public.spawn_cells(tile),
  lat double precision not null,
  lng double precision not null
);
create index if not exists spawn_points_latlng on public.spawn_points (lat, lng);
create index if not exists spawn_cells_status on public.spawn_cells (status, updated_at);
alter table public.spawn_cells enable row level security;
alter table public.spawn_points enable row level security;
revoke all on public.spawn_cells, public.spawn_points from anon, authenticated;

create or replace function public.tile14(p_lat float8, p_lng float8) returns text
language sql immutable set search_path = public as $$
  select '14/' || floor((p_lng + 180) / 360 * 16384)::int || '/' ||
         floor((1 - ln(tan(radians(p_lat)) + 1 / cos(radians(p_lat))) / pi()) / 2 * 16384)::int
$$;

-- Queue the tiles around a spot (~450 m each way) and, if any are new, ask spawnmap to process them now.
create or replace function public.queue_spawn_area(p_lat float8, p_lng float8) returns int
language plpgsql security definer set search_path = public as $$
declare dlat float8 := 450 / 111320.0; dlng float8 := 450 / (111320.0 * greatest(cos(radians(p_lat)), 0.01)); added int;
begin
  with t as (
    select distinct tile14(p_lat + a * dlat, p_lng + b * dlng) as tile from (values (-1), (0), (1)) va(a), (values (-1), (0), (1)) vb(b)
  ), ins as (
    insert into spawn_cells (tile) select tile from t on conflict (tile) do nothing returning 1
  ) select count(*) into added from ins;
  if added > 0 then
    begin
      perform net.http_post(
        url := 'https://naghdnhloupdnsmuhqws.supabase.co/functions/v1/spawnmap',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 55000);
    exception when others then null; -- the minute job will pick it up
    end;
  end if;
  return added;
end $$;

-- spawnmap: claim up to N tiles to process (pending, failed over an hour ago, or stuck working over 5 minutes).
create or replace function public.spawn_cells_pending(p_limit int default 3) returns setof text
language sql security definer set search_path = public as $$
  update spawn_cells c set status = 'working', updated_at = now()
   where c.tile in (
     select tile from spawn_cells
      where status = 'pending'
         or (status = 'failed' and updated_at < now() - interval '1 hour')
         or (status = 'working' and updated_at < now() - interval '5 minutes')
      order by updated_at limit greatest(1, least(p_limit, 10))
      for update skip locked)
  returning c.tile;
$$;

create or replace function public.spawn_cell_store(p_tile text, p_points jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if exists (select 1 from spawn_points where tile = p_tile) then
    update spawn_cells set status = 'ready', updated_at = now() where tile = p_tile;
    return 0;
  end if;
  insert into spawn_points (tile, lat, lng)
  select p_tile, (e->>'lat')::float8, (e->>'lng')::float8 from jsonb_array_elements(p_points) e
   where (e->>'lat') is not null and (e->>'lng') is not null;
  get diagnostics n = row_count;
  update spawn_cells set status = 'ready', points = n, error = null, updated_at = now() where tile = p_tile;
  return n;
end $$;

create or replace function public.spawn_cell_fail(p_tile text, p_error text) returns void
language sql security definer set search_path = public as $$
  update spawn_cells set status = 'failed', error = left(p_error, 200), updated_at = now() where tile = p_tile;
$$;

-- A clear spot 60-400 m from the explorer that no live creature is already standing on (null if none known).
create or replace function public.pick_spawn_point(p_lat float8, p_lng float8, p_min float8, p_max float8,
  out lat float8, out lng float8)
language sql stable security definer set search_path = public as $$
  select sp.lat, sp.lng from spawn_points sp
   where sp.lat between p_lat - p_max / 111320.0 and p_lat + p_max / 111320.0
     and sp.lng between p_lng - p_max / (111320.0 * greatest(cos(radians(p_lat)), 0.01))
                    and p_lng + p_max / (111320.0 * greatest(cos(radians(p_lat)), 0.01))
     and distance_m(sp.lat, sp.lng, p_lat, p_lng) between p_min and p_max
     and not exists (select 1 from drops d where d.caught_by is null and d.expires_at > now()
                       and abs(d.lat - sp.lat) < 0.0002 and abs(d.lng - sp.lng) < 0.0003
                       and distance_m(d.lat, d.lng, sp.lat, sp.lng) < 15)
   order by random() limit 1;
$$;

revoke execute on function public.tile14(float8, float8), public.queue_spawn_area(float8, float8),
  public.spawn_cells_pending(int), public.spawn_cell_store(text, jsonb), public.spawn_cell_fail(text, text),
  public.pick_spawn_point(float8, float8, float8, float8) from public, anon, authenticated;
grant execute on function public.spawn_cells_pending(int), public.spawn_cell_store(text, jsonb), public.spawn_cell_fail(text, text) to service_role;

-- Same as before (cooldown, hotspot boosts, season species), but creatures stand on clear ground when the area is mapped.
create or replace function public.spawn_here()
returns integer language plpgsql security definer set search_path = public as $function$
declare cfg game_config; p profiles; cur record; have int; need int; i int; d float8; b float8;
  sp smallint; total int; roll int; ss seasons; boost int := 1; since timestamptz; spot record; plat float8; plng float8;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
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

-- Keep processing the queue every minute.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'vaulthunt-spawnmap') then perform cron.unschedule('vaulthunt-spawnmap'); end if;
end $$;
select cron.schedule('vaulthunt-spawnmap', '* * * * *', $job$
  select net.http_post(
    url := 'https://naghdnhloupdnsmuhqws.supabase.co/functions/v1/spawnmap',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 55000)
  where exists (select 1 from public.spawn_cells where status in ('pending', 'working') or (status = 'failed' and updated_at < now() - interval '1 hour'))
$job$);
