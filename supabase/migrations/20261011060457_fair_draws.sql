-- Provably fair draws (daily rounds and weekly Vault Draws).
--  1. When a draw closes, the server freezes the entry list: each player gets a public code (a hash, not their name)
--     and their ticket count, sorted by code. The SHA-256 of that list is the commitment.
--  2. The fairdraw function posts the commitment to Solana in a memo, naming a drand round about a minute in the future.
--  3. When that drand round is published, winner ticket = SHA-256(randomness + ":" + commitment) mod total tickets.
--     Walking the sorted list, the first player whose running total passes that ticket wins.
-- Anyone can redo steps 1-3 from the public data on /verify. Nobody, including us, knows the randomness when the
-- entries are frozen, and the entries can't change after the commitment is on-chain.
create table if not exists public.fair_draws (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('round','vault')),
  ref_id bigint not null,
  entries jsonb not null,               -- [{"c": code, "t": tickets}] sorted by code
  total int not null,
  entries_hash text not null,           -- sha256 hex of the canonical list text
  status text not null default 'frozen' check (status in ('frozen','committed','settled','no_entries')),
  cluster text,
  commit_tx text,
  drand_chain text,
  drand_round bigint,
  randomness text,
  winning_ticket bigint,
  winner_code text,
  winner uuid references public.profiles(id) on delete set null,
  result_tx text,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  settled_at timestamptz,
  unique (kind, ref_id)
);
alter table public.fair_draws enable row level security;

-- Which player is behind each code. Private: players can see only their own.
create table if not exists public.fair_draw_entrants (
  draw_id bigint not null references public.fair_draws(id) on delete cascade,
  code text not null,
  user_id uuid references public.profiles(id) on delete set null,
  primary key (draw_id, code)
);
alter table public.fair_draw_entrants enable row level security;
create policy "own fair codes" on public.fair_draw_entrants for select using (user_id = auth.uid());

alter table public.rounds add column if not exists fair_id bigint references public.fair_draws(id);
alter table public.vault_draws add column if not exists fair_id bigint references public.fair_draws(id);

alter table game_config
  add column if not exists draw_auto_open boolean not null default true,
  add column if not exists draw_auto_days int not null default 7 check (draw_auto_days between 1 and 30);

-- Public code for a player in one draw. Hash of their id and the draw, so codes can't be linked across draws.
create or replace function public.fair_code(p_user uuid, p_kind text, p_ref bigint) returns text
language sql immutable set search_path = public as $$
  select left(encode(sha256(convert_to(p_user::text || ':' || p_kind || ':' || p_ref::text, 'UTF8')), 'hex'), 16)
$$;

-- Freeze an entry list. p_rows: [{"u": user_id, "t": tickets}].
create or replace function public.fair_freeze(p_kind text, p_ref bigint, p_rows jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare fid bigint; ents jsonb; txt text; tot int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('c', c, 't', t) order by c), '[]'::jsonb),
         coalesce(string_agg(c || ':' || t, E'\n' order by c) || E'\n', ''),
         coalesce(sum(t), 0)
    into ents, txt, tot
    from (select fair_code((r->>'u')::uuid, p_kind, p_ref) c, sum((r->>'t')::int)::int t
            from jsonb_array_elements(p_rows) r where (r->>'t')::int > 0 group by 1) x;
  insert into fair_draws (kind, ref_id, entries, total, entries_hash, status)
    values (p_kind, p_ref, ents, tot, encode(sha256(convert_to(txt, 'UTF8')), 'hex'), case when tot = 0 then 'no_entries' else 'frozen' end)
    returning id into fid;
  insert into fair_draw_entrants (draw_id, code, user_id)
    select fid, fair_code((r->>'u')::uuid, p_kind, p_ref), (r->>'u')::uuid
      from jsonb_array_elements(p_rows) r where (r->>'t')::int > 0
    on conflict do nothing;
  return fid;
end $$;

create or replace function public.hex_to_numeric(p_hex text) returns numeric
language plpgsql immutable as $$
declare n numeric := 0; i int;
begin
  for i in 1..length(p_hex) loop
    n := n * 16 + position(lower(substr(p_hex, i, 1)) in '0123456789abcdef') - 1;
  end loop;
  return n;
end $$;

-- Vault Draws whose time is up get frozen (instead of drawn on the spot). The fairdraw function finishes them.
create or replace function public.settle_vault_draws() returns void
language plpgsql security definer set search_path = public as $$
declare d vault_draws; fid bigint;
begin
  for d in select * from vault_draws where status = 'open' and ends_at <= now() and fair_id is null for update skip locked loop
    fid := fair_freeze('vault', d.id, coalesce((select jsonb_agg(jsonb_build_object('u', user_id, 't', coin_tickets + token_tickets))
                                             from vault_draw_tickets where draw_id = d.id), '[]'::jsonb));
    update vault_draws set fair_id = fid where id = d.id;
    if (select status from fair_draws where id = fid) = 'no_entries' then
      update vault_draws set status = 'no_entries', drawn_at = now() where id = d.id;
    end if;
  end loop;
end $$;

-- Daily round: freeze the entries and open the next round right away. The winner is filled in when drand reveals.
create or replace function public.run_draw() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r rounds; fid bigint; tot int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'admins only'; end if;
  select * into r from rounds where status = 'open' for update;
  if r.id is null then return jsonb_build_object('error','no_round'); end if;
  fid := fair_freeze('round', r.id, coalesce((select jsonb_agg(jsonb_build_object('u', user_id, 't', e))
           from (select user_id, sum(entries)::int e from catches where round_id = r.id group by user_id) x), '[]'::jsonb));
  select total into tot from fair_draws where id = fid;
  update rounds set status = 'drawn', drawn_at = now(), total_entries = tot, fair_id = fid where id = r.id;
  insert into rounds default values;
  return jsonb_build_object('round', r.id, 'fair_id', fid, 'total', tot, 'pending', tot > 0);
end $$;

-- Server only: what the fairdraw function has to do next.
create or replace function public.fair_pending() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'ref', ref_id, 'status', status, 'hash', entries_hash,
           'total', total, 'drand_round', drand_round, 'drand_chain', drand_chain) order by id), '[]'::jsonb)
    from fair_draws where status in ('frozen','committed')
$$;

-- Server only: the commitment is on-chain (or recorded, if no draw wallet is set up yet).
create or replace function public.fair_mark_committed(p_id bigint, p_cluster text, p_tx text, p_chain text, p_round bigint) returns void
language sql security definer set search_path = public as $$
  update fair_draws set status = 'committed', cluster = p_cluster, commit_tx = p_tx, drand_chain = p_chain,
         drand_round = p_round, committed_at = now() where id = p_id and status = 'frozen'
$$;

-- Server only: drand published the round. Pick the winner exactly as /verify does and pay out.
create or replace function public.fair_settle(p_id bigint, p_randomness text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fair_draws; seed text; ticket numeric; v_code text; w uuid; nm text; c gacha_cards; d vault_draws; rr rounds;
begin
  select * into f from fair_draws where id = p_id for update;
  if f.id is null or f.status <> 'committed' then return jsonb_build_object('error','state'); end if;
  if p_randomness !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error','randomness'); end if;
  seed := encode(sha256(convert_to(p_randomness || ':' || f.entries_hash, 'UTF8')), 'hex');
  ticket := mod(hex_to_numeric(seed), f.total);
  select x.c into v_code from (
    select e->>'c' c, sum((e->>'t')::int) over (order by ord) cum
      from jsonb_array_elements(f.entries) with ordinality as a(e, ord)) x
   where x.cum > ticket order by x.cum limit 1;
  select e.user_id into w from fair_draw_entrants e where e.draw_id = f.id and e.code = v_code;
  update fair_draws set status = 'settled', randomness = p_randomness, winning_ticket = ticket, winner_code = v_code,
         winner = w, settled_at = now() where id = f.id;
  select display_name into nm from profiles where id = w;
  if f.kind = 'vault' then
    select * into d from vault_draws where id = f.ref_id;
    update vault_draws set status = 'drawn', winner = w, drawn_at = now() where id = d.id;
    update gacha_cards set status = 'won', won_by = w, won_at = now() where id = d.card_id returning * into c;
    if w is not null then
      insert into chat_messages (user_id, kind, body)
        values (w, 'draw', left(coalesce(nm, 'A hunter') || ' won the ' || d.tier || ' Vault Draw: ' || c.name
          || case when c.grade <> '' then ' ' || c.grade else '' end || '! Proof: /verify?id=' || f.id, 280));
    end if;
  else
    select * into rr from rounds where id = f.ref_id;
    update rounds set winner = w where id = rr.id;
    if w is not null then
      insert into chat_messages (user_id, kind, body)
        values (w, 'draw', left('won round ' || rr.id || ': ' || rr.prize_name || ' ' || rr.prize_grade || '. Proof: /verify?id=' || f.id, 280));
    end if;
  end if;
  return jsonb_build_object('winner_code', v_code, 'ticket', ticket);
end $$;

create or replace function public.fair_mark_result_tx(p_id bigint, p_tx text) returns void
language sql security definer set search_path = public as $$
  update fair_draws set result_tx = p_tx where id = p_id
$$;

-- Public: everything needed to check a draw. Players appear only as codes; the winner's username is shown once drawn.
create or replace function public.fair_draw_public(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', f.id, 'kind', f.kind, 'ref', f.ref_id, 'status', f.status, 'entries', f.entries,
    'total', f.total, 'hash', f.entries_hash, 'cluster', f.cluster, 'commit_tx', f.commit_tx, 'drand_chain', f.drand_chain,
    'drand_round', f.drand_round, 'randomness', f.randomness, 'winning_ticket', f.winning_ticket, 'winner_code', f.winner_code,
    'result_tx', f.result_tx, 'created_at', f.created_at, 'committed_at', f.committed_at, 'settled_at', f.settled_at,
    'prize', case f.kind
      when 'round' then (select r.prize_name || ' ' || r.prize_grade from rounds r where r.id = f.ref_id)
      else (select d.tier || ' Vault Draw: ' || c.name || case when c.grade <> '' then ' ' || c.grade else '' end
              from vault_draws d join gacha_cards c on c.id = d.card_id where d.id = f.ref_id) end,
    'winner_name', (select display_name from profiles where id = f.winner))
  from fair_draws f where f.id = p_id
$$;

-- Public: recent draws for the verify page list.
create or replace function public.fair_draws_recent() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'ref', ref_id, 'status', status, 'total', total,
           'created_at', created_at) order by id desc), '[]'::jsonb)
    from (select * from fair_draws order by id desc limit 30) f
$$;

-- Signed-in player: your code in a draw, so you can find yourself in the list.
create or replace function public.fair_my_code(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select code from fair_draw_entrants where draw_id = p_id and user_id = auth.uid()
$$;

-- Weekly: put one vault card up per tier when that tier has no open draw.
create or replace function public.auto_open_vault_draws() returns int
language plpgsql security definer set search_path = public as $$
declare cfg game_config; t text; card bigint; n int := 0;
begin
  select * into cfg from game_config;
  if not cfg.draw_auto_open then return 0; end if;
  foreach t in array array['common','rare','epic'] loop
    continue when exists (select 1 from vault_draws where tier = t and status = 'open');
    select g.id into card from gacha_cards g
     where g.status = 'pool' and g.tier = t
       and not exists (select 1 from vault_draws d where d.card_id = g.id and d.status = 'open')
     order by g.value_coins desc, g.id limit 1;
    continue when card is null;
    insert into vault_draws (tier, card_id, ends_at) values (t, card, now() + make_interval(days => cfg.draw_auto_days));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Admin: auto-open switch and length.
create or replace function public.admin_draw_automation(p_auto boolean, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update game_config set draw_auto_open = coalesce(p_auto, draw_auto_open), draw_auto_days = coalesce(p_days, draw_auto_days) where id;
  return (select jsonb_build_object('auto', draw_auto_open, 'days', draw_auto_days) from game_config);
end $$;

-- Lock down (AGENTS.md rule 6).
revoke execute on function public.fair_code(uuid, text, bigint), public.fair_freeze(text, bigint, jsonb), public.hex_to_numeric(text),
  public.settle_vault_draws(), public.run_draw(), public.fair_pending(), public.fair_mark_committed(bigint, text, text, text, bigint),
  public.fair_settle(bigint, text), public.fair_mark_result_tx(bigint, text), public.fair_draw_public(bigint), public.fair_draws_recent(),
  public.fair_my_code(bigint), public.auto_open_vault_draws(), public.admin_draw_automation(boolean, int) from public, anon;
grant execute on function public.run_draw(), public.fair_my_code(bigint), public.admin_draw_automation(boolean, int) to authenticated;
grant execute on function public.fair_draw_public(bigint), public.fair_draws_recent() to anon, authenticated;
grant execute on function public.settle_vault_draws(), public.fair_pending(), public.fair_mark_committed(bigint, text, text, text, bigint),
  public.fair_settle(bigint, text), public.fair_mark_result_tx(bigint, text), public.auto_open_vault_draws() to service_role;
revoke all on public.fair_draws, public.fair_draw_entrants from anon;
revoke insert, update, delete on public.fair_draws, public.fair_draw_entrants from authenticated;
