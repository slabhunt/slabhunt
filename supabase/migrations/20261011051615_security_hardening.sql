-- Security hardening (audit Oct 11, 2026).
-- 1. Players can only change data through the game's server functions: remove direct table write rights
--    (row-level security already blocked them; this is a second lock). Chat posting stays allowed.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
grant insert on public.chat_messages to authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

-- 2. Signed-out visitors can't call game functions (they all needed a sign-in anyway). Only the support email is public.
--    Functions are executable by PUBLIC by default, so: grant signed-in players exactly what they can call today,
--    then remove PUBLIC and anon. Server-only functions (coins, payments, deletions) stay locked.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute') loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.support_info() to anon;
revoke execute on function public.upgrade_levels(uuid) from authenticated;

-- 3. Prize draws use the database's cryptographically strong random source instead of random().
create or replace function public.secure_random() returns double precision
language sql volatile set search_path = public as $$
  select ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13))::bit(52)::bigint / 4503599627370496.0
$$;
revoke execute on function public.secure_random() from public, anon, authenticated;

create or replace function public.run_draw() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r rounds; total int; ticket int; w uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'admins only'; end if;
  select * into r from rounds where status = 'open' for update;
  select coalesce(sum(entries),0) into total from catches where round_id = r.id;
  if total > 0 then
    ticket := floor(secure_random() * total)::int;
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

create or replace function public.settle_vault_draws() returns void
language plpgsql security definer set search_path = public as $$
declare d vault_draws; total int; roll int; w uuid; c gacha_cards; nm text;
begin
  for d in select * from vault_draws where status = 'open' and ends_at <= now() for update skip locked loop
    select coalesce(sum(coin_tickets + token_tickets), 0) into total from vault_draw_tickets where draw_id = d.id;
    if total = 0 then
      update vault_draws set status = 'no_entries', drawn_at = now() where id = d.id;
      continue;
    end if;
    roll := floor(secure_random() * total)::int;
    select x.user_id into w from (
      select user_id, sum(coin_tickets + token_tickets) over (order by user_id) as cum
      from vault_draw_tickets where draw_id = d.id and coin_tickets + token_tickets > 0) x
     where x.cum > roll order by x.cum limit 1;
    update vault_draws set status = 'drawn', winner = w, drawn_at = now() where id = d.id;
    update gacha_cards set status = 'won', won_by = w, won_at = now() where id = d.card_id returning * into c;
    select display_name into nm from profiles where id = w;
    insert into chat_messages (user_id, kind, body)
      values (w, 'draw', left(coalesce(nm, 'A hunter') || ' won the ' || d.tier || ' Vault Draw: ' || c.name
        || case when c.grade <> '' then ' ' || c.grade else '' end || '!', 280));
  end loop;
end $$;
revoke execute on function public.settle_vault_draws() from public, anon, authenticated;

-- 4. Two quick taps can't slip past the per-draw ticket cap.
create or replace function public.enter_vault_draw(p_draw bigint, p_tickets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg game_config; d vault_draws; price bigint; have int; bal bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_tickets is null or p_tickets < 1 or p_tickets > 1000 then return jsonb_build_object('error','tickets'); end if;
  perform pg_advisory_xact_lock(hashtext('draw_tickets' || auth.uid()::text));
  select * into cfg from game_config;
  select * into d from vault_draws where id = p_draw;
  if d.id is null or d.status <> 'open' or d.ends_at <= now() then return jsonb_build_object('error','closed'); end if;
  select coalesce(coin_tickets + token_tickets, 0) into have from vault_draw_tickets where draw_id = d.id and user_id = auth.uid();
  if coalesce(have, 0) + p_tickets > draw_cap() then return jsonb_build_object('error','max','max',draw_cap(),'have',coalesce(have,0)); end if;
  price := p_tickets::bigint * coalesce((cfg.draw_ticket_coins->>d.tier)::bigint, 0);
  if price <= 0 then return jsonb_build_object('error','closed'); end if;
  bal := spend_coins(auth.uid(), price, 'vault_draw', d.id::text);
  if bal < 0 then return jsonb_build_object('error','coins','cost',price); end if;
  insert into vault_draw_tickets (draw_id, user_id, coin_tickets) values (d.id, auth.uid(), p_tickets)
    on conflict (draw_id, user_id) do update set coin_tickets = vault_draw_tickets.coin_tickets + excluded.coin_tickets;
  return jsonb_build_object('coins', bal, 'tickets', coalesce(have, 0) + p_tickets);
end $$;

-- 5. Record the visitor's real network address (set by the edge network), not a header the browser can fake.
create or replace function public.accept_terms(p_version text, p_name text, p_age boolean, p_location boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h json := nullif(current_setting('request.headers', true), '')::json; ip text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_version is null or char_length(p_version) > 20 then return jsonb_build_object('error','version'); end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then return jsonb_build_object('error','name'); end if;
  if not coalesce(p_age, false) or not coalesce(p_location, false) then return jsonb_build_object('error','confirm'); end if;
  ip := coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', trim(reverse(split_part(reverse(coalesce(h->>'x-forwarded-for', '')), ',', 1))));
  insert into terms_acceptances (user_id, version, signed_name, confirmed_age, confirmed_location, ip, user_agent)
    values (auth.uid(), p_version, left(trim(p_name), 80), true, true, left(ip, 64), left(h->>'user-agent', 300))
    on conflict (user_id, version) do nothing;
  return jsonb_build_object('ok', true, 'version', p_version);
end $$;
