import { useCallback, useEffect, useRef, useState } from "react";
import type { Drop } from "../lib/supabase";
import { drawCreature, RARITY, SPECIES } from "../lib/species";

export type CatchResult =
  | { result: "caught"; entries: number; xp: number; species: number; walked?: boolean; coins_won?: number; capped?: boolean }
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

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };
const PX_PER_DEG = 9; // how far the creature slides on screen per degree you turn the phone

export default function CatchModal({ drop, retro, onClose, onThrow }: {
  drop: Drop;
  retro: boolean;
  onClose: () => void;
  onThrow: (quality: number) => Promise<CatchResult>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const anchor = useRef<{ a: number; b: number } | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  const t0 = useRef(performance.now());
  const [msg, setMsg] = useState("Tap Throw when the gold ring lines up with the white ring.");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ar, setAr] = useState(false);
  const [arNote, setArNote] = useState("");
  const s = SPECIES[drop.species_id] ?? SPECIES[0];
  const period = s.rar === "r" ? 1100 : 1500;
  const ring = (t: number) => 200 - (((t - t0.current) % period) / period) * 170;

  // Retro draws at a quarter of the resolution; CSS scales it back up with hard pixel edges.
  const scale = retro ? 0.25 : 1;
  const size = 480 * scale;

  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      const c = canvas.current;
      if (c) {
        const g = c.getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, c.width, c.height);
        g.imageSmoothingEnabled = !retro;
        g.scale(scale, scale);
        // In AR the creature stays put in the world: shift it opposite to how the phone turned.
        const ox = ar ? offset.current.x : 0, oy = ar ? offset.current.y : 0;
        if (ar) { g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(240 + ox, 330 + oy, 60, 14, 0, 0, 7); g.fill(); }
        drawCreature(g, drop.species_id, 240 + ox, 250 + oy, 70, t);
        g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 6; g.beginPath(); g.arc(240 + ox, 250 + oy, 105, 0, 7); g.stroke();
        if (!done) { g.strokeStyle = retro ? "#0F380F" : "#E8B33A"; g.lineWidth = 8; g.beginPath(); g.arc(240 + ox, 250 + oy, ring(t), 0, 7); g.stroke(); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  const stopAr = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    anchor.current = null;
    offset.current = { x: 0, y: 0 };
    setAr(false);
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { stopAr(); onClose(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose, stopAr]);

  // Motion sensors: remember where you were pointing when AR started, then track the difference.
  useEffect(() => {
    if (!ar) return;
    const onTurn = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null) return;
      if (!anchor.current) { anchor.current = { a: e.alpha, b: e.beta }; return; }
      let da = e.alpha - anchor.current.a;
      if (da > 180) da -= 360; if (da < -180) da += 360;
      const db = e.beta - anchor.current.b;
      offset.current = { x: Math.max(-600, Math.min(600, da * PX_PER_DEG)), y: Math.max(-600, Math.min(600, db * PX_PER_DEG)) };
    };
    addEventListener("deviceorientation", onTurn);
    return () => removeEventListener("deviceorientation", onTurn);
  }, [ar]);

  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function startAr() {
    setArNote("");
    // iPhones ask for motion permission, and only from a tap.
    const DOE = (window as unknown as { DeviceOrientationEvent?: OrientationPermission }).DeviceOrientationEvent;
    if (DOE?.requestPermission) {
      try { await DOE.requestPermission(); } catch { /* still works without motion, creature just won't stay anchored */ }
    }
    if (!navigator.mediaDevices?.getUserMedia) { setArNote("This browser can't open the camera."); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = st;
      setAr(true);
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = st; video.current.play().catch(() => {}); } });
    } catch {
      setArNote("Camera access was blocked. Allow the camera for this site to catch in AR.");
    }
  }

  function close() { stopAr(); onClose(); }

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
      setMsg(r.capped && r.entries === 0
        ? `Caught! +${r.xp} XP${r.coins_won ? `, +${r.coins_won} coins` : ""}. You've reached today's entry limit, so no new entries.`
        : `Caught! +${r.entries} ${r.entries === 1 ? "entry" : "entries"}, +${r.xp} XP${r.coins_won ? `, +${r.coins_won} coins` : ""}${r.walked ? " (walking bonus!)" : ""}${r.capped ? ". That's today's entry limit." : ""}`);
      setTimeout(close, 1600);
    } else if (r.result === "fled" || r.result === "gone" || r.result === "limit") {
      setDone(true);
      setMsg(MESSAGES[r.result]);
      setTimeout(close, 1600);
    } else {
      setMsg(r.message || MESSAGES[r.result] || "Something went wrong. Try again.");
    }
  }

  return (
    <div className={"catch" + (ar ? " ar" : "")} role="dialog" aria-modal="true" aria-labelledby="catch-title">
      {ar && <video ref={video} className="ar-video" playsInline muted autoPlay />}
      <div className="catch-card">
        <span className={"rar " + s.rar}>{RARITY[s.rar].label}</span>
        <h3 id="catch-title">{s.name}</h3>
        <canvas ref={canvas} width={size} height={size} className="catch-canvas" aria-label="Catch ring" onClick={doThrow} />
        <div className="catch-msg" aria-live="polite">{arNote || msg}</div>
        {ar && !done && <p className="sub center ar-tip">Turn your phone to find it, then throw.</p>}
        <div className="row">
          <button className="btn" onClick={doThrow} disabled={busy || done}>Throw</button>
          {ar
            ? <button className="btn ghost" onClick={stopAr}>Exit AR</button>
            : <button className="btn ghost" onClick={startAr}>AR</button>}
          <button className="btn ghost" onClick={close}>Walk away</button>
        </div>
      </div>
    </div>
  );
}
