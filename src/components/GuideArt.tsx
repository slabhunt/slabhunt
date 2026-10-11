// Small illustrated "screens" for the first-run demo and the How to play guide.
// Drawn with the game's own creature art and styles, so they always match what players see.
import { creatureImage, RARITY, SPECIES, type Rarity } from "../lib/species";

const firstOf = (r: Rarity) => Math.max(0, SPECIES.findIndex((s) => s.rar === r));
export const PICK = { c: firstOf("c"), u: firstOf("u"), r: firstOf("r"), l: firstOf("l") };

/** The map: your explorer, the blue sight circle, creatures inside it, and one hidden outside. */
export function ArtMap({ mode = "tap" }: { mode?: "tap" | "walk" | "sight" }) {
  return (
    <div className="art art-map" role="img" aria-label="Map with your explorer in the middle, a blue sight circle and creatures nearby">
      <svg viewBox="0 0 320 200" className="art-streets" aria-hidden="true">
        <path d="M-10 60 L330 40 M-10 150 L330 170 M70 -10 L90 210 M230 -10 L210 210 M-10 110 L330 105" />
      </svg>
      <div className="art-sight" />
      <div className="art-explorer" />
      <img className="art-mon" style={{ left: "40%", top: "28%" }} src={creatureImage(PICK.c, 40)} alt="" />
      <img className="art-mon bob" style={{ left: "60%", top: "56%" }} src={creatureImage(PICK.u, 40)} alt="" />
      <img className="art-mon faded" style={{ left: "86%", top: "16%" }} src={creatureImage(PICK.r, 40, true)} alt="" />
      {mode === "tap" && <><div className="art-route" /><div className="art-tap" style={{ left: "84%", top: "70%" }} /></>}
      {mode === "walk" && <div className="art-label" style={{ left: "6%", bottom: "8%" }}>🚶 Walk to move</div>}
      {mode === "sight" && <div className="art-label" style={{ right: "6%", bottom: "8%" }}>Outside the circle = hidden</div>}
    </div>
  );
}

/** The catch screen: tap Throw when the gold ring meets the white ring. */
export function ArtCatch() {
  return (
    <div className="art art-catch" role="img" aria-label="Catch screen: a gold ring shrinks toward a white ring around the creature">
      <div className="ring white" />
      <div className="ring gold" />
      <img src={creatureImage(PICK.u, 64)} alt="" />
      <div className="art-btn">Throw</div>
    </div>
  );
}

/** Rarer creatures give more raffle entries. */
export function ArtRarity() {
  return (
    <div className="art art-rarity" role="img" aria-label="Common 1 entry, Uncommon 2, Rare 5, Legendary 10">
      {(["c", "u", "r", "l"] as Rarity[]).map((r) => (
        <div key={r} className={"rar rar-" + r}>
          <img src={creatureImage(PICK[r], 40)} alt="" />
          <b>{RARITY[r].entries}</b>
          <small>{RARITY[r].label}</small>
        </div>
      ))}
    </div>
  );
}

/** The HUD pills along the top of the map. */
export function ArtHud() {
  return (
    <div className="art art-hud" role="img" aria-label="Map buttons: entries today, throws, sight, 3D, Hunt">
      <span className="pill">Today <b>4/20</b></span>
      <span className="pill">🎯 Throws <b>26</b></span>
      <span className="pill">Sight <b>300 m</b></span>
      <span className="pill">🏙️ 3D</span>
      <span className="pill">📷 Hunt</span>
      <span className="pill">👾 Retro</span>
    </div>
  );
}

/** Power-ups: three tracks, you choose where each point goes. */
export function ArtPowerUps({ levels = [2, 1, 3] }: { levels?: number[] }) {
  const rows = [["🎯 More throws", "+10 throws a day"], ["⚡ Faster explorer", "+25% travel speed"], ["👁️ Wider sight", "+50 m sight"]];
  return (
    <div className="art art-pu" role="img" aria-label="Three power-up tracks: throws, speed and sight, each up to level 5">
      {rows.map(([name, per], i) => (
        <div key={name} className="pu-row">
          <div className="pu-top"><b>{name}</b><small>{per} per level</small></div>
          <div className="pu-bar">{[0, 1, 2, 3, 4].map((j) => <span key={j} className={j < levels[i] ? "on" : ""} />)}</div>
        </div>
      ))}
    </div>
  );
}

/** Raffles: a graded card prize and your tickets. */
export function ArtPrize({ label = "Weekly Vault Draw" }: { label?: string }) {
  return (
    <div className="art art-prize" role="img" aria-label="A graded card prize with raffle tickets">
      <div className="slab"><div className="slab-top">GRADED 9</div><div className="slab-face"><img src={creatureImage(PICK.r, 52)} alt="" /></div></div>
      <div className="tickets">
        <span className="tix">🎟️ × 12</span>
        <small>{label}</small>
      </div>
    </div>
  );
}

/** Power Cells trade for coins between players. */
export function ArtMarket() {
  return (
    <div className="art art-market" role="img" aria-label="Power Cells trade for coins between players; a small fee is burned">
      <div className="mk-side"><span className="cell">🔋</span><small>Power Cell</small></div>
      <div className="mk-arrows"><span>→</span><span>←</span><small>5% fee burned</small></div>
      <div className="mk-side"><span className="coin big" aria-hidden="true" /><small>Coins</small></div>
    </div>
  );
}

/** How the whole economy loops. */
export function ArtFlywheel() {
  const nodes = [
    ["Play free", "catch, walk, check in"],
    ["Earn", "entries, XP, coins"],
    ["Win", "graded cards in raffles"],
    ["Upgrade", "power-ups with coins or $VDRAKE"],
    ["Fund", "$VDRAKE splits: burn, vault, drops, dev"],
    ["Restock", "vault buys more cards"],
  ];
  return (
    <div className="art art-fly" role="img" aria-label="Flywheel: play free, earn, win cards, upgrade, fund the vault, restock prizes, repeat">
      <svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="78" /><path d="M100 22 a78 78 0 0 1 70 44" className="arrow" /></svg>
      {nodes.map(([t, s], i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <div key={t} className="fly-node" style={{ left: `${50 + Math.cos(a) * 39}%`, top: `${50 + Math.sin(a) * 39}%` }}>
            <b>{t}</b><small>{s}</small>
          </div>
        );
      })}
      <div className="fly-mid"><img src="/brand/vdrake-coin-512.png" alt="" /></div>
    </div>
  );
}

/** Camera hunt: creatures placed around you by compass direction. */
export function ArtHuntCam() {
  return (
    <div className="art art-cam" role="img" aria-label="Camera view with a creature ahead and a radar in the corner">
      <div className="cam-sky" />
      <img className="cam-mon" src={creatureImage(PICK.c, 56)} alt="" />
      <div className="cam-tag">{SPECIES[PICK.c]?.name} · 42 m ahead</div>
      <div className="cam-radar"><span className="me" /><span className="dot" style={{ left: "60%", top: "30%" }} /><span className="dot" style={{ left: "25%", top: "65%" }} /></div>
    </div>
  );
}

/** Provably fair draws: freeze, commit, reveal, pick. */
export function ArtProof() {
  const steps = [["🔒", "Freeze", "entry list → hash"], ["⛓️", "Commit", "hash on Solana"], ["🎲", "Reveal", "drand random number"], ["🏆", "Pick", "anyone can recheck"]];
  return (
    <div className="art art-proof" role="img" aria-label="Four steps: freeze the entries, commit the hash on Solana, reveal drand randomness, pick the winner">
      {steps.map(([icon, t, s], i) => (
        <div key={t} className="pf-step" style={{ animationDelay: `${i * 0.6}s` }}>
          <span className="pf-icon">{icon}</span><b>{t}</b><small>{s}</small>
        </div>
      ))}
    </div>
  );
}
