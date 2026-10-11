// First-run demo: a few swipeable cards that show the controls, with one practice throw.
// Shown once per device after signing the terms; the ? button in the header replays it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { creatureImage } from "../lib/species";
import { ArtHud, ArtMap, ArtPowerUps, ArtPrize, ArtRarity, PICK } from "./GuideArt";

const KEY = "vh_tutorial_v1";
export function tutorialSeen() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(KEY, "1"); } catch { /* private mode: it just shows again next time */ }
}

const PERIOD = 1600; // ms for the gold ring to shrink from 1.8x to 0.6x

/** Practice throw: same timing idea as the real catch screen. */
function PracticeThrow({ onCaught }: { onCaught: () => void }) {
  const t0 = useRef(performance.now());
  const [run, setRun] = useState(0);
  const [msg, setMsg] = useState("Tap Throw when the gold ring lines up with the white ring.");
  const [caught, setCaught] = useState(false);

  function toss() {
    if (caught) return;
    const phase = ((performance.now() - t0.current) % PERIOD) / PERIOD;
    const scale = 1.8 - 1.2 * phase;
    if (Math.abs(scale - 1) < 0.16) { setCaught(true); setMsg("Gotcha! In the real game that's raffle entries, XP and coins."); onCaught(); }
    else { setMsg(scale > 1 ? "A little early. Wait for the rings to meet." : "A little late. Try again."); }
  }
  function again() { t0.current = performance.now(); setRun((r) => r + 1); setCaught(false); setMsg("Tap Throw when the gold ring lines up with the white ring."); }

  return (
    <div className="practice">
      <div className={"art art-catch" + (caught ? " caught" : "")} onClick={toss} role="button" aria-label="Practice catch. Tap to throw.">
        <div className="ring white" />
        {!caught && <div key={run} className="ring gold live" style={{ animationDuration: `${PERIOD}ms` }} />}
        <img src={creatureImage(PICK.u, 64)} alt="" />
      </div>
      <p className="sub center" aria-live="polite">{msg}</p>
      <div className="row center-row">
        {caught ? <button className="btn ghost small" onClick={again}>Try again</button> : <button className="btn" onClick={toss}>Throw</button>}
      </div>
    </div>
  );
}

type Step = { title: string; body: ReactNode; art: ReactNode };

export default function Tutorial({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [practiced, setPracticed] = useState(false);
  const touch = useRef<number | null>(null);

  const steps: Step[] = [
    {
      title: "Hunt creatures. Win real cards.",
      art: <ArtPrize label="Free raffle entries" />,
      body: <>Creatures appear on a real map. Every catch earns <b>free raffle entries</b> for real graded trading cards. No purchase needed to play or win.</>,
    },
    {
      title: "Move around the map",
      art: <ArtMap mode="tap" />,
      body: <>You only see what's inside the <b>blue circle</b>. Free players <b>walk</b> for real to move. Season Pass holders can also <b>tap the map</b> to send their explorer anywhere.</>,
    },
    {
      title: "Catch: try it now",
      art: <PracticeThrow onCaught={() => setPracticed(true)} />,
      body: <>Get within 60 m of a creature and tap <b>Catch</b>. You get <b>30 free throws a day</b>; buy more with coins from the 🎯 button.</>,
    },
    {
      title: "Rarer means more entries",
      art: <ArtRarity />,
      body: <>Entries go into the <b>Draw</b> tab's raffle. Everyone has the same limit of <b>20 entries a day</b>, so playing smart beats paying. You also get free weekly tickets for <b>Vault Draws</b>.</>,
    },
    {
      title: "Power up your way",
      art: <ArtPowerUps />,
      body: <>Power-up points go where you choose: <b>more throws</b>, a <b>faster explorer</b>, or <b>wider sight</b>. Get points with coins, Power Cells, or $SLAB. They never add raffle odds.</>,
    },
    {
      title: "Your map buttons",
      art: <ArtHud />,
      body: <>Tap <b>🎯 Throws</b> for more throws, <b>Sight</b> to see farther for 30 minutes, <b>🏙️ 3D</b> for a street-level view, and <b>📷 Hunt</b> to look for creatures through your camera.</>,
    },
  ];
  const last = i === steps.length - 1;
  const s = steps[i];

  function finish() { markSeen(); onDone(); }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tut-title"
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current; touch.current = null;
        if (dx < -50) setI((v) => Math.min(v + 1, steps.length - 1));
        if (dx > 50) setI((v) => Math.max(v - 1, 0));
      }}>
      <div className="tut-card">
        <div className="tut-top">
          <span className="sub small">{i + 1} of {steps.length}</span>
          <button className="btn ghost small" onClick={finish}>Skip</button>
        </div>
        <div className="tut-art" key={i}>{s.art}</div>
        <h2 id="tut-title" className="tut-title">{s.title}</h2>
        <p className="tut-body">{s.body}</p>
        <div className="tut-dots" aria-hidden="true">{steps.map((_, j) => <span key={j} className={j === i ? "on" : ""} />)}</div>
        <div className="row tut-nav">
          {i > 0 && <button className="btn ghost" onClick={() => setI(i - 1)}>Back</button>}
          {last
            ? <button className="btn grow" onClick={finish}>Start hunting</button>
            : <button className="btn grow" onClick={() => setI(i + 1)}>{i === 2 && !practiced ? "Skip practice" : "Next"}</button>}
        </div>
        {last && <a className="tut-link" href="/guide" target="_blank" rel="noopener">Watch the 3-minute video and read the full guide</a>}
      </div>
    </div>
  );
}
