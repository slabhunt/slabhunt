// $SLAB power-ups: buy points with the token, then choose where each one goes.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { buyPowerUp } from "../lib/powerup";
import { walletBrowseLinks } from "../lib/wallet";

type Track = "throws" | "speed" | "sight";
type Tier = { tier: number; name: string; points: number; price: number; usd?: number };
type Info = {
  enabled: boolean; can_buy: boolean; cluster: string; mint: string | null;
  split: { burn: number; vault: number; drops: number; dev: number };
  wallets: { vault: string | null; drops: string | null; dev: string | null };
  tiers: Tier[]; max_level: number;
  per_level: { throws: number; speed_pct: number; sight_m: number };
  throws_pay_rewards: boolean; coin_tiers?: Record<string, number>; pass_tier?: number; points: number; levels: Record<Track, number>; season: string | null;
};

const ERRORS: Record<string, string> = {
  no_wallet: "No Solana wallet found. Open Slab Hunt inside your wallet app (Phantom or Solflare) to pay.",
  wallet_unsupported: "This wallet can't send payments from a web page. Try Phantom or Solflare.",
  rejected: "Payment cancelled in your wallet.",
  balance: "Not enough $SLAB in that wallet.",
  off: "Power-ups open when $SLAB launches.",
  not_set_up: "Power-ups aren't set up yet.",
  tier: "That power-up isn't for sale right now.",
  no_price: "Couldn't get the live $SLAB price. Try again in a minute.",
  pending: "Your payment is still confirming. Check back in a minute; points arrive once it lands.",
  wrong_payment: "That payment didn't match. Nothing was added; contact support if tokens left your wallet.",
  failed_on_chain: "The payment failed on-chain, so nothing was charged.",
};

/** Dollar tiers are charged in $SLAB at the live price on mainnet; devnet tests use the fixed token price. */
function priceLabel(t: Tier, cluster: string) {
  if (t.usd && t.usd > 0 && cluster === "mainnet-beta") return `$${t.usd} in $SLAB`;
  return t.price > 0 ? `${t.price.toLocaleString()} $SLAB` : "Price not set";
}

export default function PowerUps({ isAdmin, coins, onChanged, toast }: { isAdmin: boolean; coins: number; onChanged: () => void; toast: (m: string) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("power_ups");
    if (data) setInfo(data as Info);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!info) return null;
  const track = (t: Track) => {
    const lvl = info.levels[t] ?? 0, max = info.max_level;
    const label = { throws: "More throws", speed: "Faster explorer", sight: "Wider sight" }[t];
    const effect = {
      throws: `+${lvl * info.per_level.throws} throws a day`,
      speed: `+${lvl * info.per_level.speed_pct}% travel speed`,
      sight: `+${lvl * info.per_level.sight_m} m sight`,
    }[t];
    const next = { throws: `+${info.per_level.throws} throws`, speed: `+${info.per_level.speed_pct}% speed`, sight: `+${info.per_level.sight_m} m` }[t];
    return (
      <div className="pu-track" key={t}>
        <div className="pu-head"><b>{label}</b><span>{effect}</span></div>
        <div className="pu-bar" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={lvl} aria-label={`${label} level`}>
          {Array.from({ length: max }, (_, i) => <i key={i} className={i < Math.min(lvl, info.pass_tier ?? 0) ? "on pass" : i < lvl ? "on" : ""} />)}
        </div>
        <button className="btn small" disabled={info.points < 1 || lvl >= max || !!busy} onClick={() => place(t)}>
          {lvl >= max ? "Maxed" : `Add point (${next})`}
        </button>
      </div>
    );
  };

  async function place(t: Track) {
    setBusy("place");
    const { data } = await supabase.rpc("place_power_up", { p_track: t });
    setBusy("");
    const res = data as (Info & { error?: string }) | null;
    if (!res || res.error) { toast(res?.error === "max" ? "That one's maxed out." : "Couldn't add the point."); return; }
    setInfo(res);
    onChanged();
  }

  async function buy(t: Tier) {
    setBusy(t.name);
    const r = await buyPowerUp(t.tier, (s) => setBusy(s));
    setBusy("");
    if (r.error) { toast(ERRORS[r.error] ?? "Couldn't complete the payment."); return; }
    toast(`+${r.points} power-up point${r.points === 1 ? "" : "s"}. Choose where they go.`);
    load();
  }

  async function buyCoins(t: Tier, cost: number) {
    setBusy("coins");
    const { data } = await supabase.rpc("buy_power_up_coins", { p_tier: t.tier });
    setBusy("");
    const res = data as (Info & { error?: string }) | null;
    if (!res || res.error) { toast(res?.error === "coins" ? `${t.name} costs ${cost.toLocaleString()} coins.` : "Couldn't buy that power-up."); return; }
    setInfo(res);
    toast(`+${t.points} power-up point${t.points === 1 ? "" : "s"} for ${cost.toLocaleString()} coins. Choose where they go.`);
    onChanged();
  }

  const coinTiers = info.tiers.filter((t) => (info.coin_tiers?.[String(t.tier)] ?? 0) > 0);
  const s = info.split;
  return (
    <div className="card powerups">
      <div className="pass-head"><strong>Power-ups</strong><span className="tag">$SLAB{info.season ? ` · ${info.season}` : ""}</span></div>
      <p className="sub">Buy points with $SLAB{coinTiers.length ? " (or a Spark with coins)" : ""}, then choose where each one goes. Levels last for the season.
        {!info.throws_pay_rewards && " Catches made with power-up throws count for your log and XP, but don't add raffle entries or coins."}</p>
      {(info.pass_tier ?? 0) > 0 && <p className="sub ok">Your {["", "Common", "Uncommon", "Rare", "Epic", "Legendary"][info.pass_tier ?? 0]} Season Pass unlocks <b>{info.pass_tier} level{info.pass_tier === 1 ? "" : "s"}</b> in every track this season (shown in blue).</p>}
      {info.points > 0 && <p className="sub ok"><b>{info.points}</b> point{info.points === 1 ? "" : "s"} to place.</p>}
      {(["throws", "speed", "sight"] as Track[]).map(track)}
      <p className="sub small">Speed applies when your explorer travels (Season Pass). Walkers move at walking speed.</p>

      {coinTiers.length > 0 && (
        <div className="row pu-coins">
          {coinTiers.map((t) => { const cost = info.coin_tiers![String(t.tier)]; return (
            <button key={t.tier} className="btn ghost" disabled={!!busy || coins < cost} onClick={() => buyCoins(t, cost)}>
              {t.name} ({t.points} point{t.points === 1 ? "" : "s"}) for {cost.toLocaleString()} coins
            </button>); })}
        </div>
      )}
      {info.can_buy ? (
        <div className="pu-tiers">
          {info.tiers.map((t) => (
            <button key={t.tier} className="pu-tier" disabled={!!busy || !priceLabel(t, info.cluster).match(/\d/)} onClick={() => buy(t)}>
              <b>{t.name}</b><span>{t.points} point{t.points === 1 ? "" : "s"}</span>
              <em>{priceLabel(t, info.cluster)}</em>
            </button>
          ))}
        </div>
      ) : (
        <p className="sub center">Power-ups open when $SLAB launches.</p>
      )}
      {busy && busy !== "place" && <p className="sub center" aria-live="polite">{busy}</p>}
      <p className="sub small">Every payment is split in the same transaction: {s.burn}% burned forever, {s.vault}% to the card vault for gacha packs, {s.drops}% to the treasury for map drops, {s.dev}% to the development multisig.</p>
      {info.can_buy && !window.phantom && !window.solflare && (
        <p className="sub small">On a phone? Open the game in <a href={walletBrowseLinks().phantom}>Phantom</a> or <a href={walletBrowseLinks().solflare}>Solflare</a> to pay.</p>
      )}
      {isAdmin && <PowerUpAdmin info={info} onSaved={(i) => setInfo(i)} toast={toast} />}
    </div>
  );
}

function PowerUpAdmin({ info, onSaved, toast }: { info: Info; onSaved: (i: Info) => void; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(info.enabled);
  const [cluster, setCluster] = useState(info.cluster);
  const [mint, setMint] = useState(info.mint ?? "");
  const [vault, setVault] = useState(info.wallets.vault ?? "");
  const [drops, setDrops] = useState(info.wallets.drops ?? "");
  const [dev, setDev] = useState(info.wallets.dev ?? "");
  const [prices, setPrices] = useState(info.tiers.map((t) => String(t.price)));
  const [usd, setUsd] = useState(info.tiers.map((t) => String(t.usd ?? "")));
  const [points, setPoints] = useState(info.tiers.map((t) => String(t.points)));
  const [split, setSplit] = useState([info.split.burn, info.split.vault, info.split.drops, info.split.dev].map(String));
  const [payRewards, setPayRewards] = useState(info.throws_pay_rewards);

  async function save() {
    const sp = split.map(Number);
    if (sp.some((x) => !(x >= 0)) || sp.reduce((a, b) => a + b, 0) !== 100) { toast("The split must add up to 100."); return; }
    const { data, error } = await supabase.rpc("admin_power_up_settings", {
      p_enabled: enabled, p_cluster: cluster, p_mint: mint, p_vault: vault, p_drops: drops, p_dev: dev,
      p_prices: prices.map(Number), p_split: sp, p_pay_rewards: payRewards,
    });
    if (error) { toast("Couldn't save: " + error.message); return; }
    const r2 = await supabase.rpc("admin_power_up_usd", { p_usd: usd.map((u) => (u.trim() === "" ? 0 : Number(u))), p_points: points.map(Number) });
    if (r2.error) { toast("Couldn't save dollar prices: " + r2.error.message); return; }
    onSaved((r2.data ?? data) as Info);
    toast("Power-up settings saved.");
  }

  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Admin: power-up settings</button>;
  return (
    <div className="stack pu-admin">
      <label className="toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Open to all players (only after launch and legal sign-off)</label>
      <label className="toggle"><input type="checkbox" checked={payRewards} onChange={(e) => setPayRewards(e.target.checked)} /> Power-up throws pay entries and coins (needs legal sign-off)</label>
      <label className="field">Network
        <select value={cluster} onChange={(e) => setCluster(e.target.value)}><option value="devnet">Devnet (testing)</option><option value="mainnet-beta">Mainnet</option></select>
      </label>
      <label className="field">$SLAB mint<input value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} /></label>
      <label className="field">Card vault wallet<input value={vault} onChange={(e) => setVault(e.target.value)} spellCheck={false} /></label>
      <label className="field">Map-drops treasury wallet<input value={drops} onChange={(e) => setDrops(e.target.value)} spellCheck={false} /></label>
      <label className="field">Development multisig wallet<input value={dev} onChange={(e) => setDev(e.target.value)} spellCheck={false} /></label>
      <p className="sub small">Dollar prices are charged in $SLAB at the live price on mainnet. Token prices are used on devnet, or when no dollar price is set.</p>
      <div className="row">
        {info.tiers.map((t, i) => (
          <label key={t.tier} className="field grow">{t.name} $<input inputMode="decimal" value={usd[i]} onChange={(e) => setUsd(usd.map((p, j) => (j === i ? e.target.value : p)))} /></label>
        ))}
      </div>
      <div className="row">
        {info.tiers.map((t, i) => (
          <label key={t.tier} className="field grow">{t.name} points<input inputMode="numeric" value={points[i]} onChange={(e) => setPoints(points.map((p, j) => (j === i ? e.target.value : p)))} /></label>
        ))}
      </div>
      <div className="row">
        {info.tiers.map((t, i) => (
          <label key={t.tier} className="field grow">{t.name} tokens<input inputMode="decimal" value={prices[i]} onChange={(e) => setPrices(prices.map((p, j) => (j === i ? e.target.value : p)))} /></label>
        ))}
      </div>
      <div className="row">
        {["Burn %", "Vault %", "Drops %", "Dev %"].map((l, i) => (
          <label key={l} className="field grow">{l}<input inputMode="numeric" value={split[i]} onChange={(e) => setSplit(split.map((p, j) => (j === i ? e.target.value : p)))} /></label>
        ))}
      </div>
      <div className="row"><button className="btn" onClick={save}>Save</button><button className="btn ghost" onClick={() => setOpen(false)}>Close</button></div>
    </div>
  );
}
