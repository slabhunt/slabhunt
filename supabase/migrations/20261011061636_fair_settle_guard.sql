-- Only post the winner chat line when the round or vault draw exists.
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
    if w is not null and c.id is not null then
      insert into chat_messages (user_id, kind, body)
        values (w, 'draw', left(coalesce(nm, 'A hunter') || ' won the ' || d.tier || ' Vault Draw: ' || c.name
          || case when c.grade <> '' then ' ' || c.grade else '' end || '! Proof: /verify?id=' || f.id, 280));
    end if;
  else
    select * into rr from rounds where id = f.ref_id;
    update rounds set winner = w where id = rr.id;
    if w is not null and rr.id is not null then
      insert into chat_messages (user_id, kind, body)
        values (w, 'draw', left('won round ' || rr.id || ': ' || rr.prize_name || ' ' || rr.prize_grade || '. Proof: /verify?id=' || f.id, 280));
    end if;
  end if;
  return jsonb_build_object('winner_code', v_code, 'ticket', ticket);
end $$;

revoke execute on function public.fair_settle(bigint, text) from public, anon, authenticated;
grant execute on function public.fair_settle(bigint, text) to service_role;
