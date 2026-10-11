-- Privacy tools, part 1: support email, download my data, and account deletion requests (7-day grace).
alter table game_config add column if not exists support_email text;

create table if not exists public.account_deletion_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default now() + interval '7 days',
  status text not null default 'pending' check (status in ('pending','cancelled','done')),
  processed_at timestamptz
);
create unique index if not exists account_deletion_one_pending on public.account_deletion_requests (user_id) where status = 'pending';
alter table public.account_deletion_requests enable row level security;
create policy "own deletion requests" on public.account_deletion_requests for select using (user_id = auth.uid());

-- Public: where players can reach us.
create or replace function public.support_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', support_email) from game_config
$$;
grant execute on function public.support_info() to anon, authenticated;

create or replace function public.admin_set_support_email(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_email is not null and p_email <> '' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that does not look like an email address'; end if;
  update game_config set support_email = nullif(trim(p_email), '') where id;
  return support_info();
end $$;

-- Everything we hold about the signed-in player, as one JSON file.
create or replace function public.my_data_export() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at) from auth.users where id = u),
    'profile', (select to_jsonb(p) - 'is_admin' from profiles p where id = u),
    'wallets', coalesce((select jsonb_agg(to_jsonb(w)) from wallets w where user_id = u), '[]'),
    'catches', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from catches c where user_id = u), '[]'),
    'coin_history', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from coin_ledger l where user_id = u), '[]'),
    'chat_messages', coalesce((select jsonb_agg(jsonb_build_object('body', body, 'created_at', created_at) order by created_at) from chat_messages where user_id = u), '[]'),
    'draw_tickets', coalesce((select jsonb_agg(to_jsonb(t)) from vault_draw_tickets t where user_id = u), '[]'),
    'draw_wins', coalesce((select jsonb_agg(jsonb_build_object('draw', id, 'tier', tier, 'drawn_at', drawn_at)) from vault_draws where winner = u), '[]'),
    'power_ups', coalesce((select jsonb_agg(to_jsonb(x)) from player_upgrades x where user_id = u), '[]'),
    'token_payments', coalesce((select jsonb_agg(to_jsonb(tp) - 'splits') from token_purchases tp where user_id = u), '[]'),
    'auction_bids', coalesce((select jsonb_agg(to_jsonb(b)) from auction_bids b where user_id = u), '[]'),
    'season_passes', coalesce((select jsonb_agg(to_jsonb(s)) from season_passes s where user_id = u), '[]'),
    'signed_terms', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id') from terms_acceptances a where user_id = u), '[]'),
    'deletion_requests', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id') from account_deletion_requests r where user_id = u), '[]'));
end $$;

create or replace function public.my_account_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('deletion', (select jsonb_build_object('requested_at', requested_at, 'due_at', due_at)
    from account_deletion_requests where user_id = auth.uid() and status = 'pending'),
    'support_email', (select support_email from game_config))
$$;

-- Ask to delete my account: type your username to confirm. Takes effect after 7 days unless cancelled.
create or replace function public.request_account_deletion(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select display_name into nm from profiles where id = auth.uid();
  if lower(trim(coalesce(p_confirm, ''))) <> lower(nm) then return jsonb_build_object('error','confirm'); end if;
  insert into account_deletion_requests (user_id) values (auth.uid()) on conflict do nothing;
  return my_account_status();
end $$;

create or replace function public.cancel_account_deletion() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update account_deletion_requests set status = 'cancelled', processed_at = now() where user_id = auth.uid() and status = 'pending';
  return my_account_status();
end $$;

-- Admin: the queue of deletion requests.
create or replace function public.admin_privacy_requests() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'name', p.display_name,
      'requested_at', r.requested_at, 'due_at', r.due_at, 'status', r.status, 'processed_at', r.processed_at) order by r.requested_at desc)
    from account_deletion_requests r join profiles p on p.id = r.user_id where r.requested_at > now() - interval '90 days'), '[]');
end $$;
