-- Explorer mode: players send an explorer anywhere on the world map instead of walking.
-- The server owns the explorer's position and travel times, so a modified app can't teleport.
-- Real walking is optional and earns bonus entries.

alter table public.game_config
  add column travel_speed_mps     double precision not null default 300,  -- how fast explorers move
  add column travel_min_s         int not null default 4,                 -- shortest hop
  add column travel_max_s         int not null default 90,                -- longest trip (other side of the world)
  add column max_catches_per_hour int not null default 40,
  add column walk_bonus_entries   int not null default 1;                 -- extra entries when you're really there

alter table public.profiles
  add column exp_from_lat  double precision,
  add column exp_from_lng  double precision,
  add column exp_to_lat    double precision,
  add column exp_to_lng    double precision,
  add column exp_depart_at timestamptz,
  add column exp_arrive_at timestamptz;

-- Where a player's explorer is right now (interpolated along its trip).
create function public.explorer_now(p public.profiles, out lat float8, out lng float8, out arrived boolean)
language plpgsql stable set search_path = public as $$
declare t float8;
begin
  if p.exp_to_lat is null then lat := null; lng := null; arrived := false; return; end if;
  if p.exp_arrive_at <= now() then
    lat := p.exp_to_lat; lng := p.exp_to_lng; arrived := true; return;
  end if;
  t := extract(epoch from now() - p.exp_depart_at) / greatest(extract(epoch from p.exp_arrive_at - p.exp_depart_at), 0.001);
  t := least(greatest(t, 0), 1);
  lat := p.exp_from_lat + (p.exp_to_lat - p.exp_from_lat) * t;
  lng := p.exp_from_lng + (p.exp_to_lng - p.exp_from_lng) * t;
  arrived := false;
end $$;
revoke execute on function public.explorer_now(public.profiles) from public, anon, authenticated;

create function public.explorer_json(p public.profiles) returns jsonb
language sql stable set search_path = public as $$
  select case when p.exp_to_lat is null then null else jsonb_build_object(
    'from_lat', p.exp_from_lat, 'from_lng', p.exp_from_lng,
    'to_lat', p.exp_to_lat, 'to_lng', p.exp_to_lng,
    'depart_at', p.exp_depart_at, 'arrive_at', p.exp_arrive_at, 'server_now', now()) end
$$;
revoke execute on function public.explorer_json(public.profiles) from public, anon, authenticated;

-- Your explorer's current trip (null if you haven't been placed yet).
create function public.my_explorer() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from profiles where id = auth.uid();
  return explorer_json(p);
end $$;

-- Send your explorer somewhere. The first call places it instantly.
create function public.travel_to(p_lat float8, p_lng float8) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; cur record; secs float8;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_lat not between -85 and 85 or p_lng not between -180 and 180 then raise exception 'bad destination'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;
  if p.exp_to_lat is null then
    update profiles set exp_from_lat = p_lat, exp_from_lng = p_lng, exp_to_lat = p_lat, exp_to_lng = p_lng,
      exp_depart_at = now(), exp_arrive_at = now() where id = auth.uid() returning * into p;
    return explorer_json(p);
  end if;
  select * into cur from explorer_now(p);
  secs := least(greatest(distance_m(cur.lat, cur.lng, p_lat, p_lng) / cfg.travel_speed_mps, cfg.travel_min_s), cfg.travel_max_s);
  update profiles set exp_from_lat = cur.lat, exp_from_lng = cur.lng, exp_to_lat = p_lat, exp_to_lng = p_lng,
    exp_depart_at = now(), exp_arrive_at = now() + make_interval(secs => secs)
   where id = auth.uid() returning * into p;
  return explorer_json(p);
end $$;

-- Top up creatures around your explorer once it has arrived. Places them 60–400 m away.
create function public.spawn_here() returns int
language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; cur record; have int; need int; i int; d float8; b float8; sp smallint; total int; roll int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;
  select * into cur from explorer_now(p);
  if cur.lat is null or not cur.arrived then return 0; end if;
  if p.last_spawn_at is not null and p.last_spawn_at > now() - make_interval(secs => cfg.spawn_cooldown_s) then return 0; end if;

  select count(*) into have from drops
   where caught_by is null and expires_at > now()
     and lat between cur.lat - 0.005 and cur.lat + 0.005
     and lng between cur.lng - 0.007 and cur.lng + 0.007
     and distance_m(lat, lng, cur.lat, cur.lng) <= 500;
  need := greatest(cfg.drops_per_area - have, 0);
  select sum(spawn_weight) into total from species;
  for i in 1..need loop
    roll := floor(random() * total)::int;
    select s.id into sp from (select id, sum(spawn_weight) over (order by id) as cum from species) s
     where s.cum > roll order by s.cum limit 1;
    d := 60 + random() * 340;
    b := random() * 2 * pi();
    insert into drops (species_id, lat, lng, expires_at) values (
      sp,
      cur.lat + (d * cos(b)) / 111320,
      cur.lng + (d * sin(b)) / (111320 * cos(radians(cur.lat))),
      now() + make_interval(mins => 10 + floor(random() * 15)::int));
  end loop;
  update profiles set last_spawn_at = now() where id = auth.uid();
  return need;
end $$;

-- Catch with your explorer. If you're also physically there (GPS), you earn bonus entries.
create function public.catch_drop(p_drop uuid, p_quality real,
  p_gps_lat float8 default null, p_gps_lng float8 default null, p_gps_accuracy float8 default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; d drops; s species; cur record; r int; chance float8;
  walked boolean := false; bonus int := 0; recent int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;

  if p.last_attempt_at is not null and p.last_attempt_at > now() - make_interval(secs => cfg.attempt_cooldown_ms / 1000.0) then
    return jsonb_build_object('result','cooldown');
  end if;
  update profiles set last_attempt_at = now() where id = auth.uid();

  select count(*) into recent from catches where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent >= cfg.max_catches_per_hour then return jsonb_build_object('result','limit'); end if;

  select * into d from drops where id = p_drop for update;
  if not found or d.caught_by is not null or d.expires_at <= now() then
    return jsonb_build_object('result','gone');
  end if;

  -- Real-world bonus: a steady GPS fix within range of the creature
  if p_gps_lat is not null and p_gps_accuracy is not null and p_gps_accuracy <= cfg.max_accuracy_m
     and distance_m(d.lat, d.lng, p_gps_lat, p_gps_lng) <= cfg.catch_radius_m + least(p_gps_accuracy, 30)
     and report_position(p_gps_lat, p_gps_lng, p_gps_accuracy) then
    walked := true; bonus := cfg.walk_bonus_entries;
  end if;

  if not walked then
    select * into cur from explorer_now(p);
    if cur.lat is null or not cur.arrived then return jsonb_build_object('result','traveling'); end if;
    if distance_m(d.lat, d.lng, cur.lat, cur.lng) > cfg.catch_radius_m then return jsonb_build_object('result','too_far'); end if;
  end if;

  select * into s from species where id = d.species_id;
  chance := s.catch_chance * (0.5 + 0.5 * least(greatest(coalesce(p_quality, 0), 0), 1));

  if random() < chance then
    select id into r from rounds where status = 'open';
    update drops set caught_by = auth.uid(), caught_at = now() where id = d.id;
    insert into catches (user_id, drop_id, species_id, round_id, entries, xp)
      values (auth.uid(), d.id, s.id, r, s.entries + bonus, s.xp);
    update profiles set xp = xp + s.xp, catches = catches + 1 where id = auth.uid();
    if s.rarity <> 'c' then
      insert into chat_messages (user_id, kind, body)
        values (auth.uid(), 'catch', 'caught a ' || s.name || case when s.rarity = 'r' then ' (rare!)' else '' end
          || case when walked then ' on foot' else '' end);
    end if;
    return jsonb_build_object('result','caught','entries',s.entries + bonus,'xp',s.xp,'species',s.id,'walked',walked);
  elsif random() < s.flee_chance then
    update drops set expires_at = now() where id = d.id;
    return jsonb_build_object('result','fled');
  else
    return jsonb_build_object('result','escaped');
  end if;
end $$;

-- Only the explorer-mode functions are callable now.
revoke execute on function public.attempt_catch(uuid, float8, float8, float8, real) from authenticated;
revoke execute on function public.spawn_nearby(float8, float8) from authenticated;
revoke all on function public.my_explorer(), public.travel_to(float8, float8), public.spawn_here(),
  public.catch_drop(uuid, real, float8, float8, float8) from public, anon;
grant execute on function public.my_explorer(), public.travel_to(float8, float8), public.spawn_here(),
  public.catch_drop(uuid, real, float8, float8, float8) to authenticated;
