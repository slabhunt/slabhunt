import { useEffect, useRef, useState } from "react";
import type { Drop } from "../lib/supabase";
import { drawCreature, RARITY, SPECIES } from "../lib/species";

export type CatchResult =
  | { result: "caught"; entries: number; xp: number; species: number; walked?: boolean; coins_won?: number }
  | { result: "escaped" | "fled" | "gone" | "too_far" | "cooldown" | "traveling" | "limit" | "error"; message?: string };

const MESSAGES: Record<string, string> = {
  escaped: "It broke free. Try again.",
  fled: "It ran away.",
  gone: "Another hunter caught it first, or it wandered off.",
  too_far: "Your explorer is too far away. Move closer and try again.",
  cooldown: "Catch your breath, then throw again.",
  traveling: "Your explorer is still on the way. Wait until it arrives.",
  limit: "You've hit this hour's catch limit. Take a break and come back soon.",
};

export default function CatchModal({ drop, onClose, onThrow }: {
  drop: Drop;
  onClose: () => void;
  onThrow: (quality: number) => Promise<CatchResult>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const t0 = useRef(performance.now());
  const [msg, setMsg] = useState("Tap Throw when the gold ring lines up with the white ring.");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const s = SPECIES[drop.species_id] ?? SPECIES[0];
  const period = s.rar === "r" ? 1100 : 1500;
  const ring = (t: number) => 200 - (((t - t0.current) % period) / period) * 170;

  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      const c = canvas.current;
      if (c) {
        const g = c.getContext("2d")!;
        g.clearRect(0, 0, 480, 480);
        drawCreature(g, drop.species_id, 240, 250, 70, t);
        g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 6; g.beginPath(); g.arc(240, 250, 105, 0, 7); g.stroke();
        if (!done) { g.strokeStyle = "#E8B33A"; g.lineWidth = 8; g.beginPath(); g.arc(240, 250, ring(t), 0, 7); g.stroke(); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  async function doThrow() {
    if (busy || done) return;
    const off = Math.abs(ring(performance.now()) - 105);
    const quality = off < 14 ? 1 : off < 32 ? 0.6 : 0.15;
    setBusy(true);
    setMsg("Throwing...");
    const r = await onThrow(quality);
    setBusy(false);
    if (r.result === "caught") {
      setDone(true);
      setMsg(`Caught! +${r.entries} ${r.entries > 1 ? "entries" : "entry"}, +${r.xp} XP${r.coins_won ? `, +${r.coins_won} coins` : ""}${r.walked ? " (walking bonus!)" : ""}`);
      setTimeout(onClose, 1600);
    } else if (r.result === "fled" || r.result === "gone" || r.result === "limit") {
      setDone(true);
      setMsg(MESSAGES[r.result]);
      setTimeout(onClose, 1600);
    } else {
      setMsg(r.message || MESSAGES[r.result] || "Something went wrong. Try again.");
    }
  }

  return (
    <div className="catch" role="dialog" aria-modal="true" aria-labelledby="catch-title">
      <div className="catch-card">
        <span className={"rar " + s.rar}>{RARITY[s.rar].label}</span>
        <h3 id="catch-title">{s.name}</h3>
        <canvas ref={canvas} width={480} height={480} className="catch-canvas" aria-label="Catch ring" onClick={doThrow} />
        <div className="catch-msg" aria-live="polite">{msg}</div>
        <div className="row">
          <button className="btn" onClick={doThrow} disabled={busy || done}>Throw</button>
          <button className="btn ghost" onClick={onClose}>Walk away</button>
        </div>
      </div>
    </div>
  );
}
