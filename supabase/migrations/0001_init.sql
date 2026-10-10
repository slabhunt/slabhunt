-- Vault Hunt MVP schema
-- Run in the Supabase SQL editor (or `supabase db push`).
-- All game rules that matter (distance checks, catch odds, entries, draws)
-- run on the server so a modified client can't award itself entries.

create extension if not exists pgcrypto;

---------------------------------------------------------------------------
-- Config
---------------------------------------------------------------------------
create table public.game_config (
  id boolean primary key default true check (id),           -- single row
  catch_radius_m      double precision not null default 60,  -- how close you must stand
  max_accuracy_m      double precision not null default 50,  -- reject fuzzy GPS fixes
  max_speed_mps       double precision not null default 40,  -- anti-teleport (raise while testing)
  drops_per_area      int not null default 6,                -- target creatures within 500 m
  spawn_cooldown_s    int not null default 20,
  attempt_cooldown_ms int not null default 1200
);
insert into public.game_config default values;

---------------------------------------------------------------------------
-- Creatures (original designs; client has matching art)
---------------------------------------------------------------------------
create table public.species (
  id            smallint primary key,
  name          text not null,
  rarity        text not null check (rarity in ('c','u','r')),
  entries       int  not null,
  xp            int  not null,
  catch_chance  real not null,
  flee_chance   real not null,
  spawn_weight  int  not null
);
insert into public.species values
  (0,'Pebblit', 'c',1,10,0.85,0.10,21),
  (1,'Mossling','c',1,10,0.85,0.10,21),
  (2,'Driplet', 'c',1,10,0.85,0.10,20),
  (3,'Emberkit','u',2,25,0.70,0.25,10),
  (4,'Voltmoth','u',2,25,0.70,0.25,10),
  (5,'Thornpup','u',2,25,0.70,0.25,10),
  (6,'Frostnib','r',5,60,0.50,0.40,4),
  (7,'Lumenray','r',5,60,0.50,0.40,4);

---------------------------------------------------------------------------
-- Players
---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  display_name    text not null check (char_length(display_name) between 1 and 24),
  xp              int  not null default 0,
  catches         int  not null default 0,
  wallet          text check (wallet is null or wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  is_admin        boolean not null default false,
  last_lat        double precision,
  last_lng        double precision,
  last_seen       timestamptz,
  last_spawn_at   timestamptz,
  last_attempt_at timestamptz,
  created_at      timestamptz not null default now()
);

-- Create a profile when someone signs up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(split_part(new.email,'@',1),''),'Hunter'), 24));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Public, safe columns only (no wallet, no location)
create view public.public_profiles as
  select id, display_name, xp, catches from public.profiles;

---------------------------------------------------------------------------
-- Rounds (one prize card per round)
---------------------------------------------------------------------------
create table public.rounds (
  id            serial primary key,
  prize_name    text not null default 'Graded card (to be announced)',
  prize_grade   text not null default '',
  prize_mint    text,                       -- Collector Crypt NFT mint, once bought
  status        text not null default 'open' check (status in ('open','drawn')),
  opened_at     timestamptz not null default now(),
  drawn_at      timestamptz,
  winner        uuid references public.profiles(id),
  total_entries int
);
create unique index one_open_round on public.rounds ((status)) where status = 'open';
insert into public.rounds default values;

---------------------------------------------------------------------------
-- Drops, catches, chat
---------------------------------------------------------------------------
create table public.drops (
  id          uuid primary key default gen_random_uuid(),
  species_id  smallint not null references public.species(id),
  lat         double precision not null,
  lng         double precision not null,
  expires_at  timestamptz not null,
  caught_by   uuid references public.profiles(id),
  caught_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index drops_active on public.drops (lat, lng) where caught_by is null;

create table public.catches (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  drop_id     uuid not null references public.drops(id),
  species_id  smallint not null references public.species(id),
  round_id    int not null references public.rounds(id),
  entries     int not null,
  xp          int not null,
  created_at  timestamptz not null default now()
);
create index catches_round on public.catches (round_id, user_id);

create table public.chat_messages (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'msg' check (kind in ('msg','catch','draw')),
  body        text not null check (char_length(body) between 1 and 280),
  created_at  timestamptz not null default now()
);

---------------------------------------------------------------------------
-- Row level security
---------------------------------------------------------------------------
alter table public.game_config   enable row level security;
alter table public.species       enable row level security;
alter table public.profiles      enable row level security;
alter table public.rounds        enable row level security;
alter table public.drops         enable row level security;
alter table public.catches       enable row level security;
alter table public.chat_messages enable row level security;

create policy "read config"   on public.game_config for select to authenticated using (true);
create policy "read species"  on public.species     for select to authenticated using (true);
create policy "own profile"   on public.profiles    for select to authenticated using (id = auth.uid());
create policy "read rounds"   on public.rounds      for select to authenticated using (true);
create policy "read drops"    on public.drops       for select to authenticated using (true);
create policy "own catches"   on public.catches     for select to authenticated using (user_id = auth.uid());
create policy "read chat"     on public.chat_messages for select to authenticated using (true);
create policy "post chat"     on public.chat_messages for insert to authenticated
  with check (user_id = auth.uid() and kind = 'msg');
-- No direct writes to profiles/drops/catches/rounds: everything goes through the functions below.

grant select on public.public_profiles to authenticated;

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------
create function public.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Record a GPS fix. Returns false if the jump from the last fix is impossibly fast.
create function public.report_position(p_lat float8, p_lng float8, p_accuracy float8)
returns boolean language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; secs float8; ok boolean := true;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  if p_accuracy > cfg.max_accuracy_m or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return false;
  end if;
  select * into p from profiles where id = auth.uid() for update;
  if p.last_seen is not null and p.last_seen > now() - interval '10 minutes' then
    secs := greatest(extract(epoch from now() - p.last_seen), 1);
    ok := distance_m(p.last_lat, p.last_lng, p_lat, p_lng) / secs <= cfg.max_speed_mps;
  end if;
  if ok then
    update profiles set last_lat = p_lat, last_lng = p_lng, last_seen = now() where id = auth.uid();
  end if;
  return ok;
end $$;

-- Top up creatures around the player. Places them 60–400 m away.
create function public.spawn_nearby(p_lat float8, p_lng float8)
returns int language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; have int; need int; i int; d float8; b float8; sp smallint; total int; roll int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;
  -- only spawn where the player actually is
  if p.last_seen is null or p.last_seen < now() - interval '2 minutes'
     or distance_m(p.last_lat, p.last_lng, p_lat, p_lng) > 100 then return 0; end if;
  if p.last_spawn_at is not null and p.last_spawn_at > now() - make_interval(secs => cfg.spawn_cooldown_s) then return 0; end if;

  select count(*) into have from drops
   where caught_by is null and expires_at > now()
     and lat between p_lat - 0.005 and p_lat + 0.005
     and lng between p_lng - 0.007 and p_lng + 0.007
     and distance_m(lat, lng, p_lat, p_lng) <= 500;
  need := greatest(cfg.drops_per_area - have, 0);
  select sum(spawn_weight) into total from species;
  for i in 1..need loop
    roll := floor(random() * total)::int;
    select s.id into sp from (
      select id, sum(spawn_weight) over (order by id) as cum from species) s
     where s.cum > roll order by s.cum limit 1;
    d := 60 + random() * 340;                    -- metres
    b := random() * 2 * pi();                    -- bearing
    insert into drops (species_id, lat, lng, expires_at) values (
      sp,
      p_lat + (d * cos(b)) / 111320,
      p_lng + (d * sin(b)) / (111320 * cos(radians(p_lat))),
      now() + make_interval(mins => 10 + floor(random() * 15)::int));
  end loop;
  update profiles set last_spawn_at = now() where id = auth.uid();
  return need;
end $$;

-- Try to catch a creature. `p_quality` (0–1) is how well the throw was timed.
create function public.attempt_catch(p_drop uuid, p_lat float8, p_lng float8, p_accuracy float8, p_quality real)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg game_config; p profiles; d drops; s species; r int; chance float8; place text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into cfg from game_config;
  select * into p from profiles where id = auth.uid() for update;

  if p.last_attempt_at is not null and p.last_attempt_at > now() - make_interval(secs => cfg.attempt_cooldown_ms / 1000.0) then
    return jsonb_build_object('result','cooldown');
  end if;
  update profiles set last_attempt_at = now() where id = auth.uid();

  if not report_position(p_lat, p_lng, p_accuracy) then
    return jsonb_build_object('result','bad_location');
  end if;

  select * into d from drops where id = p_drop for update;
  if not found or d.caught_by is not null or d.expires_at <= now() then
    return jsonb_build_object('result','gone');
  end if;
  if distance_m(d.lat, d.lng, p_lat, p_lng) > cfg.catch_radius_m + least(p_accuracy, 30) then
    return jsonb_build_object('result','too_far');
  end if;

  select * into s from species where id = d.species_id;
  chance := s.catch_chance * (0.5 + 0.5 * least(greatest(coalesce(p_quality, 0), 0), 1));

  if random() < chance then
    select id into r from rounds where status = 'open';
    update drops set caught_by = auth.uid(), caught_at = now() where id = d.id;
    insert into catches (user_id, drop_id, species_id, round_id, entries, xp)
      values (auth.uid(), d.id, s.id, r, s.entries, s.xp);
    update profiles set xp = xp + s.xp, catches = catches + 1 where id = auth.uid();
    if s.rarity <> 'c' then
      insert into chat_messages (user_id, kind, body)
        values (auth.uid(), 'catch', 'caught a ' || s.name || case when s.rarity = 'r' then ' (rare!)' else '' end);
    end if;
    return jsonb_build_object('result','caught','entries',s.entries,'xp',s.xp,'species',s.id);
  elsif random() < s.flee_chance then
    update drops set expires_at = now() where id = d.id;
    return jsonb_build_object('result','fled');
  else
    return jsonb_build_object('result','escaped');
  end if;
end $$;

-- Your entries and everyone's entries in the open round
create function public.round_stats()
returns jsonb language sql security definer set search_path = public stable as $$
  with r as (select id from rounds where status = 'open')
  select jsonb_build_object(
    'round', (select id from r),
    'mine',  coalesce((select sum(entries) from catches where round_id = (select id from r) and user_id = auth.uid()), 0),
    'total', coalesce((select sum(entries) from catches where round_id = (select id from r)), 0),
    'players', (select count(distinct user_id) from catches where round_id = (select id from r)))
$$;

-- Player settings (name and prize wallet)
create function public.update_profile(p_name text, p_wallet text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update profiles set display_name = left(trim(p_name), 24), wallet = nullif(trim(p_wallet), '')
   where id = auth.uid();
end $$;

---------------------------------------------------------------------------
-- Admin: prize and draw
---------------------------------------------------------------------------
create function public.set_prize(p_name text, p_grade text, p_mint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'admins only'; end if;
  update rounds set prize_name = p_name, prize_grade = p_grade, prize_mint = nullif(p_mint,'') where status = 'open';
end $$;

-- Weighted draw: each entry is one ticket. Closes the round and opens the next.
-- MVP uses Postgres random(); swap for on-chain VRF before real prizes.
create function public.run_draw()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rounds; total int; ticket int; w uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'admins only'; end if;
  select * into r from rounds where status = 'open' for update;
  select coalesce(sum(entries),0) into total from catches where round_id = r.id;
  if total > 0 then
    ticket := floor(random() * total)::int;
    select user_id into w from (
      select user_id, sum(e) over (order by user_id) as cum
        from (select user_id, sum(entries) e from catches where round_id = r.id group by user_id) t) c
     where c.cum > ticket order by c.cum limit 1;
  end if;
  update rounds set status = 'drawn', drawn_at = now(), winner = w, total_entries = total where id = r.id;
  insert into rounds default values;
  if w is not null then
    insert into chat_messages (user_id, kind, body)
      values (w, 'draw', 'won round ' || r.id || ': ' || r.prize_name || ' ' || r.prize_grade);
  end if;
  return jsonb_build_object('round', r.id, 'winner', w, 'total', total);
end $$;

-- Lock down function access to signed-in players
revoke all on function public.report_position, public.spawn_nearby, public.attempt_catch,
  public.round_stats, public.update_profile, public.set_prize, public.run_draw from public, anon;
grant execute on function public.report_position, public.spawn_nearby, public.attempt_catch,
  public.round_stats, public.update_profile, public.set_prize, public.run_draw to authenticated;

---------------------------------------------------------------------------
-- Realtime
---------------------------------------------------------------------------
alter publication supabase_realtime add table public.drops, public.chat_messages, public.rounds;

---------------------------------------------------------------------------
-- Housekeeping (optional; needs the pg_cron extension enabled in Supabase)
---------------------------------------------------------------------------
-- select cron.schedule('vh-cleanup', '15 * * * *', $$
--   delete from public.drops where caught_by is null and expires_at < now() - interval '1 hour';
--   delete from public.chat_messages where created_at < now() - interval '30 days';
-- $$);
