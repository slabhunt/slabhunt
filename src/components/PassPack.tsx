// The Season Pass as a sealed card pack. It floats until its season's tiers are revealed; then the player taps it to
// rip it open and the graded slab with their tier rises out. Opening is only an animation: the tier was already dealt
// by the public reveal (see /verify?season=N), so nothing here talks to the server.
import { useEffect, useRef, useState } from "react";
import { celebrate } from "../lib/celebrate";

const TIERS = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary"];
const GLOW = ["#E8B33A", "#B9C3D6", "#5DC28A", "#4C9BE0", "#A46BE8", "#F2C14E"];
// Bigger shows for rarer tiers.
const SHOW = [0, 3, 4, 6, 8, 12];
const TEAR_Y = 470; // pack coordinates (the pack is drawn at 470x740 and scaled down)

// A fixed jagged tear line so the two halves of the pack fit together exactly.
const EDGE = (() => {
  let s = 7;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const pts: string[] = [];
  for (let i = 0; i <= 18; i++) pts.push(`${((i / 18) * 470).toFixed(0)}px ${(TEAR_Y + (r() - 0.5) * 34).toFixed(0)}px`);
  return pts;
})();
const TOP_CLIP = `polygon(0 0, 470px 0, ${[...EDGE].reverse().join(", ")})`;
const BOTTOM_CLIP = `polygon(${EDGE.join(", ")}, 470px 740px, 0 740px)`;

function storedOpen(key: string) {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

function PackArt({ label }: { label: string }) {
  return (
    <>
      <div className="pp-foil" />
      <div className="pp-crimp t" /><div className="pp-crimp b" />
      <div className="pp-tear" /><div className="pp-notch" />
      <div className="pp-frame" />
      <div className="pp-brand">SLAB <span>HUNT</span></div>
      <div className="pp-sub">SEASON PASS</div>
      <img className="pp-sil" src="/brand/vaultdrake.svg" alt="" />
      <div className="pp-q">?</div>
      <div className="pp-ribbon">{label}</div>
      <div className="pp-inside">1 GRADED PASS INSIDE</div>
      <div className="pp-sheen" />
    </>
  );
}

export default function PassPack({ seasonId, seasonName, tier, size = 170 }: {
  seasonId: number; seasonName: string; tier: number; size?: number;
}) {
  const key = `sh_pack_open_${seasonId}`;
  const [phase, setPhase] = useState<"sealed" | "opening" | "open">(() => (tier > 0 && storedOpen(key) ? "open" : "sealed"));
  const fx = useRef<HTMLCanvasElement>(null);
  const stop = useRef<() => void>();
  const timer = useRef<number>();
  useEffect(() => () => { stop.current?.(); window.clearTimeout(timer.current); }, []);
  const label = seasonName.split(":")[0].toUpperCase();
  const k = size / 470;

  function rip() {
    if (tier <= 0 || phase !== "sealed") return;
    try { localStorage.setItem(key, "1"); } catch { /* the animation still plays */ }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setPhase("open"); return; }
    setPhase("opening");
    timer.current = window.setTimeout(() => {
      if (fx.current) stop.current = celebrate(fx.current, { colors: [GLOW[tier]], rockets: SHOW[tier], confetti: 60 + tier * 30, origin: { x: 0.5, y: 0.35 } });
      timer.current = window.setTimeout(() => setPhase("open"), 900);
    }, 800);
  }

  const ready = tier > 0 && phase === "sealed";
  return (
    <div className="pp-wrap">
      <canvas ref={fx} className="pp-fx" aria-hidden="true" />
      <button
        type="button"
        className={`pp-stage pp-${phase} pt${tier}${ready ? " ready" : ""}`}
        style={{ width: size, height: (740 + 320) * k }}
        onClick={rip}
        disabled={!ready}
        aria-label={ready ? "Rip open your Season Pass pack" : tier > 0 ? `${TIERS[tier]} Season Pass` : "Sealed Season Pass pack"}
      >
        <div className="pp-rays" />
        <div className="pp-float">
          <div className="pp-pack" style={{ transform: `scale(${k})` }}>
            <div className="pp-slab">
              <div className="pp-label"><span>{TIERS[tier]?.toUpperCase() || "?"}</span><b>{tier || "?"}</b></div>
              <div className="pp-face"><img src="/brand/vaultdrake.svg" alt="" /></div>
            </div>
            <div className="pp-half bottom" style={{ clipPath: BOTTOM_CLIP }}><PackArt label={label} /></div>
            <div className="pp-half top" style={{ clipPath: TOP_CLIP }}><PackArt label={label} /></div>
          </div>
        </div>
      </button>
      <p className="sub small pp-caption" aria-live="polite">
        {tier <= 0 ? "Sealed. It opens when the season starts and the tiers are revealed."
          : phase === "sealed" ? "Your pack is ready. Tap it to rip it open!"
          : phase === "opening" ? "Ripping..."
          : `${TIERS[tier]}: +${tier} level${tier > 1 ? "s" : ""} in every power-up this season.`}
      </p>
    </div>
  );
}
