// Original creature designs. Game rules (odds, entries) live in the database `species` table;
// this file is only names and art, and must keep the same ids.
import { SEASON_ROSTER } from "./roster";

export type Rarity = "c" | "u" | "r" | "l";
export type Species = { name: string; rar: Rarity; body: string; belly: string; feat: string; shape?: string; season: number | null };

function mix(hex: string, to: string, amt: number) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - amt) + ((b >> sh) & 255) * amt);
  return "#" + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0");
}

const BASE: Species[] = [
  { name: "Pebblit", rar: "c", body: "#8E9DB5", belly: "#C3CCDB", feat: "pebble", season: null },
  { name: "Mossling", rar: "c", body: "#5DAE6B", belly: "#B7E2B5", feat: "leaf", season: null },
  { name: "Driplet", rar: "c", body: "#4C9BE0", belly: "#A9D4F7", feat: "drop", season: null },
  { name: "Emberkit", rar: "u", body: "#E9783E", belly: "#F8C79A", feat: "flame", season: null },
  { name: "Voltmoth", rar: "u", body: "#E3C93A", belly: "#F7EBA6", feat: "wings", season: null },
  { name: "Thornpup", rar: "u", body: "#9A6BC9", belly: "#D3BDEB", feat: "spikes", season: null },
  { name: "Frostnib", rar: "r", body: "#BFE6F2", belly: "#F2FBFF", feat: "horn", season: null },
  { name: "Lumenray", rar: "r", body: "#E35BA8", belly: "#F7C2E0", feat: "rings", season: null },
  // Season 1: Lantern Run
  { name: "Tidepup", rar: "c", body: "#3FB8AF", belly: "#B8EDE8", feat: "fin", season: 1 },
  { name: "Lanternfox", rar: "u", body: "#D9822B", belly: "#FBE3C4", feat: "lantern", season: 1 },
  { name: "Glimmerwing", rar: "u", body: "#8FA8F0", belly: "#E1E8FF", feat: "crystal", season: 1 },
  { name: "Vaultdrake", rar: "r", body: "#2E6E5E", belly: "#E8B33A", feat: "drake", season: 1 },
];

/** All 151 creatures, in id order. */
export const SPECIES: Species[] = [
  ...BASE,
  ...Object.entries(SEASON_ROSTER).flatMap(([season, rows]) =>
    rows.map(([name, rar, body, feat, shape]) => ({
      name, rar, body, feat, shape, season: Number(season),
      belly: mix(body, "#FFFFFF", body.match(/^#[0-3]/) ? 0.45 : 0.6),
    }))),
];

/** Creatures unlocked by a given season number (core creatures plus every season up to it). */
export const unlockedBy = (season: number) => SPECIES.flatMap((s, i) => (s.season == null || s.season <= season ? [i] : []));

export const RARITY: Record<Rarity, { label: string; entries: number }> = {
  c: { label: "Common", entries: 1 },
  u: { label: "Uncommon", entries: 2 },
  r: { label: "Rare", entries: 5 },
  l: { label: "Legendary", entries: 10 },
};

const SIL = "#2A3B5E";

function bodyPath(ctx: CanvasRenderingContext2D, shape: string | undefined, feat: string, r: number, t: number) {
  ctx.beginPath();
  if (feat === "drop" || shape === "drop") {
    ctx.moveTo(0, -r * 1.25);
    ctx.bezierCurveTo(r * 1.1, -r * 0.2, r * 1.05, r, 0, r);
    ctx.bezierCurveTo(-r * 1.05, r, -r * 1.1, -r * 0.2, 0, -r * 1.25);
  } else if (shape === "tall") ctx.ellipse(0, -r * 0.08, r * 0.82, r * 1.05, 0, 0, 7);
  else if (shape === "wide") ctx.ellipse(0, r * 0.08, r * 1.18, r * 0.78, 0, 0, 7);
  else if (shape === "blob") {
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2, w = 1 + 0.07 * Math.sin(a * 5 + t / 400);
      const px = Math.cos(a) * r * w, py = Math.sin(a) * r * 0.9 * w;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else ctx.ellipse(0, 0, r, r * 0.9, 0, 0, 7);
}

/** Top of the head for a given body shape (features sit on it). */
const topOf = (shape: string | undefined, r: number) => (shape === "tall" ? -r * 1.1 : shape === "wide" ? -r * 0.68 : shape === "drop" ? -r * 1.1 : -r * 0.88);

export function drawCreature(ctx: CanvasRenderingContext2D, sp: number, x: number, y: number, r: number, t: number, silhouette = false) {
  const s = SPECIES[sp] ?? SPECIES[0];
  const bob = Math.sin(t / 300 + sp) * r * 0.06;
  const body = silhouette ? SIL : s.body;
  const belly = silhouette ? SIL : s.belly;
  const dark = silhouette ? SIL : mix(s.body, "#000000", 0.35);
  const light = silhouette ? SIL : mix(s.body, "#FFFFFF", 0.5);
  const top = topOf(s.shape, r);
  const f = s.feat;
  ctx.save();
  ctx.translate(x, y + bob);

  // Legendary aura
  if (s.rar === "l" && !silhouette) {
    const pulse = 1 + 0.08 * Math.sin(t / 350);
    const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.9 * pulse);
    g.addColorStop(0, "rgba(255,226,140,.55)"); g.addColorStop(1, "rgba(255,226,140,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.9 * pulse, 0, 7); ctx.fill();
  }

  /* ---- behind the body ---- */
  if (f === "wings") {
    ctx.fillStyle = silhouette ? SIL : s.season == null ? "rgba(247,235,166,.85)" : mix(s.body, "#FFFFFF", 0.65) + "D9";
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * r * 0.95, -r * 0.25, r * 0.65, r * 0.4, d * 0.6, 0, 7); ctx.fill(); }
  }
  if (f === "batwings") {
    ctx.fillStyle = dark;
    for (const d of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(d * r * 0.5, -r * 0.4);
      ctx.lineTo(d * r * 1.7, -r * 0.9); ctx.lineTo(d * r * 1.45, -r * 0.35); ctx.lineTo(d * r * 1.75, -r * 0.05);
      ctx.lineTo(d * r * 1.3, r * 0.05); ctx.lineTo(d * r * 1.4, r * 0.35); ctx.lineTo(d * r * 0.6, r * 0.15); ctx.closePath(); ctx.fill();
    }
  }
  if (f === "rings" && !silhouette) {
    ctx.strokeStyle = s.season == null ? "rgba(247,194,224,.8)" : light + "CC"; ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.35, r * 0.45, (t / 1500) % 6.28, 0, 7); ctx.stroke();
  }
  if (f === "crystal") {
    ctx.fillStyle = silhouette ? SIL : s.season == null || s.season === 1 ? "rgba(200,220,255,.85)" : light + "D9";
    for (const d of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(d * r * 0.5, -r * 0.3); ctx.lineTo(d * r * 1.55, -r * 0.95); ctx.lineTo(d * r * 1.2, r * 0.1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(d * r * 0.6, 0); ctx.lineTo(d * r * 1.35, r * 0.35); ctx.lineTo(d * r * 0.85, r * 0.45); ctx.closePath(); ctx.fill();
    }
  }
  if (f === "drake") {
    ctx.fillStyle = silhouette ? SIL : sp === 11 ? "#1F4D41" : dark;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.4, -r * 0.2); ctx.quadraticCurveTo(d * r * 1.9, -r * 1.3, d * r * 1.5, r * 0.2); ctx.quadraticCurveTo(d * r * 1.0, -r * 0.1, d * r * 0.5, r * 0.2); ctx.fill(); }
  }
  if (f === "mane") {
    ctx.fillStyle = dark;
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.9, r * 0.3, 0, 7); ctx.fill(); }
  }
  if (f === "tail") {
    ctx.strokeStyle = dark; ctx.lineWidth = r * 0.18; ctx.lineCap = "round";
    const w = Math.sin(t / 260) * r * 0.15;
    ctx.beginPath(); ctx.moveTo(r * 0.7, r * 0.4); ctx.quadraticCurveTo(r * 1.6, r * 0.5 + w, r * 1.45, -r * 0.35 + w); ctx.stroke();
    ctx.fillStyle = light; ctx.beginPath(); ctx.arc(r * 1.45, -r * 0.4 + w, r * 0.16, 0, 7); ctx.fill();
  }
  if (f === "shell") {
    ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, -r * 0.15, r * 1.12, r * 0.95, 0, Math.PI, 0); ctx.fill();
    if (!silhouette) { ctx.strokeStyle = light; ctx.lineWidth = r * 0.06; for (const d of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(d * r * 1.5, -r * 0.15); ctx.lineTo(d * r * 0.6, -r * 1.0); ctx.stroke(); } }
  }
  if (f === "cloud") {
    ctx.fillStyle = silhouette ? SIL : "rgba(255,255,255,.85)";
    for (const [cx, cy, cr] of [[-1.0, 0.55, 0.38], [-0.45, 0.8, 0.42], [0.2, 0.85, 0.4], [0.8, 0.65, 0.4]]) { ctx.beginPath(); ctx.arc(cx * r, cy * r, cr * r, 0, 7); ctx.fill(); }
  }
  if (f === "sail") {
    ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-r * 0.5, top + r * 0.3); ctx.quadraticCurveTo(0, top - r * 1.1, r * 0.55, top + r * 0.3); ctx.fill();
    if (!silhouette) { ctx.strokeStyle = light; ctx.lineWidth = r * 0.05; for (const d of [-0.25, 0, 0.25]) { ctx.beginPath(); ctx.moveTo(d * r, top + r * 0.3); ctx.lineTo(d * r * 1.2, top - r * 0.45); ctx.stroke(); } }
  }
  if (f === "petals") {
    ctx.fillStyle = silhouette ? SIL : mix(s.body, "#FFFFFF", 0.3);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + t / 3000; ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, -r * 1.05, r * 0.3, r * 0.5, 0, 0, 7); ctx.fill(); ctx.restore(); }
  }

  /* ---- body ---- */
  ctx.fillStyle = body;
  bodyPath(ctx, s.shape, f, r, t);
  ctx.fill();
  ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(0, r * 0.35, r * 0.6, r * 0.45, 0, 0, 7); ctx.fill();

  /* ---- in front ---- */
  if (f === "pebble") {
    ctx.fillStyle = silhouette ? SIL : sp === 0 ? "#6F7E96" : dark;
    for (const [a, b, c] of [[-0.5, -0.55, 0.18], [0.35, -0.65, 0.14], [0.7, -0.1, 0.12]]) { ctx.beginPath(); ctx.arc(a * r, b * r, c * r, 0, 7); ctx.fill(); }
  }
  if (f === "leaf") {
    ctx.fillStyle = silhouette ? SIL : sp === 1 ? "#2F7D45" : dark;
    const ty = top;
    ctx.beginPath(); ctx.ellipse(r * 0.2, ty - r * 0.17, r * 0.22, r * 0.45, 0.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-r * 0.15, ty - r * 0.12, r * 0.18, r * 0.35, -0.6, 0, 7); ctx.fill();
  }
  if (f === "flame") {
    ctx.fillStyle = silhouette ? SIL : "#FFB23F";
    ctx.beginPath(); ctx.moveTo(-r * 0.35, -r * 0.75);
    ctx.quadraticCurveTo(-r * 0.1, -r * 1.7 - Math.sin(t / 120) * r * 0.1, r * 0.1, -r * 1.05);
    ctx.quadraticCurveTo(r * 0.3, -r * 1.45, r * 0.4, -r * 0.75); ctx.fill();
    ctx.fillStyle = body;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.55, -r * 0.55); ctx.lineTo(d * r * 0.85, -r * 1.05); ctx.lineTo(d * r * 0.9, -r * 0.35); ctx.fill(); }
  }
  if (f === "spikes") {
    ctx.fillStyle = silhouette ? SIL : sp === 5 ? "#6B3F9A" : dark;
    const k = s.shape === "tall" ? 1.15 : 1;
    for (let i = -2; i <= 2; i++) {
      const a = -Math.PI / 2 + i * 0.45;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.18) * r * 0.85, Math.sin(a - 0.18) * r * 0.8 * k);
      ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.3 * k);
      ctx.lineTo(Math.cos(a + 0.18) * r * 0.85, Math.sin(a + 0.18) * r * 0.8 * k);
      ctx.fill();
    }
  }
  if (f === "horn") {
    ctx.fillStyle = silhouette ? SIL : sp === 6 ? "#7FC8F8" : light;
    const hy = sp === 6 ? -r * 0.8 : top + r * 0.08;
    ctx.beginPath(); ctx.moveTo(-r * 0.18, hy); ctx.lineTo(0, hy - r * 0.8); ctx.lineTo(r * 0.18, hy); ctx.fill();
  }
  if (f === "fin") {
    ctx.fillStyle = silhouette ? SIL : sp === 8 ? "#22897F" : dark;
    ctx.beginPath(); ctx.moveTo(-r * 0.25, top + r * 0.06); ctx.quadraticCurveTo(r * 0.1, top - r * 0.67, r * 0.35, top + r * 0.08); ctx.fill();
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * r * 0.95, r * 0.35, r * 0.32, r * 0.14, d * 0.7, 0, 7); ctx.fill(); }
  }
  if (f === "lantern") {
    ctx.fillStyle = body;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.25, top + r * 0.18); ctx.lineTo(d * r * 0.75, top - r * 0.47); ctx.lineTo(d * r * 0.85, top + r * 0.43); ctx.fill(); }
    if (!silhouette) {
      const glow = 0.6 + 0.4 * Math.sin(t / 250);
      ctx.fillStyle = `rgba(255,214,102,${glow})`;
      ctx.beginPath(); ctx.arc(0, top - r * 0.37, r * 0.22, 0, 7); ctx.fill();
      ctx.strokeStyle = "#7A4A12"; ctx.lineWidth = r * 0.05; ctx.beginPath(); ctx.moveTo(0, top + r * 0.03); ctx.lineTo(0, top - r * 0.17); ctx.stroke();
    }
  }
  if (f === "drake") {
    ctx.fillStyle = silhouette ? SIL : sp === 11 ? "#E8B33A" : light;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.2, top + r * 0.13); ctx.lineTo(d * r * 0.5, top - r * 0.52); ctx.lineTo(d * r * 0.55, top + r * 0.18); ctx.fill(); }
  }
  if (f === "ears") {
    ctx.fillStyle = body;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.2, top + r * 0.25); ctx.lineTo(d * r * 0.65, top - r * 0.5); ctx.lineTo(d * r * 0.85, top + r * 0.45); ctx.fill(); }
    if (!silhouette) { ctx.fillStyle = mix(s.body, "#FF9EB5", 0.5); for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.35, top + r * 0.25); ctx.lineTo(d * r * 0.63, top - r * 0.25); ctx.lineTo(d * r * 0.72, top + r * 0.35); ctx.fill(); } }
  }
  if (f === "antenna") {
    ctx.strokeStyle = dark; ctx.lineWidth = r * 0.06;
    for (const d of [-1, 1]) {
      const sw = Math.sin(t / 300 + d) * r * 0.08;
      ctx.beginPath(); ctx.moveTo(d * r * 0.2, top + r * 0.1); ctx.quadraticCurveTo(d * r * 0.3, top - r * 0.4, d * r * 0.5 + sw, top - r * 0.6); ctx.stroke();
      ctx.fillStyle = silhouette ? SIL : "#FFE27A"; ctx.beginPath(); ctx.arc(d * r * 0.5 + sw, top - r * 0.62, r * 0.12, 0, 7); ctx.fill();
    }
  }
  if (f === "crown") {
    ctx.fillStyle = silhouette ? SIL : "#F2C14E";
    ctx.beginPath(); ctx.moveTo(-r * 0.45, top + r * 0.15); ctx.lineTo(-r * 0.5, top - r * 0.35); ctx.lineTo(-r * 0.22, top - r * 0.1);
    ctx.lineTo(0, top - r * 0.5); ctx.lineTo(r * 0.22, top - r * 0.1); ctx.lineTo(r * 0.5, top - r * 0.35); ctx.lineTo(r * 0.45, top + r * 0.15); ctx.closePath(); ctx.fill();
    if (!silhouette) { ctx.fillStyle = "#E35BA8"; ctx.beginPath(); ctx.arc(0, top - r * 0.08, r * 0.08, 0, 7); ctx.fill(); }
  }
  if (f === "bubbles" && !silhouette) {
    ctx.strokeStyle = "rgba(220,240,255,.9)"; ctx.lineWidth = r * 0.04;
    for (const [bx, by, br, sp2] of [[0.7, -1.0, 0.16, 0], [0.95, -1.4, 0.11, 1], [0.5, -1.55, 0.08, 2]]) {
      const yy = by * r - ((t / 20 + sp2 * 30) % (r * 0.4));
      ctx.beginPath(); ctx.arc(bx * r, yy, br * r, 0, 7); ctx.stroke();
    }
  }
  if (f === "gear") {
    ctx.fillStyle = dark; ctx.save(); ctx.translate(0, top - r * 0.15); ctx.rotate(t / 900);
    for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillRect(-r * 0.07, -r * 0.42, r * 0.14, r * 0.2); }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, 7); ctx.fill(); ctx.restore();
  }
  if (f === "mask") { ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, -r * 0.12, r * 0.72, r * 0.27, 0, 0, 7); ctx.fill(); }
  if (f === "star") {
    ctx.fillStyle = silhouette ? SIL : "#FFE27A"; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.12 : r * 0.28; ctx.lineTo(Math.cos(a) * rr, top - r * 0.2 + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  if (f === "tusks") {
    ctx.fillStyle = silhouette ? SIL : "#FFF8E7";
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.18, r * 0.2); ctx.quadraticCurveTo(d * r * 0.3, r * 0.65, d * r * 0.5, r * 0.55); ctx.lineTo(d * r * 0.32, r * 0.22); ctx.fill(); }
  }
  if (f === "moon") {
    ctx.fillStyle = silhouette ? SIL : "#FFE9A8"; ctx.beginPath(); ctx.arc(0, top - r * 0.25, r * 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(r * 0.13, top - r * 0.32, r * 0.25, 0, 7); ctx.fill();
  }
  if (f === "steam" && !silhouette) {
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = r * 0.07; ctx.lineCap = "round";
    for (const d of [-0.35, 0, 0.35]) {
      const o = Math.sin(t / 250 + d * 5) * r * 0.08;
      ctx.beginPath(); ctx.moveTo(d * r, top - r * 0.1); ctx.quadraticCurveTo(d * r + r * 0.15 + o, top - r * 0.4, d * r + o, top - r * 0.7); ctx.stroke();
    }
  }
  if (f === "coil") {
    ctx.strokeStyle = silhouette ? SIL : "#FFE27A"; ctx.lineWidth = r * 0.08; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(0, top + r * 0.05); ctx.lineTo(-r * 0.18, top - r * 0.25); ctx.lineTo(r * 0.12, top - r * 0.35); ctx.lineTo(-r * 0.08, top - r * 0.7); ctx.stroke();
  }

  if (!silhouette) {
    for (const d of [-1, 1]) {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(d * r * 0.32, -r * 0.12, r * 0.19, r * 0.23, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#141B2A"; ctx.beginPath(); ctx.arc(d * r * 0.32 + r * 0.04, -r * 0.08, r * 0.1, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(d * r * 0.32 + r * 0.07, -r * 0.13, r * 0.035, 0, 7); ctx.fill();
    }
    if (f === "whiskers") {
      ctx.strokeStyle = dark; ctx.lineWidth = r * 0.03;
      for (const d of [-1, 1]) for (const k of [-0.08, 0.06]) { ctx.beginPath(); ctx.moveTo(d * r * 0.3, r * 0.15 + k * r); ctx.lineTo(d * r * 0.95, r * 0.08 + k * r * 2); ctx.stroke(); }
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, r * 0.12, r * 0.07, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

const cache = new Map<string, string>();
/** A PNG data URL of a creature, for map markers and lists. */
export function creatureImage(sp: number, size = 64, silhouette = false): string {
  const key = `${sp}:${size}:${silhouette}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size * 2;
  const ctx = c.getContext("2d")!;
  drawCreature(ctx, sp, size, size * 1.1, size * 0.55, 0, silhouette);
  const url = c.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
