-- Public leaderboard data lives in its own table (safe columns only), kept in sync by a trigger.
-- public_profiles becomes a security-invoker view over it, so the app's queries don't change.
create table public.player_cards (
  id           uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null,
  xp           int  not null default 0,
  catches      int  not null default 0
);
alter table public.player_cards enable row level security;
create policy "read player cards" on public.player_cards for select to authenticated using (true);
grant select on public.player_cards to authenticated;
revoke all on public.player_cards from anon;
create index player_cards_xp on public.player_cards (xp desc);

create function public.sync_player_card() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.player_cards (id, display_name, xp, catches)
  values (new.id, new.display_name, new.xp, new.catches)
  on conflict (id) do update set display_name = excluded.display_name, xp = excluded.xp, catches = excluded.catches;
  return new;
end $$;
revoke execute on function public.sync_player_card() from public, anon, authenticated;
create trigger profiles_sync_card after insert or update of display_name, xp, catches on public.profiles
  for each row execute function public.sync_player_card();
insert into public.player_cards (id, display_name, xp, catches)
  select id, display_name, xp, catches from public.profiles on conflict do nothing;

create or replace view public.public_profiles with (security_invoker = true) as
  select id, display_name, xp, catches from public.player_cards;
grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;
