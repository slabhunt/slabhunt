// Hunt mode: hold up the phone and see creatures out in the real world, in the direction they really are.
// Uses the camera, GPS and compass. Tap a creature in range to catch it; farther ones show how far to walk.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Drop } from "../lib/supabase";
import type { Compass } from "../lib/compass";
import { creatureImage, RARITY, SPECIES } from "../lib/species";
import { angleDiff, bearingDeg, distanceM } from "../lib/geo";

const H_FOV = 55;    // degrees across the screen in portrait, roughly a phone's main camera
const EYE_M = 1.5;   // camera height, for placing creatures on the ground

type LatLng = { lat: number; lng: number };
type Hit = { d: Drop; x0: number; y0: number; x1: number; y1: number };

const imgs = new Map<string, HTMLImageElement>();
function sprite(sp: number, retro: boolean) {
  const key = `${sp}:${retro}`;
  let i = imgs.get(key);
  if (!i) { i = new Image(); i.src = creatureImage(sp, retro ? 16 : 96); imgs.set(key, i); }
  return i;
}

export default function HuntCam({ at, drops, sightM, retro, compass, canCatch, onTap, onClose }: {
  at: LatLng;                      // where the player really is
  drops: Drop[];
  sightM: number;
  retro: boolean;
  compass: Compass;
  canCatch: (d: Drop) => boolean;
  onTap: (d: Drop) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hits = useRef<Hit[]>([]);
  const [camNote, setCamNote] = useState("");
  const live = useRef({ at, drops, sightM, retro, canCatch });
  live.current = { at, drops, sightM, retro, canCatch };

  /* ---------- camera ---------- */
  useEffect(() => {
    let stream: MediaStream | null = null, stopped = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamNote("This browser can't open the camera, so you'll see the radar only."); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) { video.current.srcObject = stream; video.current.play().catch(() => {}); }
      } catch {
        setCamNote("Camera access is blocked. Allow the camera for this site to see creatures in the real world.");
      }
    })();
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  /* ---------- drawing ---------- */
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      const c = canvas.current;
      if (c) {
        const W = c.clientWidth, H = c.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
        if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
        const g = c.getContext("2d")!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        g.imageSmoothingEnabled = !live.current.retro;
        const { at, drops, sightM, canCatch } = live.current;
        const heading = compass.ref.current.heading;
        const beta = compass.ref.current.beta ?? 85;
        const ppd = W / H_FOV;
        // Phone upright (beta 90) puts the horizon mid-screen; tilting down moves it up.
        const horizon = H / 2 + (Math.max(30, Math.min(130, beta)) - 90) * ppd;

        const items = drops
          .map((d) => ({ d, dist: distanceM(at.lat, at.lng, d.lat, d.lng), brg: bearingDeg(at.lat, at.lng, d.lat, d.lng) }))
          .filter((i) => i.dist <= sightM)
          .sort((a, b) => b.dist - a.dist);       // far first, so near ones draw on top

        const newHits: Hit[] = [];
        let left = 0, right = 0, leftNear = Infinity, rightNear = Infinity;
        for (const { d, dist, brg } of items) {
          if (heading == null) continue;
          const delta = angleDiff(brg, heading);
          if (Math.abs(delta) > H_FOV / 2 + 6) {
            if (delta < 0) { left++; leftNear = Math.min(leftNear, dist); } else { right++; rightNear = Math.min(rightNear, dist); }
            continue;
          }
          const x = W / 2 + delta * ppd;
          const ground = horizon + (Math.atan2(EYE_M, Math.max(dist, 3)) * 180 / Math.PI) * ppd;
          const size = Math.max(48, Math.min(230, 9000 / (dist + 40)));
          const bob = Math.sin(t / 320 + d.species_id) * size * 0.04;
          const near = canCatch(d);
          const rar = SPECIES[d.species_id]?.rar ?? "c";
          // shadow
          g.fillStyle = "rgba(0,0,0,.35)";
          g.beginPath(); g.ellipse(x, ground, size * 0.32, size * 0.08, 0, 0, 7); g.fill();
          if (rar === "r" || rar === "l" || near) {
            const glow = g.createRadialGradient(x, ground - size / 2, 0, x, ground - size / 2, size * 0.7);
            glow.addColorStop(0, near ? "rgba(232,179,58,.55)" : "rgba(232,179,58,.3)");
            glow.addColorStop(1, "rgba(232,179,58,0)");
            g.fillStyle = glow;
            g.beginPath(); g.arc(x, ground - size / 2, size * 0.7, 0, 7); g.fill();
          }
          const img = sprite(d.species_id, live.current.retro);
          if (img.complete) g.drawImage(img, x - size / 2, ground - size + bob, size, size);
          // label
          const label = near ? "Tap to catch" : `${SPECIES[d.species_id]?.name ?? "Creature"} · ${Math.round(dist)} m`;
          g.font = "600 13px Rubik, system-ui, sans-serif";
          const tw = g.measureText(label).width + 16;
          g.fillStyle = near ? "#E8B33A" : "rgba(15,24,40,.85)";
          g.beginPath(); g.roundRect(x - tw / 2, ground + 8, tw, 24, 12); g.fill();
          g.fillStyle = near ? "#1A1405" : "#EEE8DA";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(label, x, ground + 20);
          newHits.push({ d, x0: x - size / 2, y0: ground - size, x1: x + size / 2, y1: ground + 32 });
        }
        hits.current = newHits;

        // Edge hints for creatures behind or beside you.
        g.font = "700 13px Rubik, system-ui, sans-serif";
        g.textBaseline = "middle";
        const edge = (side: "l" | "r", n: number, nearest: number) => {
          if (!n) return;
          const txt = side === "l" ? `◀ ${n} · ${Math.round(nearest)} m` : `${n} · ${Math.round(nearest)} m ▶`;
          const tw = g.measureText(txt).width + 20, y = H * 0.42;
          const x = side === "l" ? 10 : W - 10 - tw;
          g.fillStyle = "rgba(15,24,40,.85)";
          g.beginPath(); g.roundRect(x, y - 15, tw, 30, 15); g.fill();
          g.fillStyle = "#E8B33A"; g.textAlign = "left";
          g.fillText(txt, x + 10, y);
        };
        edge("l", left, leftNear);
        edge("r", right, rightNear);

        // Radar, top right: you in the middle, forward is up (north up without a compass).
        const R = 46, cx = W - R - 14, cy = R + 64;
        g.fillStyle = "rgba(15,24,40,.8)";
        g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
        g.strokeStyle = "rgba(127,200,248,.6)"; g.lineWidth = 1.5;
        g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
        g.beginPath(); g.arc(cx, cy, R / 2, 0, 7); g.stroke();
        if (heading != null) {
          g.fillStyle = "rgba(232,179,58,.18)";
          g.beginPath(); g.moveTo(cx, cy);
          g.arc(cx, cy, R, -Math.PI / 2 - (H_FOV / 2) * Math.PI / 180, -Math.PI / 2 + (H_FOV / 2) * Math.PI / 180);
          g.closePath(); g.fill();
        }
        for (const { d, dist, brg } of items) {
          const a = ((brg - (heading ?? 0)) * Math.PI) / 180;
          const r = (dist / sightM) * (R - 4);
          const rar = SPECIES[d.species_id]?.rar;
          g.fillStyle = canCatch(d) ? "#E8B33A" : rar === "r" || rar === "l" ? "#F5CD6A" : "#EEE8DA";
          g.beginPath(); g.arc(cx + Math.sin(a) * r, cy - Math.cos(a) * r, 3.5, 0, 7); g.fill();
        }
        g.fillStyle = "#7FC8F8";
        g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.fill();
        if (heading == null) {
          g.fillStyle = "#A9B4CB"; g.font = "700 10px Rubik, system-ui, sans-serif"; g.textAlign = "center";
          g.fillText("N", cx, cy - R + 9);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [compass.ref]);

  function tap(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    // Nearest creatures were drawn last, so check them first.
    for (let i = hits.current.length - 1; i >= 0; i--) {
      const h = hits.current[i];
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) { onTap(h.d); return; }
    }
  }

  // Nearest creature, for the status line at the bottom.
  const nearest = useMemo(() => {
    let best: { d: Drop; dist: number } | null = null;
    for (const d of drops) {
      const dist = distanceM(at.lat, at.lng, d.lat, d.lng);
      if (dist <= sightM && (!best || dist < best.dist)) best = { d, dist };
    }
    return best;
  }, [drops, at.lat, at.lng, sightM]);

  const status = !compass.available
    ? "No compass reading yet. Wave your phone in a figure 8, or use the radar (north is up)."
    : nearest
      ? canCatch(nearest.d)
        ? `${SPECIES[nearest.d.species_id]?.name} is right here. Tap it to catch.`
        : `Nearest: ${SPECIES[nearest.d.species_id]?.name} (${RARITY[SPECIES[nearest.d.species_id]?.rar ?? "c"].label}), ${Math.round(nearest.dist)} m. Turn to find it and walk closer.`
      : "Nothing in sight. Keep walking.";

  return (
    <div className="hunt" role="dialog" aria-modal="true" aria-label="Hunt mode">
      <video ref={video} className="hunt-video" playsInline muted autoPlay />
      <canvas ref={canvas} className="hunt-canvas" onClick={tap} aria-label="Creatures around you. Tap one to catch it." />
      <div className="hunt-top">
        <span className="pill">📷 Hunt mode</span>
        <button className="btn ghost small" onClick={onClose}>Back to map</button>
      </div>
      <div className="hint hunt-status" aria-live="polite">{camNote || status}</div>
    </div>
  );
}
