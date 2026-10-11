// Power Cells: in-game items that become power-up points. Holders claim them weekly; players trade them for coins.
// Everything here stays in the game: cells and coins never turn into $VDRAKE or money.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Listing = { id: number; qty: number; price: number; each: number; seller: string; mine: boolean };
type Info = {
  cells: number; market_fee: number; market_max_each: number;
  holder: {
    enabled: boolean; can_claim: boolean; tiers: { min: number; cells: number }[]; collections: string[];
    cells_per_nft: number; max_nft_cells: number; week_ends: string; min_hold_hours?: number;
    claimed: { cells: number; token_balance: number; nfts: number; claimed_at: string } | null;
  };
  listings: Listing[]; my_listings: { id: number; qty: number; price: number }[];
};

const ERR: Record<string, string> = {
  not_enough: "You don't have that many Power Cells.",
  bad_listing: "Enter 1–100 cells and a price in coins.",
  too_pricey: "That's above the price cap per cell.",
  too_many: "You already have 10 open listings. Cancel one first.",
  gone: "That listing is no longer available.",
  own: "That's your own listing.",
  coins: "Not enough coins for that listing.",
};
const CLAIM: Record<string, string> = {
  no_wallet: "Link your wallet in Profile first.",
  verify_wallet: "Verify your wallet in Profile (sign the message) to claim.",
  off: "Holder rewards open after $VDRAKE launches.",
  not_holding: "This wallet doesn't hold enough $VDRAKE or Vault Hunt NFTs for a reward yet.",
  claimed: "Already claimed this week (one claim per account and per wallet).",
  busy: "This wallet has too many recent transfers to check. Try again tomorrow.",
  lookup_failed: "Couldn't read your wallet right now. Try again in a minute.",
  grant_failed: "Something went wrong saving your reward. Try again.",
};
const n = (v: number) => Number(v).toLocaleString();

export default function ItemsMarket({ isAdmin, coins, onChanged, toast }: { isAdmin: boolean; coins: number; onChanged: () => void; toast: (m: string) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("500");

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("items_info");
    if (data) setInfo(data as Info);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    const res = data as (Info & { error?: string; max_each?: number }) | null;
    if (error || !res) { toast("Something went wrong. Try again."); return false; }
    if (res.error) { toast((ERR[res.error] ?? "That didn't work.") + (res.max_each ? ` Max ${n(res.max_each)} coins each.` : "")); return false; }
    setInfo(res); toast(ok); onChanged();
    return true;
  }

  async function claim() {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("wallet", { body: { action: "claim_holder" } });
    setBusy(false);
    const r = (data ?? {}) as { status?: string; cells?: number };
    if (error || !r.status) { toast(CLAIM.lookup_failed); return; }
    if (r.status === "credited") { toast(`+${r.cells} Power Cell${r.cells === 1 ? "" : "s"} for holding. See you next week.`); load(); return; }
    if (r.status === "not_holding" && info?.holder.min_hold_hours) { toast(`Not enough $VDRAKE or NFTs held the whole last ${info.holder.min_hold_hours} hours. Tokens or NFTs moved in during that time count once they've stayed that long.`); return; }
    toast(CLAIM[r.status] ?? "Couldn't claim right now.");
  }

  if (!info) return null;
  const h = info.holder;
  const tiers = [...h.tiers].sort((a, b) => a.min - b.min);

  return (
    <div className="card stack items-card" id="items">
      <div className="pass-head"><strong>Power Cells</strong><span className="tag">You have {n(info.cells)}</span></div>
      <p className="sub">Each cell is one power-up point: put it into throws, speed or sight. Use them, or sell them to other players for coins.</p>
      <div className="row">
        <button className="btn" disabled={busy || info.cells < 1} onClick={() => act("use_power_cells", { p_qty: 1 }, "1 cell turned into a power-up point. Place it above.")}>Use 1 cell</button>
        {info.cells > 1 && <button className="btn ghost" disabled={busy} onClick={() => act("use_power_cells", { p_qty: info.cells }, `${info.cells} cells turned into power-up points.`)}>Use all {info.cells}</button>}
      </div>

      <strong>Holder rewards</strong>
      <p className="sub">Hold $VDRAKE or Vault Hunt NFTs in your verified wallet and get free Power Cells once a week. Only what stayed in the wallet the whole last {h.min_hold_hours ?? 24} hours counts, so moving tokens between wallets doesn't earn extra. Cells are credited automatically; the button claims right away. Rewards are in-game items only, never tokens.</p>
      <div className="hist">
        {tiers.map((t) => <div key={t.min}><span>Hold {n(t.min)}+ $VDRAKE</span><span className="tag">{t.cells} cell{t.cells === 1 ? "" : "s"}/week</span></div>)}
        <div><span>Each Vault Hunt NFT</span><span className="tag">+{h.cells_per_nft} (max {h.max_nft_cells})</span></div>
      </div>
      {h.claimed
        ? <p className="sub ok">Claimed {h.claimed.cells} cell{h.claimed.cells === 1 ? "" : "s"} this week. Next claim opens {new Date(h.week_ends).toLocaleDateString([], { weekday: "long" })}.</p>
        : h.can_claim
          ? <button className="btn ghost" disabled={busy} onClick={claim}>{h.enabled ? "Claim this week's cells" : "Admin test: claim cells"}</button>
          : <p className="sub">Opens when $VDRAKE launches.</p>}

      <strong>Market</strong>
      <p className="sub">Buy and sell cells for coins. A {info.market_fee}% fee is burned on every sale, and prices are capped at {n(info.market_max_each)} coins per cell. You have {n(coins)} coins.</p>
      {info.listings.length === 0 ? <span className="sub">No cells for sale right now.</span> : (
        <div className="hist">
          {info.listings.map((l) => (
            <div key={l.id}>
              <span>{l.qty} cell{l.qty === 1 ? "" : "s"} · {n(l.price)} coins <small className="sub">({n(l.each)} each, {l.seller})</small></span>
              {l.mine
                ? <button className="btn ghost small" disabled={busy} onClick={() => act("market_cancel", { p_id: l.id }, "Listing cancelled. Cells are back in your bag.")}>Cancel</button>
                : <button className="btn small" disabled={busy || coins < l.price} onClick={() => act("market_buy", { p_id: l.id }, `Bought ${l.qty} cell${l.qty === 1 ? "" : "s"}.`)}>Buy</button>}
            </div>
          ))}
        </div>
      )}
      {info.cells > 0 && (
        <div className="row">
          <label className="field grow">Cells<input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <label className="field grow">Total price (coins)<input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <button className="btn ghost" disabled={busy} onClick={async () => {
            if (await act("market_list", { p_qty: parseInt(qty, 10) || 0, p_price: parseInt(price, 10) || 0 }, "Listed. Coins arrive when it sells.")) setQty("1");
          }}>Sell</button>
        </div>
      )}
      {info.my_listings.length > 0 && <p className="sub small">You have {info.my_listings.length} open listing{info.my_listings.length === 1 ? "" : "s"}.</p>}
      {isAdmin && <HolderAdmin info={info} onSaved={setInfo} toast={toast} />}
    </div>
  );
}

function HolderAdmin({ info, onSaved, toast }: { info: Info; onSaved: (i: Info) => void; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tiers, setTiers] = useState(info.holder.tiers.map((t) => `${t.min}:${t.cells}`).join(", "));
  const [cols, setCols] = useState(info.holder.collections.join("\n"));
  const [perNft, setPerNft] = useState(String(info.holder.cells_per_nft));
  const [maxNft, setMaxNft] = useState(String(info.holder.max_nft_cells));
  const [hold, setHold] = useState(String(info.holder.min_hold_hours ?? 24));
  async function saveHold() {
    const { data, error } = await supabase.rpc("admin_holder_hold", { p_hours: parseInt(hold, 10) });
    if (error) { toast("Couldn't save: " + error.message); return; }
    onSaved(data as Info); toast(`Holders must now hold for ${hold} hours.`);
  }

  async function save(enabled: boolean | null) {
    const parsed = tiers.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [min, cells] = s.split(":").map((x) => Number(x.replace(/[_\s,]/g, "")));
      return { min, cells };
    });
    if (parsed.some((t) => !(t.min > 0) || !(t.cells > 0))) { toast("Tiers look like 100000:1, 1000000:2"); return; }
    const collections = cols.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    const { data, error } = await supabase.rpc("admin_holder_settings", {
      p_enabled: enabled, p_tiers: parsed, p_collections: collections,
      p_cells_per_nft: parseInt(perNft, 10) || 0, p_max_nft_cells: parseInt(maxNft, 10) || 0 });
    if (error) { toast("Couldn't save: " + error.message); return; }
    onSaved(data as Info);
    toast(enabled === null ? "Holder settings saved." : enabled ? "Holder rewards are on." : "Holder rewards are off.");
  }

  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Admin: holder rewards</button>;
  return (
    <div className="stack">
      <label className="field">Tiers (min tokens:cells per week)<input value={tiers} onChange={(e) => setTiers(e.target.value)} spellCheck={false} /></label>
      <label className="field">NFT collection addresses (one per line)<textarea rows={2} value={cols} onChange={(e) => setCols(e.target.value)} spellCheck={false} /></label>
      <div className="row">
        <label className="field grow">Cells per NFT<input inputMode="numeric" value={perNft} onChange={(e) => setPerNft(e.target.value)} /></label>
        <label className="field grow">Max NFT cells<input inputMode="numeric" value={maxNft} onChange={(e) => setMaxNft(e.target.value)} /></label>
      </div>
      <div className="row">
        <label className="field grow">Minimum hold (hours, 0–168)<input inputMode="numeric" value={hold} onChange={(e) => setHold(e.target.value)} /></label>
        <button className="btn ghost" onClick={saveHold}>Save hold time</button>
      </div>
      <p className="sub small">24 hours stops quick wallet-to-wallet passing, but one bag could still be claimed by up to 7 accounts in a week by moving it each day. 168 hours (a full week) makes each token count once per week.</p>
      <div className="row">
        <button className="btn ghost" onClick={() => save(null)}>Save</button>
        <button className="btn" onClick={() => save(!info.holder.enabled)}>{info.holder.enabled ? "Turn off" : "Turn on for everyone"}</button>
        <button className="btn ghost small" onClick={() => setOpen(false)}>Close</button>
      </div>
      <p className="sub small">Balances are checked on-chain: the lowest balance over the hold window counts.</p>
    </div>
  );
}
