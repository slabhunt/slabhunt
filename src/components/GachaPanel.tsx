import { useCallback, useEffect, useState } from "react";
import { supabase, type Status } from "../lib/supabase";

type Tier = "common" | "uncommon" | "rare" | "epic";
type Odds = { tier: Tier; weight: number; sort: number };
type Card = { id: number; name: string; grade: string; tier: Tier; value_coins: number; image_url: string | null; status: string; won_by: string | null };
type Pull = { id: number; card_id: number; tier: Tier; price: number; auto_sold: boolean; sold_back: boolean; buyback: number; created_at: string };
type Reveal = { tier: Tier; card: { id: number; name: string; grade: string; value: number; image_url: string | null }; auto_sold: boolean; buyback: number; pull_id: number };

const TIER_LABEL: Record<Tier, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic" };

export default function GachaPanel({ userId, status, isAdmin, onCoins, toast }: {
  userId: string;
  status: Status | null;
  isAdmin: boolean;
  onCoins: () => void;
  toast: (m: string) => void;
}) {
  const [odds, setOdds] = useState<Odds[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [turbo, setTurbo] = useState(true);
  const [ripping, setRipping] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const load = useCallback(async () => {
    const [o, c, p] = await Promise.all([
      supabase.from("gacha_odds").select("*").order("sort"),
      supabase.from("gacha_cards").select("id, name, grade, tier, value_coins, image_url, status, won_by").order("value_coins", { ascending: false }).limit(500),
      supabase.from("gacha_pulls").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    ]);
    setOdds((o.data as Odds[]) ?? []);
    setCards((c.data as Card[]) ?? []);
    setPulls((p.data as Pull[]) ?? []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const pool = cards.filter((c) => c.status === "pool");
  const live = odds.filter((o) => pool.some((c) => c.tier === o.tier));
  const totalWeight = live.reduce((a, o) => a + o.weight, 0);
  const price = status?.pull_price ?? 100;
  const canAfford = (status?.coins ?? 0) >= price;

  async function rip() {
    if (ripping) return;
    setRipping(true); setReveal(null);
    const [{ data, error }] = await Promise.all([
      supabase.rpc("gacha_pull", { p_turbo: turbo }),
      new Promise((r) => setTimeout(r, 1200)), // let the machine spin
    ]);
    setRipping(false);
    const res = data as (Reveal & { error?: string; cost?: number }) | null;
    if (error || !res) { toast("The machine jammed. Try again."); return; }
    if (res.error === "coins") { toast(`You need ${res.cost} coins to rip. Catch creatures to earn more.`); return; }
    if (res.error === "empty") { toast("The machine is empty right now. New cards are on the way."); return; }
    if (res.error) { toast("Busy machine. Try again."); return; }
    setReveal(res);
    onCoins(); load();
  }

  async function sellBack(id: number) {
    const { data } = await supabase.rpc("gacha_sell_back", { p_pull: id });
    const res = data as { buyback?: number; error?: string } | null;
    if (!res || res.error) { toast(res?.error === "expired" ? "The sell-back window has closed for that card." : "That card can't be sold back."); return; }
    toast(`Sold back for ${res.buyback} coins.`);
    if (reveal?.pull_id === id) setReveal(null);
    onCoins(); load();
  }

  const cardName = (id: number) => cards.find((c) => c.id === id);
  const days = status?.sellback_days ?? 3;
  const sellable = (p: Pull) => !p.auto_sold && !p.sold_back && Date.now() - new Date(p.created_at).getTime() < days * 864e5;

  async function buyPass() {
    const { data } = await supabase.rpc("buy_pass");
    const res = data as { error?: string; cost?: number } | null;
    if (!res || res.error) { toast(res?.error === "coins" ? `The Season Pass costs ${res.cost?.toLocaleString()} coins.` : "Couldn't buy the pass right now."); return; }
    toast("Season Pass active. Tap anywhere on the map to explore!");
    onCoins();
  }

  return (
    <>
      <div className={"card pass" + (status?.has_pass ? " active" : "")}>
        <div className="pass-head">
          <strong>Season Pass</strong>
          {status?.has_pass
            ? <span className="tag ok">Active until {new Date(status.pass_until!).toLocaleDateString()}</span>
            : <span className="tag">{(status?.pass_price ?? 5000).toLocaleString()} coins · {status?.pass_days ?? 30} days</span>}
        </div>
        <ul className="rules">
          <li><b>Explore anywhere</b> from the couch: tap the map to send your explorer. Free players hunt by walking.</li>
          <li><b>{status?.pass_bounty_mult ?? 10}x coin bounties</b> on every catch.</li>
          <li><b>Wider sight</b>: {status?.pass_sight_m ?? 500} m instead of 300 m.</li>
          <li>Raffle entries stay the same for everyone: {status?.daily_cap ?? 20} a day max.</li>
        </ul>
        {!status?.has_pass && (
          <button className="btn" onClick={buyPass} disabled={(status?.coins ?? 0) < (status?.pass_price ?? 5000)}>
            {(status?.coins ?? 0) < (status?.pass_price ?? 5000) ? `Need ${((status?.pass_price ?? 5000) - (status?.coins ?? 0)).toLocaleString()} more coins` : "Get the Season Pass"}
          </button>
        )}
      </div>

      <h2 className="sec">Vault gacha</h2>
      <div className={"machine" + (ripping ? " spinning" : "")}>
        {reveal ? (
          <div className={"reveal tier-" + reveal.tier}>
            <span className="tier-tag">{TIER_LABEL[reveal.tier]}</span>
            {reveal.card.image_url
              ? <img src={reveal.card.image_url} alt={reveal.card.name} />
              : <div className="slab-card mini"><span>{reveal.card.grade || "Vault card"}</span></div>}
            <strong>{reveal.card.name}</strong>
            <small>{reveal.card.grade} · worth {reveal.card.value} coins</small>
            {reveal.auto_sold
              ? <p className="sub center">Turbo sold it back for <b>{reveal.buyback}</b> coins. Rip again for a bigger hit.</p>
              : <p className="sub center ok">It's yours! Keep it, or sell it back within {days} days.</p>}
            {!reveal.auto_sold && <button className="btn ghost" onClick={() => sellBack(reveal.pull_id)}>Sell back for {Math.floor(reveal.card.value * (status?.turbo_pct ?? 85) / 100)} coins</button>}
          </div>
        ) : (
          <div className="machine-face">
            <span className="orb" />
            <p className="sub center">{ripping ? "Ripping..." : `${pool.length} vaulted cards inside`}</p>
          </div>
        )}
      </div>
      <div className="row center-row">
        <button className="btn big" onClick={rip} disabled={ripping || !canAfford || pool.length === 0}>
          {ripping ? "Ripping..." : `Rip a pull · ${price} coins`}
        </button>
      </div>
      <label className="toggle">
        <input id="turbo" type="checkbox" checked={turbo} onChange={(e) => setTurbo(e.target.checked)} />
        <span><b>Turbo</b>: auto-sell Commons for {status?.turbo_pct ?? 85}% of their value so you can rip again</span>
      </label>
      {!canAfford && <p className="sub center">You have {status?.coins ?? 0} coins. Catch creatures to earn more.</p>}

      <div className="card">
        <strong>Odds</strong>
        <table className="ranks">
          <thead><tr><th>Tier</th><th className="n">Chance</th><th className="n">Cards</th><th className="n">Value</th></tr></thead>
          <tbody>
            {odds.map((o) => {
              const inTier = pool.filter((c) => c.tier === o.tier);
              const vals = inTier.map((c) => c.value_coins);
              const chance = inTier.length && totalWeight ? (o.weight / totalWeight) * 100 : 0;
              return (
                <tr key={o.tier}>
                  <td><span className={"dot tier-" + o.tier} />{TIER_LABEL[o.tier]}</td>
                  <td className="n">{inTier.length ? `${chance.toFixed(chance < 1 ? 2 : 1)}%` : "Sold out"}</td>
                  <td className="n">{inTier.length}</td>
                  <td className="n">{vals.length ? `${Math.min(...vals)}–${Math.max(...vals)}` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="sub">Each pull draws a tier by these odds, then a random card in it. Most pulls are Common and worth less than the price. When a tier sells out, its chance moves to the others.</p>
      </div>

      <div className="card">
        <strong>Your pulls</strong>
        {pulls.length === 0 && <span className="sub">No pulls yet.</span>}
        <div className="hist">
          {pulls.map((p) => {
            const c = cardName(p.card_id);
            return (
              <div key={p.id}>
                <span><span className={"dot tier-" + p.tier} />{c?.name ?? "Card"} {c?.grade}</span>
                {p.auto_sold ? <span>Turbo +{p.buyback}</span>
                  : p.sold_back ? <span>Sold +{p.buyback}</span>
                  : sellable(p) ? <button className="btn ghost small" onClick={() => sellBack(p.id)}>Sell back</button>
                  : <span className="ok">Kept</span>}
              </div>
            );
          })}
        </div>
      </div>

      {isAdmin && <AdminTools userId={userId} status={status} onDone={() => { load(); onCoins(); }} toast={toast} />}
    </>
  );
}

function AdminTools({ userId, status, onDone, toast }: { userId: string; status: Status | null; onDone: () => void; toast: (m: string) => void }) {
  const [potName, setPotName] = useState("");
  const [potCoins, setPotCoins] = useState("10000");
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [tier, setTier] = useState<Tier>("common");
  const [value, setValue] = useState("80");
  const [img, setImg] = useState("");
  const [mint, setMint] = useState("");
  const [t, setT] = useState<Record<string, number> | null>(null);

  const loadTreasury = useCallback(async () => {
    const { data } = await supabase.rpc("admin_treasury");
    if (data) setT(data as Record<string, number>);
  }, []);
  useEffect(() => { loadTreasury(); }, [loadTreasury]);

  async function createPot() {
    const coins = parseInt(potCoins, 10);
    if (!(coins > 0)) { toast("Enter how many coins the pot holds."); return; }
    const { error } = await supabase.rpc("admin_create_pot", { p_name: potName || "Pot", p_coins: coins });
    toast(error ? "Couldn't create the pot: " + error.message : "New pot is live. Catches now pay from it.");
    onDone(); loadTreasury();
  }
  async function addCard() {
    const v = parseInt(value, 10);
    if (!name.trim() || !(v > 0)) { toast("Add a card name and a value in coins."); return; }
    const { error } = await supabase.rpc("admin_add_card", { p_name: name, p_grade: grade, p_tier: tier, p_value: v, p_image_url: img, p_mint: mint });
    if (error) { toast("Couldn't add the card: " + error.message); return; }
    toast("Card added to the machine.");
    setName(""); setGrade(""); setImg(""); setMint("");
    onDone(); loadTreasury();
  }

  async function testCoins() {
    const { error } = await supabase.rpc("admin_grant_coins", { p_user: userId, p_amount: 10000 });
    toast(error ? "Couldn't add coins: " + error.message : "Added 10,000 test coins to your account.");
    onDone(); loadTreasury();
  }
  async function testPass() {
    const { error } = await supabase.rpc("admin_grant_pass", { p_user: userId, p_days: 30 });
    toast(error ? "Couldn't grant the pass: " + error.message : "You have a 30-day Season Pass.");
    onDone();
  }

  return (
    <div className="card">
      <strong>Admin: economy</strong>
      <div className="row">
        <button className="btn ghost small" onClick={testCoins}>Give me 10,000 test coins</button>
        <button className="btn ghost small" onClick={testPass}>Give me a 30-day pass</button>
      </div>
      {status?.pot
        ? <p className="sub">Active pot <b>{status.pot.name}</b>: {status.pot.remaining.toLocaleString()} of {status.pot.total.toLocaleString()} coins left for bounties.</p>
        : <p className="sub warn-text">No active pot. Catches pay no coins until you create one.</p>}
      {t && (
        <div className="stats four">
          <div className="stat"><b>{t.spent}</b><small>Spent</small></div>
          <div className="stat"><b>{t.to_pot}</b><small>Back to pots</small></div>
          <div className="stat"><b>{t.to_cards}</b><small>Card fund</small></div>
          <div className="stat"><b>{t.to_burn}</b><small>Burned</small></div>
          <div className="stat"><b>{t.to_team}</b><small>Team</small></div>
          <div className="stat"><b>{t.coins_in_wallets}</b><small>In wallets</small></div>
          <div className="stat"><b>{t.cards_in_pool}</b><small>Cards in machine</small></div>
          <div className="stat"><b>{t.cards_won}</b><small>Cards won</small></div>
        </div>
      )}
      <strong>New pot</strong>
      <div className="row">
        <input id="pot-name" className="inp" placeholder="Season 1" value={potName} onChange={(e) => setPotName(e.target.value)} />
        <input id="pot-coins" className="inp short" inputMode="numeric" value={potCoins} onChange={(e) => setPotCoins(e.target.value)} />
        <button className="btn ghost" onClick={createPot}>Start pot</button>
      </div>
      <strong>Add a card to the machine</strong>
      <label className="field">Card name<input id="card-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <div className="row">
        <label className="field grow">Grade<input id="card-grade" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="PSA 9" maxLength={12} /></label>
        <label className="field grow">Value (coins)<input id="card-value" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      </div>
      <label className="field">Tier
        <select id="card-tier" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          <option value="common">Common</option><option value="uncommon">Uncommon</option><option value="rare">Rare</option><option value="epic">Epic</option>
        </select>
      </label>
      <label className="field">Image URL (optional)<input id="card-img" value={img} onChange={(e) => setImg(e.target.value)} spellCheck={false} /></label>
      <label className="field">NFT mint address (optional)<input id="card-mint" value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} maxLength={44} /></label>
      <div className="row"><button className="btn ghost" onClick={addCard}>Add card</button></div>
    </div>
  );
}
