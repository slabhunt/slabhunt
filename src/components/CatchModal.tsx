import { useCallback, useEffect, useRef, useState } from "react";
import type { Drop } from "../lib/supabase";
import { creatureImage, drawCreature, RARITY, SPECIES } from "../lib/species";

export type CatchResult =
  | { result: "caught"; entries: number; xp: number; species: number; walked?: boolean; coins_won?: number; capped?: boolean; token_throw?: boolean }
  | { result: "escaped" | "fled" | "gone" | "too_far" | "cooldown" | "traveling" | "limit" | "error"; message?: string }
  | { result: "no_throws"; pack_size: number; pack_price: number };

const MESSAGES: Record<string, string> = {
  escaped: "It broke free. Try again.",
  fled: "It ran away.",
  gone: "Another hunter caught it first, or it wandered off.",
  too_far: "Your explorer is too far away. Move closer and try again.",
  cooldown: "Catch your breath, then throw again.",
  traveling: "Your explorer is still on the way. Wait until it arrives.",
  limit: "You've hit this hour's catch limit. Take a break and come back soon.",
  no_throws: "You're out of throws for today.",
};

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };
const PX_PER_DEG = 9; // how far the creature slides on screen per degree you turn the phone

export default function CatchModal({ drop, retro, throwsLeft, onBuyThrows, onClose, onThrow }: {
  drop: Drop;
  retro: boolean;
  throwsLeft: number | null;              // free + bought throws left today (null while loading)
  onBuyThrows: () => Promise<boolean>;
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
  const [won, setWon] = useState<Extract<CatchResult, { result: "caught" }> | null>(null);
  const [outOf, setOutOf] = useState<{ size: number; price: number } | null>(null);
  const s = SPECIES[drop.species_id] ?? SPECIES[0];
  const period = s.rar === "l" ? 900 : s.rar === "r" ? 1100 : 1500;
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
        if (!done) { g.strokeStyle = retro ? "#00E5FF" : "#E8B33A"; g.lineWidth = 8; g.beginPath(); g.arc(240 + ox, 250 + oy, ring(t), 0, 7); g.stroke(); }
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
    setArNote("");
    setMsg("Throwing...");
    const r = await onThrow(quality);
    setBusy(false);
    if (r.result === "caught") {
      setDone(true);
      setMsg("Caught!");
      // Stay open on a reveal screen until the player taps Continue.
      setWon(r);
    } else if (r.result === "fled" || r.result === "gone" || r.result === "limit") {
      setDone(true);
      setMsg(MESSAGES[r.result]);
      setTimeout(close, 1600);
    } else if (r.result === "no_throws") {
      setOutOf({ size: r.pack_size, price: r.pack_price });
      setMsg(MESSAGES.no_throws);
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
        {outOf ? (
          <button className="btn" disabled={busy} onClick={async () => {
            setBusy(true);
            const ok = await onBuyThrows();
            setBusy(false);
            if (ok) { setOutOf(null); setMsg("Throws added. Time it and throw!"); }
          }}>Buy {outOf.size} throws · {outOf.price} coins</button>
        ) : throwsLeft != null && <p className="sub center throws-left">{throwsLeft} {throwsLeft === 1 ? "throw" : "throws"} left today</p>}
        <div className="row">
          <button className="btn" onClick={doThrow} disabled={busy || done || !!outOf}>Throw</button>
          {ar
            ? <button className="btn ghost" onClick={stopAr}>Exit AR</button>
            : <button className="btn ghost" onClick={startAr}>AR</button>}
          <button className="btn ghost" onClick={close}>Walk away</button>
        </div>
      </div>
      {won && (
        <div className="caught" role="alertdialog" aria-labelledby="caught-title" onClick={(e) => e.stopPropagation()}>
          <div className="caught-card">
            <div className="caught-burst" aria-hidden="true" />
            <p className="caught-kicker">Gotcha!</p>
            <img className="caught-img" src={creatureImage(won.species ?? drop.species_id, 160)} alt="" width={160} height={160} />
            <h3 id="caught-title">You caught {(SPECIES[won.species ?? drop.species_id] ?? s).name}</h3>
            <span className={"rar " + (SPECIES[won.species ?? drop.species_id] ?? s).rar}>{RARITY[(SPECIES[won.species ?? drop.species_id] ?? s).rar].label}</span>
            <div className="caught-rewards">
              <div><b>+{won.entries}</b><small>{won.entries === 1 ? "Entry" : "Entries"}</small></div>
              <div><b>+{won.xp}</b><small>XP</small></div>
              {!!won.coins_won && <div><b>+{won.coins_won}</b><small>Coins</small></div>}
            </div>
            {won.walked && <p className="sub">Walking bonus applied.</p>}
            {won.token_throw && <p className="sub">Power-up throw: counts for your log and XP, not raffle entries or coins.</p>}
            {won.capped && <p className="sub">{won.entries === 0 ? "You've hit today's entry limit, so this one gave no new entries." : "That's today's entry limit. Catches still give XP and coins."}</p>}
            <p className="sub">Added to your Creature log in Profile.</p>
            <button className="btn" onClick={close} autoFocus>Continue</button>
          </div>
        </div>
      )}
    </div>
  );
}
