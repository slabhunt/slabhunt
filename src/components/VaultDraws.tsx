// Weekly Vault Draws: each draw raffles one real card from the vault. Tickets cost earned coins
// (and $VDRAKE once that's switched on). More tickets, better odds; one winner per draw.
import { useCallback, useEffect, useState } from "react";
import { supabase, timeLeft } from "../lib/supabase";
import { buyDrawTickets } from "../lib/powerup";

type Tier = "common" | "rare" | "epic";
type Draw = {
  id: number; tier: Tier; ends_at: string; total: number; players: number; mine: number;
  card: { name: string; grade: string; image_url: string | null; value: number };
};
type Info = {
  coin_gacha: boolean; ticket_coins: Record<Tier, number>; ticket_tokens: Record<Tier, number>;
  tokens_enabled: boolean; can_buy_tokens: boolean; max_tickets: number;
  draws: Draw[]; recent: { tier: Tier; card: string; winner: string | null; mine: boolean; drawn_at: string }[];
  pool?: { id: number; name: string; grade: string; tier: string }[] | null;
};
type Free = { available: number; play: number; play_cap: number; checkins: number; used: number; xp: number; xp_per_ticket: number;
  cap: number; checked_in_today: boolean; week_ends: string };
const LABEL: Record<Tier, string> = { common: "Common", rare: "Rare", epic: "Epic" };
const ERR: Record<string, string> = {
  coins: "Not enough coins for that many tickets.",
  free: "You don't have that many free tickets left this week.",
  max: "That's more than the ticket limit for one player.",
  closed: "This draw has closed.",
  off: "$VDRAKE tickets open after launch.",
  no_wallet: "No Solana wallet found. Open Vault Hunt inside Phantom or Solflare to pay with $VDRAKE.",
  rejected: "Payment cancelled in your wallet.",
  balance: "Not enough $VDRAKE in that wallet.",
  not_set_up: "$VDRAKE payments aren't set up yet.",
  pending: "Your payment is still confirming. Tickets arrive once it lands.",
};

export default function VaultDraws({ isAdmin, coins, onCoins, onCoinGacha, toast }: {
  isAdmin: boolean; coins: number; onCoins: () => void; onCoinGacha: (on: boolean) => void; toast: (m: string) => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(Date.now());
  const [free, setFree] = useState<Free | null>(null);

  const load = useCallback(async () => {
    const [{ data }, f] = await Promise.all([supabase.rpc("vault_draws_list"), supabase.rpc("my_free_tickets")]);
    if (data) { setInfo(data as Info); onCoinGacha(!!(data as Info).coin_gacha); }
    if (f.data) setFree(f.data as Free);
  }, [onCoinGacha]);
  useEffect(() => { load(); const t = setInterval(() => { setNow(Date.now()); load(); }, 30000); return () => clearInterval(t); }, [load]);

  if (!info) return null;
  const cap = Math.min(info.max_tickets, free?.cap ?? info.max_tickets);
  const n = (d: Draw) => Math.max(1, Math.min(cap - d.mine, Number(qty[d.id] ?? 1) || 1));

  async function checkIn() {
    setBusy("checkin");
    const { data } = await supabase.rpc("daily_checkin");
    setBusy("");
    if (data) { setFree(data as Free); toast("Checked in: +1 free ticket."); }
  }
  async function withFree(d: Draw) {
    const k = Math.min(n(d), free?.available ?? 0);
    if (k < 1) return;
    setBusy("free" + d.id);
    const { data } = await supabase.rpc("enter_vault_draw_free", { p_draw: d.id, p_tickets: k });
    setBusy("");
    const res = data as { error?: string; tickets?: number; free?: Free } | null;
    if (!res || res.error) { toast(ERR[res?.error ?? ""] ?? "Couldn't enter the draw."); return; }
    if (res.free) setFree(res.free);
    toast(`Used ${k} free ticket${k === 1 ? "" : "s"}. You have ${res.tickets} in the ${LABEL[d.tier]} draw.`);
    load();
  }

  async function withCoins(d: Draw) {
    setBusy("coins" + d.id);
    const { data } = await supabase.rpc("enter_vault_draw", { p_draw: d.id, p_tickets: n(d) });
    setBusy("");
    const res = data as { error?: string; tickets?: number } | null;
    if (!res || res.error) { toast(ERR[res?.error ?? ""] ?? "Couldn't enter the draw."); return; }
    toast(`You have ${res.tickets} ticket${res.tickets === 1 ? "" : "s"} in the ${LABEL[d.tier]} draw.`);
    onCoins(); load();
  }
  async function withTokens(d: Draw) {
    setBusy("tok" + d.id);
    const r = await buyDrawTickets(d.id, n(d), (s) => setBusy(s));
    setBusy("");
    if (r.error) { toast(ERR[r.error] ?? "Couldn't complete the payment."); return; }
    toast(`+${r.tickets} ticket${r.tickets === 1 ? "" : "s"} in the ${LABEL[d.tier]} draw.`);
    load();
  }

  return (
    <>
      <h2 className="sec">Vault Draws</h2>
      <p className="sub">Each week the vault raffles real graded cards. Every player earns free tickets from playing and checking in, and can add more with coins. More tickets, better odds, up to {cap} per draw for everyone. One winner per draw.</p>
      {free && (
        <div className="card free-tix">
          <div><b className="big-n">{free.available}</b> free ticket{free.available === 1 ? "" : "s"} this week</div>
          <span className="sub small">{free.play} from play ({free.xp.toLocaleString()} XP, 1 per {free.xp_per_ticket}, up to {free.play_cap}) + {free.checkins} from check-ins{free.used ? `, ${free.used} used` : ""} · resets in {timeLeft(free.week_ends, now)}</span>
          <button className="btn small" disabled={free.checked_in_today || busy === "checkin"} onClick={checkIn}>{free.checked_in_today ? "Checked in today" : "Check in: +1 ticket"}</button>
        </div>
      )}
      {info.draws.length === 0 && <div className="card"><span className="sub">No draws open right now. New ones open every week; watch chat.</span></div>}
      <div className="draws">
        {info.draws.map((d) => {
          const price = info.ticket_coins[d.tier] ?? 0, tokenPrice = info.ticket_tokens[d.tier] ?? 0;
          const k = n(d), odds = d.mine > 0 ? (d.mine / Math.max(d.total, 1)) * 100 : 0;
          return (
            <div key={d.id} className={"card draw tier-" + d.tier}>
              <div className="draw-head"><span className={"tier-tag tier-" + d.tier}>{LABEL[d.tier]}</span><span className="tag">Ends in {timeLeft(d.ends_at, now)}</span></div>
              <div className="draw-card">
                {d.card.image_url ? <img src={d.card.image_url} alt={d.card.name} /> : <div className="slab-card mini"><span>{d.card.grade || "Vault card"}</span></div>}
                <div><strong>{d.card.name}</strong><small>{d.card.grade}</small></div>
              </div>
              <p className="sub small">{d.total.toLocaleString()} tickets from {d.players} hunter{d.players === 1 ? "" : "s"}{d.mine ? ` · you have ${d.mine} (${odds.toFixed(odds < 1 ? 2 : 1)}% chance)` : ""}</p>
              {d.mine >= cap ? <p className="sub ok">You've got the most tickets allowed. Good luck!</p> : (
                <div className="row draw-buy">
                  <label className="field qty">Tickets<input id={"qty-" + d.id} inputMode="numeric" value={qty[d.id] ?? "1"} onChange={(e) => setQty({ ...qty, [d.id]: e.target.value.replace(/\D/g, "") })} /></label>
                  {(free?.available ?? 0) > 0 && <button className="btn" disabled={!!busy} onClick={() => withFree(d)}>Use {Math.min(k, free!.available)} free</button>}
                  <button className={(free?.available ?? 0) > 0 ? "btn ghost" : "btn"} disabled={!!busy || coins < price * k} onClick={() => withCoins(d)}>{(price * k).toLocaleString()} coins</button>
                  {info.can_buy_tokens && tokenPrice > 0 && (
                    <button className="btn ghost" disabled={!!busy} onClick={() => withTokens(d)}>{(tokenPrice * k).toLocaleString()} $VDRAKE</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {busy && !/^(coins|tok|free|checkin)/.test(busy) && <p className="sub center" aria-live="polite">{busy}</p>}
      {info.recent.length > 0 && (
        <div className="card">
          <strong>Recent winners</strong>
          <div className="hist">
            {info.recent.map((r, i) => <div key={i}><span>{r.mine ? "You" : r.winner ?? "A hunter"} won {r.card}</span><span className={"tier-tag tier-" + r.tier}>{LABEL[r.tier]}</span></div>)}
          </div>
        </div>
      )}
      <p className="sub small">Coins are earned by playing and can't be bought or turned into $VDRAKE.{!info.tokens_enabled && " $VDRAKE tickets open after launch."}</p>
      {isAdmin && <DrawAdmin info={info} onDone={load} toast={toast} />}
    </>
  );
}

function DrawAdmin({ info, onDone, toast }: { info: Info; onDone: () => void; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState("");
  const [tier, setTier] = useState<Tier>("common");
  const [days, setDays] = useState("7");
  const [coinP, setCoinP] = useState(info.ticket_coins);
  const [tokP, setTokP] = useState(info.ticket_tokens);
  const [maxT, setMaxT] = useState(String(info.max_tickets));
  const [tokOn, setTokOn] = useState(info.tokens_enabled);

  async function openDraw() {
    if (!card) { toast("Pick a card from the vault."); return; }
    const { error } = await supabase.rpc("admin_open_vault_draw", { p_card: Number(card), p_tier: tier, p_days: Number(days) || 7 });
    if (error) { toast("Couldn't open the draw: " + error.message); return; }
    toast("Draw opened and announced in chat."); setCard(""); onDone();
  }
  async function save() {
    const { error } = await supabase.rpc("admin_vault_draw_settings", { p_coins: coinP, p_tokens: tokP, p_tokens_enabled: tokOn, p_max: Number(maxT) || 0, p_coin_power_ups: null });
    if (error) { toast("Couldn't save: " + error.message); return; }
    toast("Draw settings saved."); onDone();
  }

  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Admin: Vault Draws</button>;
  const tiers: Tier[] = ["common", "rare", "epic"];
  return (
    <div className="card stack">
      <strong>Open a draw</strong>
      <label className="field">Card from the vault
        <select id="draw-card" value={card} onChange={(e) => { setCard(e.target.value); const c = info.pool?.find((x) => String(x.id) === e.target.value); if (c && (tiers as string[]).includes(c.tier)) setTier(c.tier as Tier); }}>
          <option value="">Choose a card</option>
          {(info.pool ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.grade} ({c.tier})</option>)}
        </select>
      </label>
      <div className="row">
        <label className="field grow">Draw tier<select id="draw-tier" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>{tiers.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select></label>
        <label className="field grow">Days open<input id="draw-days" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} /></label>
      </div>
      <button className="btn" onClick={openDraw}>Open draw</button>
      <strong>Ticket prices</strong>
      <div className="row">{tiers.map((t) => <label key={t} className="field grow">{LABEL[t]} coins<input inputMode="numeric" value={coinP[t]} onChange={(e) => setCoinP({ ...coinP, [t]: Number(e.target.value) || 0 })} /></label>)}</div>
      <div className="row">{tiers.map((t) => <label key={t} className="field grow">{LABEL[t]} $VDRAKE<input inputMode="numeric" value={tokP[t]} onChange={(e) => setTokP({ ...tokP, [t]: Number(e.target.value) || 0 })} /></label>)}</div>
      <label className="field">Max tickets per player per draw<input inputMode="numeric" value={maxT} onChange={(e) => setMaxT(e.target.value)} /></label>
      <label className="toggle"><input type="checkbox" checked={tokOn} onChange={(e) => setTokOn(e.target.checked)} /> Open $VDRAKE tickets to all players (only after launch and legal sign-off)</label>
      <div className="row"><button className="btn" onClick={save}>Save settings</button><button className="btn ghost" onClick={() => setOpen(false)}>Close</button></div>
    </div>
  );
}
