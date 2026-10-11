import { useCallback, useEffect, useState } from "react";
import { supabase, timeLeft, type Season, type Status } from "../lib/supabase";
import { checkPass } from "../lib/wallet";
import { creatureImage, SPECIES } from "../lib/species";
import PowerUps from "./PowerUps";
import VaultDraws from "./VaultDraws";
import ItemsMarket from "./ItemsMarket";
import UsdHelper from "./UsdHelper";
import MintPass from "./MintPass";
import { saveWhitelist } from "../lib/passmint";

type Tier = "common" | "uncommon" | "rare" | "epic";
type Odds = { tier: Tier; weight: number; sort: number };
type Card = { id: number; name: string; grade: string; tier: Tier; value_coins: number; image_url: string | null; status: string; won_by: string | null };
type Pull = { id: number; card_id: number; tier: Tier; price: number; auto_sold: boolean; sold_back: boolean; buyback: number; created_at: string };
type Reveal = { tier: Tier; card: { id: number; name: string; grade: string; value: number; image_url: string | null }; auto_sold: boolean; buyback: number; pull_id: number };

const TIER_LABEL: Record<Tier, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic" };

const PASS_STATUS: Record<string, string> = {
  active: "Pass found in your wallet. Explorer mode is on!",
  no_wallet: "Add your wallet address in your Profile first.",
  verify_wallet: "Prove the wallet is yours first: in Profile, tap \"Prove it's mine\" from your wallet app.",
  not_holding: "No pass from this season in your linked wallet yet.",
  not_launched: "The NFT mint for this season hasn't opened yet.",
  not_configured: "Wallet checks aren't switched on yet. Try again soon.",
  no_season: "There's no season running right now.",
};

export default function GachaPanel({ userId, status, season, isAdmin, onCoins, onTravelHotspot, toast }: {
  userId: string;
  status: Status | null;
  season: Season | null;
  onTravelHotspot: (lat: number, lng: number) => void;
  isAdmin: boolean;
  onCoins: () => void;
  toast: (m: string) => void;
}) {
  const [coinGacha, setCoinGacha] = useState(false);
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

  async function verifyNft() {
    const s = await checkPass();
    toast(PASS_STATUS[s] ?? "Couldn't check your wallet right now. Try again.");
    if (s === "active") onCoins();
  }

  const [wl, setWl] = useState<{ size: number; rank: number | null; on_list: boolean; has_wallet: boolean; spots_taken: number } | null>(null);
  useEffect(() => { supabase.rpc("whitelist_status").then(({ data }) => data && setWl(data)); }, [status?.coins]);

  const inAppMint = !!season?.collection && !!season?.candy_machine;
  const mintLive = inAppMint || (!!season?.collection && !!season?.mint_url);
  const coinPrice = status?.pass_price ?? 5000;
  const short = (status?.coins ?? 0) < coinPrice;

  return (
    <>
      <div className={"card pass" + (status?.has_pass ? " active" : "")}>
        <div className="pass-head">
          <strong>{season?.name ?? "Season Pass"}</strong>
          {season && <span className="tag">Ends in {timeLeft(season.ends_at)}</span>}
        </div>
        {status?.has_pass
          ? <p className="sub ok">Your pass is active until the season ends ({new Date(status.pass_until!).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}).</p>
          : <p className="sub">Only {season?.supply ?? 111} passes exist this season, mintable only while it runs.{season?.minted ? ` ${season.minted} claimed so far.` : ""}</p>}
        <ul className="rules">
          <li><b>Explore anywhere</b> from the couch: tap the map to send your explorer. Free players hunt by walking.</li>
          <li><b>{status?.pass_bounty_mult ?? 10}x coin bounties</b> on every catch. The multiplier adjusts daily so the season's coin pot lasts.</li>
          <li><b>Wider sight</b>: {status?.pass_sight_m ?? 500} m instead of 300 m.</li>
          <li>Raffle entries stay the same for everyone: {status?.daily_cap ?? 20} a day max.</li>
        </ul>
        {!status?.has_pass && (inAppMint ? (
          <MintPass onActive={onCoins} onCheck={verifyNft} toast={toast} />
        ) : mintLive ? (
          <div className="row">
            <a className="btn" href={season!.mint_url!} target="_blank" rel="noopener noreferrer">
              Mint pass{season?.mint_price_tokens ? ` · ${Number(season.mint_price_tokens).toLocaleString()} tokens` : ""}
            </a>
            <button className="btn ghost" onClick={verifyNft}>I minted, check my wallet</button>
          </div>
        ) : season?.pass_coins_enabled !== false ? (
          <>
            <p className="sub">The NFT pass mint opens at token launch. Until then, unlock this season with coins:</p>
            <button className="btn" onClick={buyPass} disabled={short}>
              {short ? `Need ${(coinPrice - (status?.coins ?? 0)).toLocaleString()} more coins` : `Unlock with ${coinPrice.toLocaleString()} coins`}
            </button>
          </>
        ) : <p className="sub">The pass mint opens soon.</p>)}
        {status?.has_pass && mintLive && <button className="btn ghost small" onClick={verifyNft}>Re-check my wallet</button>}
      </div>

      {wl && (
        <div className={"card wl" + (wl.on_list ? " active" : "")}>
          <div className="pass-head">
            <strong>Genesis whitelist</strong>
            <span className="tag">{wl.spots_taken}/{wl.size} spots taken</span>
          </div>
          {wl.on_list
            ? <p className="sub ok">You're #{wl.rank} on the whitelist. You get a <b>free mint</b> of the first Season Pass collection ({season?.supply ?? 420} passes) when it launches.</p>
            : !wl.has_wallet && wl.spots_taken < wl.size
              ? <p className="sub">The first {wl.size} players to link a wallet get a <b>free mint</b> of the first Season Pass collection ({season?.supply ?? 420} passes). Add your wallet address in Profile to grab a spot.</p>
              : <p className="sub">All {wl.size} free-mint spots are taken. The public mint opens at token launch.</p>}
        </div>
      )}

      {season && season.species.length > 0 && (
        <div className="card">
          <strong>This season's creatures</strong>
          <div className="dex">
            {season.species.map((id) => (
              <div key={id}><img src={creatureImage(id, 48)} alt="" /><b>{SPECIES[id]?.name}</b></div>
            ))}
          </div>
          <p className="sub">New this season. They spawn 4x more often in hotspot cities, stay in the wild after the season ends, and are up for auction in the Mint tab:</p>
          <div className="hist">
            {season.hotspots.map((h) => (
              <div key={h.name}><span>★ {h.name}</span>
                <button className="btn ghost small" onClick={() => onTravelHotspot(h.lat, h.lng)}>Go</button></div>
            ))}
          </div>
        </div>
      )}

      <VaultDraws isAdmin={isAdmin} coins={status?.coins ?? 0} onCoins={onCoins} onCoinGacha={setCoinGacha} toast={toast} />

      <PowerUps isAdmin={isAdmin} coins={status?.coins ?? 0} onChanged={onCoins} toast={toast} />

      <ItemsMarket isAdmin={isAdmin} coins={status?.coins ?? 0} onChanged={onCoins} toast={toast} />

      {coinGacha && (<>
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
      </>)}

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

      {isAdmin && <AdminTools userId={userId} status={status} season={season} onDone={() => { load(); onCoins(); }} toast={toast} />}
    </>
  );
}

function EconomyKnobs({ status, onDone, toast }: { status: Status | null; onDone: () => void; toast: (m: string) => void }) {
  const [mult, setMult] = useState(String(status?.pass_bounty_mult ?? 10));
  const [coinPrice, setCoinPrice] = useState(String(status?.pass_price ?? 5000));
  const [fee, setFee] = useState("5");
  useEffect(() => { setMult(String(status?.pass_bounty_mult ?? 10)); setCoinPrice(String(status?.pass_price ?? 5000)); },
    [status?.pass_bounty_mult, status?.pass_price]);
  async function save() {
    const { data, error } = await supabase.rpc("admin_economy_settings", {
      p_pass_mult: parseInt(mult, 10) || null, p_pass_price: parseInt(coinPrice, 10) || null, p_market_fee: fee === "" ? null : parseInt(fee, 10) });
    if (error) { toast("Couldn't save: " + error.message); return; }
    const d = data as { pass_mult: number; pass_price: number; market_fee: number };
    toast(`Saved: pass ${d.pass_mult}x bounties, ${d.pass_price.toLocaleString()} coins, ${d.market_fee}% market fee.`);
    onDone();
  }
  return (
    <>
      <strong>Coin economy</strong>
      <div className="row">
        <label className="field grow">Pass bounty x<input inputMode="numeric" value={mult} onChange={(e) => setMult(e.target.value)} /></label>
        <label className="field grow">Pass coin price<input inputMode="numeric" value={coinPrice} onChange={(e) => setCoinPrice(e.target.value)} /></label>
        <label className="field grow">Market fee %<input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
      </div>
      <p className="sub small">Setting the multiplier by hand is overridden by auto-tune while it's on (it stays within the min and max). The market fee is burned.</p>
      <div className="row"><button className="btn ghost" onClick={save}>Save economy</button></div>
      <PassMultAuto onDone={onDone} toast={toast} />
    </>
  );
}

type MultInfo = { mult: number; auto: boolean; min: number; max: number;
  log: { old: number; new: number; reason: string; runway: number | null; target: number | null; at: string }[] };
const WHY: Record<string, string> = { pot_draining: "pot running out early", pot_healthy: "pot lasting well past the season", outside_bounds: "kept within min/max" };

function PassMultAuto({ onDone, toast }: { onDone: () => void; toast: (m: string) => void }) {
  const [info, setInfo] = useState<MultInfo | null>(null);
  const [auto, setAuto] = useState(true);
  const [min, setMin] = useState("2");
  const [max, setMax] = useState("5");
  const apply = (d: MultInfo) => { setInfo(d); setAuto(d.auto); setMin(String(d.min)); setMax(String(d.max)); };
  useEffect(() => { supabase.rpc("pass_mult_info").then(({ data }) => data && apply(data as MultInfo)); }, []);
  async function save() {
    const { data, error } = await supabase.rpc("admin_pass_mult", { p_auto: auto, p_min: parseInt(min, 10) || null, p_max: parseInt(max, 10) || null });
    if (error) { toast("Couldn't save: " + error.message); return; }
    apply(data as MultInfo); onDone();
    toast(auto ? `Auto-tune on: pass bounties now ${(data as MultInfo).mult}x, kept between ${min}x and ${max}x.` : "Auto-tune off. The multiplier stays where you set it.");
  }
  if (!info) return null;
  return (
    <>
      <strong>Pass multiplier auto-tune</strong>
      <p className="sub small">Once a day, compares how long the coin pot lasts at the last 24 hours' bounty rate with the time left in the season. Draining too fast: one step down. Lasting more than 1.5x longer than needed: one step up. Now <b>{info.mult}x</b>.</p>
      <label className="toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Adjust automatically</label>
      <div className="row">
        <label className="field grow">Min x<input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label className="field grow">Max x<input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} /></label>
        <button className="btn ghost" onClick={save}>Save auto-tune</button>
      </div>
      {info.log.length > 0 && (
        <div className="hist">{info.log.map((l, i) => (
          <div key={i}><span>{new Date(l.at).toLocaleDateString([], { month: "short", day: "numeric" })}: {l.old}x → {l.new}x</span>
            <span className="tag">{WHY[l.reason] ?? l.reason}{l.runway != null ? ` · ${l.runway}d left vs ${l.target}d` : ""}</span></div>
        ))}</div>
      )}
    </>
  );
}

function AdminTools({ userId, status, season, onDone, toast }: { userId: string; status: Status | null; season: Season | null; onDone: () => void; toast: (m: string) => void }) {
  const [col, setCol] = useState(season?.collection ?? "");
  const [mintUrl, setMintUrl] = useState(season?.mint_url ?? "");
  const [price, setPrice] = useState(String(season?.mint_price_tokens ?? 5000));
  const [supply, setSupply] = useState(String(season?.supply ?? 111));
  useEffect(() => {
    if (!season) return;
    setCol(season.collection ?? ""); setMintUrl(season.mint_url ?? "");
    setPrice(String(season.mint_price_tokens ?? 5000)); setSupply(String(season.supply ?? 111));
  }, [season?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wlCount, setWlCount] = useState<number | null>(null);
  async function exportWl() {
    const { data, error } = await supabase.rpc("admin_whitelist");
    if (error) { toast("Couldn't load the whitelist: " + error.message); return; }
    const rows = (data ?? []) as { address: string }[];
    setWlCount(rows.length);
    const text = rows.map((r) => r.address).join("\n");
    try { await navigator.clipboard.writeText(text); toast(`Copied ${rows.length} addresses. Paste them into whitelist.txt for the mint script.`); }
    catch { toast(`${rows.length} addresses loaded, but copying was blocked by the browser.`); }
  }
  const [cmAddr, setCmAddr] = useState(season?.candy_machine ?? "");
  const [wlText, setWlText] = useState("");
  useEffect(() => { setCmAddr(season?.candy_machine ?? ""); }, [season?.candy_machine]);
  async function saveCandyMachine() {
    const { error } = await supabase.rpc("admin_set_candy_machine", { p_candy_machine: cmAddr.trim() });
    toast(error ? "Couldn't save: " + error.message : cmAddr.trim() ? "Candy Machine saved. The in-game mint is live once the collection address is set too." : "In-game mint turned off.");
    onDone();
  }
  async function saveWl() {
    const list = wlText.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    const r = await saveWhitelist(list);
    const why: Record<string, string> = {
      root_mismatch: "That list doesn't match the whitelist on the Candy Machine. Paste the exact whitelist.txt used by create-season, same order.",
      no_wl_group: "This Candy Machine has no free-mint group.", bad_list: "One of those lines isn't a wallet address.",
      not_launched: "Save the collection and Candy Machine addresses first.", admins_only: "Admins only.",
    };
    toast(r.error ? (why[r.error] ?? "Couldn't save the whitelist.") : `Whitelist saved: ${r.saved} wallets can mint free.`);
    if (!r.error) { setWlText(""); onDone(); }
  }
  async function saveMint() {
    const { error } = await supabase.rpc("admin_set_season_mint", { p_collection: col, p_mint_url: mintUrl, p_price: Number(price) || null, p_supply: parseInt(supply, 10) || null });
    toast(error ? "Couldn't save: " + error.message : "Season mint details saved.");
    onDone();
  }
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
      <strong>Genesis whitelist</strong>
      <div className="row">
        <button className="btn ghost small" onClick={exportWl}>Copy whitelist addresses</button>
        {wlCount !== null && <span className="sub">{wlCount} wallets on the list</span>}
      </div>
      <strong>Season pass mint ({season?.name ?? "no active season"})</strong>
      <label className="field">Pass collection address<input id="season-col" value={col} onChange={(e) => setCol(e.target.value)} spellCheck={false} maxLength={44} placeholder="Set after running the mint script" /></label>
      <label className="field">Mint page URL<input id="season-url" value={mintUrl} onChange={(e) => setMintUrl(e.target.value)} spellCheck={false} placeholder="https://..." /></label>
      <div className="row">
        <label className="field grow">Price (tokens)<input id="season-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="field grow">Supply<input id="season-supply" inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value)} /></label>
      </div>
      <UsdHelper label="Price the pass in dollars (about $12 suggested)" defaultUsd="12" onTokens={(t) => setPrice(String(t))} toast={toast} />
      <div className="row"><button className="btn ghost" onClick={saveMint}>Save mint details</button></div>
      <strong>In-game mint</strong>
      <div className="row">
        <label className="field grow">Candy Machine address<input id="season-cm" value={cmAddr} onChange={(e) => setCmAddr(e.target.value)} spellCheck={false} maxLength={44} placeholder="Printed by create-season" /></label>
        <button className="btn ghost" onClick={saveCandyMachine}>Save</button>
      </div>
      <label className="field">Free-mint whitelist (paste whitelist.txt exactly){season?.has_whitelist ? " · saved" : ""}
        <textarea id="season-wl" rows={3} value={wlText} onChange={(e) => setWlText(e.target.value)} spellCheck={false} placeholder="One address per line, same order as the file given to create-season" />
      </label>
      <div className="row"><button className="btn ghost" onClick={saveWl} disabled={!wlText.trim()}>Check against Candy Machine and save</button></div>
      <p className="sub small">The whitelist is checked against the Merkle root on-chain before it's saved, and stays private. The treasury needs a $VDRAKE token account before paid mints work.</p>
      <EconomyKnobs status={status} onDone={onDone} toast={toast} />
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
