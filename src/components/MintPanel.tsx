import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, timeLeft, type Season, type Status } from "../lib/supabase";
import { creatureImage, RARITY, SPECIES, type Rarity } from "../lib/species";

type Auction = {
  id: number; species: number; season: number; supply: number; min_bid: number; closes_at: string; status: "open" | "settled";
  bidders: number; top: number | null; cutoff: number | null;
  mine: number | null; my_status: "active" | "won" | "lost" | null; my_refund: number; my_price: number | null; my_paid: boolean | null; my_rank: number | null;
};
type Board = { tokens_per_coin: number; refund_pct: number; extend_min: number; server_now: string; auctions: Auction[] };

const BID_ERRORS: Record<string, (r: Record<string, number>) => string> = {
  below_min: (r) => `The minimum bid is ${r.min.toLocaleString()} coins.`,
  not_higher: (r) => `Your bid is already ${r.current.toLocaleString()}. Raise it above that.`,
  too_low: (r) => `Every copy is spoken for. Bid more than ${r.cutoff.toLocaleString()} coins to get in.`,
  coins: (r) => `You need ${r.need.toLocaleString()} more coins for that bid.`,
  closed: () => "This auction has closed.",
  not_found: () => "That auction doesn't exist.",
};

const fmt = (n: number) => n.toLocaleString();
const tokens = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Smallest bid that would currently get you a copy. */
function nextBid(a: Auction) {
  const full = a.bidders >= a.supply && a.cutoff != null;
  const winning = a.my_rank != null && a.my_rank <= a.supply;
  if (winning && a.mine) return a.mine + 1;
  return Math.max(a.min_bid, full ? (a.cutoff ?? 0) + 1 : a.min_bid, (a.mine ?? 0) + 1);
}

export default function MintPanel({ status, season, isAdmin, visible, onCoins, toast }: {
  status: Status | null;
  season: Season | null;
  isAdmin: boolean;
  visible: boolean;
  onCoins: () => void;
  toast: (m: string) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState<"all" | "mine" | Rarity>("all");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("mint_auctions");
    if (!error && data) setBoard(data as Board);
  }, []);
  useEffect(() => { if (visible) load(); }, [visible, load]);
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => { tick((n) => n + 1); }, 30_000);
    const r = setInterval(load, 60_000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [visible, load]);

  const open = useMemo(() => (board?.auctions ?? []).filter((a) => a.status === "open"), [board]);
  const wins = useMemo(() => (board?.auctions ?? []).filter((a) => a.my_status === "won"), [board]);
  const lost = useMemo(() => (board?.auctions ?? []).filter((a) => a.my_status === "lost"), [board]);
  const shown = open.filter((a) => filter === "all" ? true : filter === "mine" ? a.mine != null : SPECIES[a.species]?.rar === filter);
  const rate = board?.tokens_per_coin ?? 1;
  const refund = board?.refund_pct ?? 90;

  async function bid(a: Auction) {
    const amount = parseInt((drafts[a.id] ?? String(nextBid(a))).replace(/[^0-9]/g, ""), 10);
    if (!(amount > 0)) { toast("Enter a bid in coins."); return; }
    setBusy(a.id);
    const { data, error } = await supabase.rpc("place_bid", { p_auction: a.id, p_amount: amount });
    setBusy(null);
    const res = data as { ok?: boolean; error?: string; rank?: number; supply?: number } | null;
    if (error || !res) { toast("Couldn't place the bid. Try again."); return; }
    if (res.error) { toast(BID_ERRORS[res.error]?.(res as unknown as Record<string, number>) ?? "Couldn't place the bid."); load(); return; }
    toast(`Bid placed: ${fmt(amount)} coins on ${SPECIES[a.species]?.name}. ${res.rank! <= res.supply! ? "You're in the winning group." : "You're below the winning group for now."}`);
    setDrafts((d) => { const n = { ...d }; delete n[a.id]; return n; });
    onCoins(); load();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of open) { const r = SPECIES[a.species]?.rar ?? "c"; c[r] = (c[r] ?? 0) + 1; }
    return c;
  }, [open]);

  return (
    <>
      <div className="card mint-head">
        <strong>Creature mint{season ? ` · ${season.name}` : ""}</strong>
        <p className="sub">Bid coins on this season's creatures. The highest bids win a copy, and your winning bid sets your mint price: <b>{tokens(rate)} token{rate === 1 ? "" : "s"} per coin bid</b>.</p>
        <ul className="sub mint-rules">
          <li>Copies per creature: Common 50, Uncommon 20, Rare 5, Legendary 1.</li>
          <li>Bids are held until the auction closes. If you don't win, you get {refund}% back and {100 - refund}% goes to the treasury for buybacks and the gacha.</li>
          <li>A bid in the last {board?.extend_min ?? 5} minutes extends the auction, so nobody can snipe it.</li>
        </ul>
        {status && <p className="sub">You have <b>{fmt(status.coins)}</b> coins.</p>}
      </div>

      {wins.length > 0 && (
        <div className="card">
          <strong>Your wins</strong>
          <div className="mint-list">
            {wins.map((a) => (
              <div key={a.id} className="mint-row">
                <img src={creatureImage(a.species, 48)} alt="" width={48} height={48} />
                <div className="grow">
                  <b>{SPECIES[a.species]?.name}</b> <span className={"rar " + SPECIES[a.species]?.rar}>{RARITY[SPECIES[a.species]?.rar ?? "c"].label}</span>
                  <small>Won with {fmt(a.mine ?? 0)} coins · mint price {tokens(a.my_price ?? 0)} tokens</small>
                </div>
                <span className={"tag" + (a.my_paid ? " ok" : "")}>{a.my_paid ? "Minted" : "Pay at token launch"}</span>
              </div>
            ))}
          </div>
          <p className="sub">Payment opens when the token launches. Keep your wallet address saved in Profile so your NFT goes to the right place.</p>
        </div>
      )}

      {lost.length > 0 && (
        <p className="sub">{lost.length} bid{lost.length === 1 ? "" : "s"} didn't win; {fmt(lost.reduce((s, a) => s + a.my_refund, 0))} coins were returned to you.</p>
      )}

      <div className="chips" role="tablist" aria-label="Filter auctions">
        {(["all", "mine", "l", "r", "u", "c"] as const).filter((f) => f === "all" || f === "mine" || counts[f]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className="chip" onClick={() => setFilter(f)}>
            {f === "all" ? `All (${open.length})` : f === "mine" ? "My bids" : `${RARITY[f].label} (${counts[f]})`}
          </button>
        ))}
      </div>

      {!board && <div className="empty">Loading auctions...</div>}
      {board && open.length === 0 && <div className="empty">No auctions are open right now. The next season's creatures go up for auction when it starts.</div>}
      {board && open.length > 0 && shown.length === 0 && <div className="empty">{filter === "mine" ? "You haven't bid on anything yet." : "Nothing here."}</div>}

      <div className="mint-list">
        {shown.map((a) => {
          const s = SPECIES[a.species];
          const winning = a.my_rank != null && a.my_rank <= a.supply;
          const need = nextBid(a);
          const full = a.bidders >= a.supply;
          return (
            <div key={a.id} className={"card mint-card" + (s?.rar === "l" ? " legendary" : "")}>
              <div className="mint-row">
                <img src={creatureImage(a.species, 56)} alt="" width={56} height={56} />
                <div className="grow">
                  <b>{s?.name}</b> <span className={"rar " + s?.rar}>{RARITY[s?.rar ?? "c"].label}</span>
                  <small>{a.supply === 1 ? "1 of 1" : `${a.supply} copies`} · closes in {timeLeft(a.closes_at)} · {a.bidders} bidder{a.bidders === 1 ? "" : "s"}</small>
                  <small>{full ? <>Lowest winning bid <b>{fmt(a.cutoff ?? 0)}</b></> : <>Minimum bid <b>{fmt(a.min_bid)}</b>{a.bidders > 0 ? ` · ${a.supply - a.bidders} cop${a.supply - a.bidders === 1 ? "y" : "ies"} still open` : ""}</>}</small>
                </div>
              </div>
              {a.mine != null && (
                <p className={"sub " + (winning ? "ok" : "warn-text")}>
                  Your bid: {fmt(a.mine)} coins · {winning ? `winning (#${a.my_rank} of ${a.supply})` : `outbid (#${a.my_rank}), raise above ${fmt((a.cutoff ?? 0))} to get back in`} · mint price {tokens(a.mine * rate)} tokens
                </p>
              )}
              <div className="row">
                <input className="inp short" inputMode="numeric" aria-label={`Bid on ${s?.name}`}
                  value={drafts[a.id] ?? String(need)} onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))} />
                <button className="btn" onClick={() => bid(a)} disabled={busy === a.id}>
                  {busy === a.id ? "Bidding..." : a.mine != null ? "Raise bid" : "Bid"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {isAdmin && <MintAdmin toast={toast} onDone={load} />}
    </>
  );
}

type Report = {
  tokens_per_coin: number; open: number; settled: number; coins_bid: number; won: number; paid: number; tokens_due: number; buyback_pool: number;
  unpaid: { auction: number; user: string; name: string; species: number; price: number }[];
};

function MintAdmin({ toast, onDone }: { toast: (m: string) => void; onDone: () => void }) {
  const [r, setR] = useState<Report | null>(null);
  const [rate, setRate] = useState("");
  const [tx, setTx] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("admin_mint_report");
    if (data) { setR(data as Report); setRate(String((data as Report).tokens_per_coin)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveRate() {
    const v = Number(rate);
    if (!(v > 0)) { toast("Enter how many tokens one coin of bid costs."); return; }
    const { error } = await supabase.rpc("admin_mint_settings", { p_tokens_per_coin: v });
    toast(error ? "Couldn't save: " + error.message : "Mint rate saved. Unpaid wins now use it.");
    load(); onDone();
  }
  async function markPaid(u: Report["unpaid"][number]) {
    const k = `${u.auction}:${u.user}`;
    const { error } = await supabase.rpc("admin_mark_mint_paid", { p_auction: u.auction, p_user: u.user, p_tx: tx[k] ?? "", p_asset: null });
    toast(error ? "Couldn't update: " + error.message : `Marked ${u.name}'s ${SPECIES[u.species]?.name} as paid.`);
    load(); onDone();
  }

  if (!r) return null;
  return (
    <div className="card">
      <strong>Admin: creature mint</strong>
      <div className="stats four">
        <div className="stat"><b>{r.open}</b><small>Open</small></div>
        <div className="stat"><b>{fmt(r.coins_bid)}</b><small>Coins bid</small></div>
        <div className="stat"><b>{r.won}</b><small>Won</small></div>
        <div className="stat"><b>{r.paid}</b><small>Paid</small></div>
        <div className="stat"><b>{tokens(r.tokens_due)}</b><small>Tokens due</small></div>
        <div className="stat"><b>{fmt(r.buyback_pool ?? 0)}</b><small>Buyback pool</small></div>
      </div>
      <div className="row">
        <label className="field grow">Tokens per coin bid<input id="mint-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <button className="btn ghost" onClick={saveRate}>Save rate</button>
      </div>
      {r.unpaid.length > 0 && (
        <>
          <strong>Waiting for payment</strong>
          {r.unpaid.map((u) => {
            const k = `${u.auction}:${u.user}`;
            return (
              <div key={k} className="row">
                <span className="grow sub">{u.name} · {SPECIES[u.species]?.name} · {tokens(u.price)} tokens</span>
                <input className="inp short" placeholder="Payment tx" value={tx[k] ?? ""} onChange={(e) => setTx((m) => ({ ...m, [k]: e.target.value }))} spellCheck={false} />
                <button className="btn ghost small" onClick={() => markPaid(u)}>Mark paid</button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
