-- Security hardening after Supabase advisor review.

-- 1) Replace the security-definer view with a small public table kept in sync by a trigger.
--    It holds only safe columns (no wallet, no location), readable by signed-in players.
drop view if exists public.public_profiles;
create table public.public_profiles (
  id           uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null,
  xp           int  not null default 0,
  catches      int  not null default 0
);
alter table public.public_profiles enable row level security;
create policy "read public profiles" on public.public_profiles for select to authenticated using (true);
grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;
create index public_profiles_xp on public.public_profiles (xp desc);

create function public.sync_public_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.public_profiles (id, display_name, xp, catches)
  values (new.id, new.display_name, new.xp, new.catches)
  on conflict (id) do update set display_name = excluded.display_name, xp = excluded.xp, catches = excluded.catches;
  return new;
end $$;
create trigger profiles_sync_public after insert or update of display_name, xp, catches on public.profiles
  for each row execute function public.sync_public_profile();
insert into public.public_profiles (id, display_name, xp, catches)
  select id, display_name, xp, catches from public.profiles on conflict do nothing;

-- 2) Pin search_path on the distance helper.
alter function public.distance_m(float8, float8, float8, float8) set search_path = '';

-- 3) Trigger-only functions should not be callable through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_public_profile() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
