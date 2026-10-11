-- Players must accept the current Terms and Official Rules (typed-name signature, 18+ and location confirmations)
-- before playing. Each acceptance is kept as a record: version, name typed, time, network address and browser.
create table if not exists public.terms_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  version text not null,
  signed_name text not null check (char_length(signed_name) between 2 and 80),
  confirmed_age boolean not null,
  confirmed_location boolean not null,
  ip text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);
alter table public.terms_acceptances enable row level security;
create policy "own acceptances" on public.terms_acceptances for select using (user_id = auth.uid());

create or replace function public.my_terms() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('version', version, 'accepted_at', accepted_at) order by accepted_at desc), '[]'::jsonb)
  from terms_acceptances where user_id = auth.uid()
$$;

create or replace function public.accept_terms(p_version text, p_name text, p_age boolean, p_location boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h json := nullif(current_setting('request.headers', true), '')::json;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_version is null or char_length(p_version) > 20 then return jsonb_build_object('error','version'); end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then return jsonb_build_object('error','name'); end if;
  if not coalesce(p_age, false) or not coalesce(p_location, false) then return jsonb_build_object('error','confirm'); end if;
  insert into terms_acceptances (user_id, version, signed_name, confirmed_age, confirmed_location, ip, user_agent)
    values (auth.uid(), p_version, left(trim(p_name), 80), true, true,
            left(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1), 64), left(h->>'user-agent', 300))
    on conflict (user_id, version) do nothing;
  return jsonb_build_object('ok', true, 'version', p_version);
end $$;
