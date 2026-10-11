-- Unique usernames (case-insensitive), so players can sign in with a username.
-- New players get a random "hunterNNNNN" name instead of the start of their email, which kept emails private.
create unique index if not exists profiles_display_name_lower on public.profiles (lower(display_name));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg game_config; nm text;
begin
  select * into cfg from game_config;
  loop
    nm := 'hunter' || lpad((floor(random() * 100000))::int::text, 5, '0');
    exit when not exists (select 1 from profiles where lower(display_name) = nm);
  end loop;
  insert into public.profiles (id, display_name) values (new.id, nm);
  perform add_coins(new.id, cfg.starter_coins, 'starter');
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Username rules: 3-24 letters, numbers, dots, dashes or underscores. Raises name_invalid / name_taken.
create or replace function public.update_profile(p_name text, p_wallet text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if nm !~ '^[A-Za-z0-9_.-]{3,24}$' then raise exception 'name_invalid'; end if;
  if exists (select 1 from profiles where lower(display_name) = lower(nm) and id <> auth.uid()) then
    raise exception 'name_taken';
  end if;
  update profiles set display_name = nm, wallet = nullif(trim(p_wallet), '') where id = auth.uid();
end $$;

-- Is a username free? (For the profile form.)
create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select trim(coalesce(p_name, '')) ~ '^[A-Za-z0-9_.-]{3,24}$'
     and not exists (select 1 from profiles where lower(display_name) = lower(trim(p_name)) and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
$$;

-- Sign-in attempts by username, for rate limiting in the login function. Server only.
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  ip text,
  ok boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_user_time on public.login_attempts (lower(username), created_at);
create index if not exists login_attempts_ip_time on public.login_attempts (ip, created_at);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;
