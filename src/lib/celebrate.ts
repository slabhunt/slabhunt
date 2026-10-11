// Fireworks + confetti on a transparent canvas, for the Season Pass pack reveal. No dependencies.
// celebrate(canvas, { colors }) starts the show and returns a stop function. The canvas should overlay the scene with
// pointer-events: none; it is resized to its CSS box (times devicePixelRatio) on start.

type Confetti = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; tilt: number; vt: number; color: string };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Rocket = { x: number; y: number; vx: number; vy: number; burstY: number; color: string; at: number; done: boolean };

export type CelebrateOptions = {
  colors?: string[];   // main colors (the tier color first)
  rockets?: number;    // how many fireworks
  confetti?: number;   // how many confetti pieces
  duration?: number;   // ms until new things stop launching
  origin?: { x: number; y: number }; // confetti burst point, 0..1 of the canvas
};

export function celebrate(canvas: HTMLCanvasElement, opts: CelebrateOptions = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = opts.colors?.length ? opts.colors : ["#F2C14E"];
  const palette = [...colors, "#F2C14E", "#FFFFFF", "#EEE8DA", "#4C9BE0", "#E9783E", "#5DC28A"];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  const unit = Math.min(W, H) / 500; // scale speeds and sizes to the canvas
  const origin = opts.origin ?? { x: 0.5, y: 0.42 };
  const duration = opts.duration ?? 2600;

  const confetti: Confetti[] = [];
  const sparks: Spark[] = [];
  const rockets: Rocket[] = [];

  // dir: launch angle (radians, -PI/2 is straight up); spread: fraction of a half circle
  function burstConfetti(n: number, ox: number, oy: number, dir = -Math.PI / 2, spread = 1.3, speed = 1) {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * Math.PI * spread;
      const sp = (4 + Math.random() * 9) * unit * speed;
      confetti.push({
        x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        w: (6 + Math.random() * 6) * unit, h: (9 + Math.random() * 8) * unit,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, tilt: Math.random() * Math.PI, vt: 0.08 + Math.random() * 0.12,
        color: pick(palette),
      });
    }
  }
  function burstFirework(x: number, y: number, color: string) {
    const n = 70 + Math.floor(Math.random() * 30);
    const ring = Math.random() < 0.35;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const sp = (ring ? 4.4 : 1.2 + Math.random() * 4.2) * unit;
      const max = 65 + Math.random() * 35;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: max, max, color: Math.random() < 0.2 ? "#FFFFFF" : color, size: (1.6 + Math.random() * 1.4) * unit });
    }
  }

  const n = opts.rockets ?? 7;
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const x = W * (0.5 + side * (0.18 + Math.random() * 0.28));
    rockets.push({
      x, y: H + 10, vx: (Math.random() - 0.5) * 0.6 * unit, vy: -(7.5 + Math.random() * 2.5) * unit,
      burstY: H * (0.12 + Math.random() * 0.3), color: i === 0 ? colors[0] : pick([colors[0], ...palette.slice(0, 4)]),
      at: start + (i / n) * duration * 0.85 + Math.random() * 150, done: false,
    });
  }
  // a pop from the pack plus two cannons from the bottom corners
  const total = opts.confetti ?? 140;
  burstConfetti(Math.round(total * 0.3), W * origin.x, H * origin.y, -Math.PI / 2, 2, 1.25);
  burstConfetti(Math.round(total * 0.35), 0, H, -Math.PI / 3, 0.35, 1.5);
  burstConfetti(Math.round(total * 0.35), W, H, (-2 * Math.PI) / 3, 0.35, 1.5);
  let rainUntil = start + duration;

  let raf = 0, last = start;
  function frame(now: number) {
    const dt = Math.min(2.5, (now - last) / 16.67); last = now;
    ctx!.clearRect(0, 0, W, H);

    // a light confetti rain from the top while the show runs
    if (now < rainUntil && Math.random() < 0.5 * dt) {
      confetti.push({ x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * unit, vy: (1 + Math.random() * 2) * unit, w: (6 + Math.random() * 5) * unit, h: (9 + Math.random() * 7) * unit, rot: Math.random() * 3, vr: (Math.random() - 0.5) * 0.25, tilt: Math.random() * 3, vt: 0.1, color: pick(palette) });
    }

    ctx!.globalCompositeOperation = "lighter";
    for (const r of rockets) {
      if (r.done || now < r.at) continue;
      r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 0.09 * unit * dt;
      ctx!.fillStyle = "rgba(255,230,160,.9)";
      ctx!.beginPath(); ctx!.arc(r.x, r.y, 2.2 * unit, 0, Math.PI * 2); ctx!.fill();
      ctx!.fillStyle = "rgba(255,200,90,.35)";
      ctx!.beginPath(); ctx!.arc(r.x - r.vx * 2, r.y - r.vy * 2, 1.6 * unit, 0, Math.PI * 2); ctx!.fill();
      if (r.y <= r.burstY || r.vy >= 0) { r.done = true; burstFirework(r.x, r.y, r.color); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.985; s.vy = s.vy * 0.985 + 0.035 * unit * dt; s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      const k = s.life / s.max;
      ctx!.globalAlpha = Math.min(1, k * 1.6);
      ctx!.fillStyle = s.color;
      ctx!.beginPath(); ctx!.arc(s.x, s.y, s.size * (0.5 + k * 0.5), 0, Math.PI * 2); ctx!.fill();
      ctx!.globalAlpha = Math.min(1, k * 1.6) * 0.35;
      ctx!.beginPath(); ctx!.arc(s.x - s.vx * 2.5, s.y - s.vy * 2.5, s.size * 0.6, 0, Math.PI * 2); ctx!.fill();
    }
    ctx!.globalAlpha = 1;
    ctx!.globalCompositeOperation = "source-over";
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.vx *= 0.98; c.vy = c.vy * 0.98 + 0.16 * unit * dt; c.x += (c.vx + Math.sin(c.tilt) * 0.6 * unit) * dt; c.y += c.vy * dt;
      c.rot += c.vr * dt; c.tilt += c.vt * dt;
      if (c.y > H + 20) { confetti.splice(i, 1); continue; }
      ctx!.save(); ctx!.translate(c.x, c.y); ctx!.rotate(c.rot); ctx!.scale(1, Math.cos(c.tilt));
      ctx!.fillStyle = c.color; ctx!.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx!.restore();
    }

    const busy = sparks.length || confetti.length || rockets.some((r) => !r.done) || now < rainUntil;
    if (busy) raf = requestAnimationFrame(frame); else ctx!.clearRect(0, 0, W, H);
  }
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); rainUntil = 0; ctx.clearRect(0, 0, W, H); };
}
