-- Bug bounty. Players report bugs in the app (Profile > Report a bug); admins triage them on /admin and record the
-- $SLAB reward. Rewards are decided case by case and paid by the treasury multisig, never automatically; the admin
-- pastes the payout transaction afterwards. The payout wallet is a delivery address only (it unlocks nothing).
create table if not exists public.bug_reports (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  title text not null,
  details text not null,
  steps text,
  claimed_severity text not null default 'low',   -- low | medium | high | critical (reporter's guess)
  area text not null default 'game',              -- game | website | token | wallet | other
  contact text,
  payout_wallet text,
  status text not null default 'new',             -- new | triaged | accepted | duplicate | not_a_bug | fixed | paid
  severity text,                                  -- set by admins
  reward_slab numeric,
  payout_tx text,
  reply text,                                     -- shown to the reporter
  admin_note text,                                -- admins only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bug_reports_user on public.bug_reports (user_id, created_at);
create index if not exists bug_reports_status on public.bug_reports (status, created_at);
alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;

create or replace function public.submit_bug_report(p_title text, p_details text, p_steps text, p_severity text, p_area text,
  p_contact text, p_wallet text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_wallet text := nullif(trim(coalesce(p_wallet, '')), '');
begin
  if auth.uid() is null then return jsonb_build_object('error', 'signed_out'); end if;
  if length(trim(coalesce(p_title, ''))) < 5 or length(trim(coalesce(p_details, ''))) < 20 then return jsonb_build_object('error', 'too_short'); end if;
  if (select count(*) from bug_reports where user_id = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    return jsonb_build_object('error', 'slow_down');
  end if;
  if v_wallet is not null and v_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return jsonb_build_object('error', 'wallet'); end if;
  if v_wallet is null then select address into v_wallet from wallets where user_id = auth.uid() and verified limit 1; end if;
  insert into bug_reports (user_id, title, details, steps, claimed_severity, area, contact, payout_wallet)
  values (auth.uid(), left(trim(p_title), 140), left(trim(p_details), 5000), nullif(left(trim(coalesce(p_steps, '')), 5000), ''),
          case when p_severity in ('low', 'medium', 'high', 'critical') then p_severity else 'low' end,
          case when p_area in ('game', 'website', 'token', 'wallet', 'other') then p_area else 'other' end,
          nullif(left(trim(coalesce(p_contact, '')), 120), ''), v_wallet)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function public.submit_bug_report(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_bug_report(text, text, text, text, text, text, text) to authenticated;

create or replace function public.my_bug_reports()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
    select id, title, status, severity, reward_slab, payout_tx, reply, created_at from bug_reports where user_id = auth.uid()
  ) r;
$$;
revoke execute on function public.my_bug_reports() from public, anon;
grant execute on function public.my_bug_reports() to authenticated;

create or replace function public.admin_bug_reports(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return coalesce((select jsonb_agg(r order by r.created_at desc) from (
    select b.*, p.display_name as reporter from bug_reports b left join profiles p on p.id = b.user_id
     where p_status is null or b.status = p_status
     order by b.created_at desc limit 200) r), '[]'::jsonb);
end $$;
revoke execute on function public.admin_bug_reports(text) from public, anon;
grant execute on function public.admin_bug_reports(text) to authenticated;

create or replace function public.admin_update_bug(p_id bigint, p_status text, p_severity text, p_reward numeric,
  p_payout_tx text, p_reply text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_status is not null and p_status not in ('new', 'triaged', 'accepted', 'duplicate', 'not_a_bug', 'fixed', 'paid') then
    return jsonb_build_object('error', 'status');
  end if;
  if p_payout_tx is not null and p_payout_tx <> '' and p_payout_tx !~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$' then return jsonb_build_object('error', 'tx'); end if;
  update bug_reports set
    status = coalesce(p_status, status),
    severity = case when p_severity in ('low', 'medium', 'high', 'critical') then p_severity else severity end,
    reward_slab = coalesce(p_reward, reward_slab),
    payout_tx = coalesce(nullif(p_payout_tx, ''), payout_tx),
    reply = coalesce(p_reply, reply),
    admin_note = coalesce(p_note, admin_note),
    updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', found);
end $$;
revoke execute on function public.admin_update_bug(bigint, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.admin_update_bug(bigint, text, text, numeric, text, text, text) to authenticated;
