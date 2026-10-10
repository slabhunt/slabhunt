// Original creature designs. Game rules (odds, entries) live in the database `species` table;
// this file is only names and art, and must keep the same ids.
export type Rarity = "c" | "u" | "r";
export type Species = { name: string; rar: Rarity; body: string; belly: string; feat: string };

export const SPECIES: Species[] = [
  { name: "Pebblit", rar: "c", body: "#8E9DB5", belly: "#C3CCDB", feat: "pebble" },
  { name: "Mossling", rar: "c", body: "#5DAE6B", belly: "#B7E2B5", feat: "leaf" },
  { name: "Driplet", rar: "c", body: "#4C9BE0", belly: "#A9D4F7", feat: "drop" },
  { name: "Emberkit", rar: "u", body: "#E9783E", belly: "#F8C79A", feat: "flame" },
  { name: "Voltmoth", rar: "u", body: "#E3C93A", belly: "#F7EBA6", feat: "wings" },
  { name: "Thornpup", rar: "u", body: "#9A6BC9", belly: "#D3BDEB", feat: "spikes" },
  { name: "Frostnib", rar: "r", body: "#BFE6F2", belly: "#F2FBFF", feat: "horn" },
  { name: "Lumenray", rar: "r", body: "#E35BA8", belly: "#F7C2E0", feat: "rings" },
];

export const RARITY: Record<Rarity, { label: string; entries: number }> = {
  c: { label: "Common", entries: 1 },
  u: { label: "Uncommon", entries: 2 },
  r: { label: "Rare", entries: 5 },
};

const SIL = "#2A3B5E";

export function drawCreature(ctx: CanvasRenderingContext2D, sp: number, x: number, y: number, r: number, t: number, silhouette = false) {
  const s = SPECIES[sp] ?? SPECIES[0];
  const bob = Math.sin(t / 300 + sp) * r * 0.06;
  const body = silhouette ? SIL : s.body;
  const belly = silhouette ? SIL : s.belly;
  ctx.save();
  ctx.translate(x, y + bob);

  if (s.feat === "wings") {
    ctx.fillStyle = silhouette ? SIL : "rgba(247,235,166,.85)";
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * r * 0.95, -r * 0.25, r * 0.65, r * 0.4, d * 0.6, 0, 7); ctx.fill(); }
  }
  if (s.feat === "rings" && !silhouette) {
    ctx.strokeStyle = "rgba(247,194,224,.8)"; ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.35, r * 0.45, (t / 1500) % 6.28, 0, 7); ctx.stroke();
  }

  ctx.fillStyle = body;
  ctx.beginPath();
  if (s.feat === "drop") {
    ctx.moveTo(0, -r * 1.25);
    ctx.bezierCurveTo(r * 1.1, -r * 0.2, r * 1.05, r, 0, r);
    ctx.bezierCurveTo(-r * 1.05, r, -r * 1.1, -r * 0.2, 0, -r * 1.25);
  } else ctx.ellipse(0, 0, r, r * 0.9, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(0, r * 0.35, r * 0.6, r * 0.45, 0, 0, 7); ctx.fill();

  if (s.feat === "pebble") {
    ctx.fillStyle = silhouette ? SIL : "#6F7E96";
    for (const [a, b, c] of [[-0.5, -0.55, 0.18], [0.35, -0.65, 0.14], [0.7, -0.1, 0.12]]) { ctx.beginPath(); ctx.arc(a * r, b * r, c * r, 0, 7); ctx.fill(); }
  }
  if (s.feat === "leaf") {
    ctx.fillStyle = silhouette ? SIL : "#2F7D45";
    ctx.beginPath(); ctx.ellipse(r * 0.2, -r * 1.05, r * 0.22, r * 0.45, 0.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-r * 0.15, -r * 1, r * 0.18, r * 0.35, -0.6, 0, 7); ctx.fill();
  }
  if (s.feat === "flame") {
    ctx.fillStyle = silhouette ? SIL : "#FFB23F";
    ctx.beginPath(); ctx.moveTo(-r * 0.35, -r * 0.75);
    ctx.quadraticCurveTo(-r * 0.1, -r * 1.7 - Math.sin(t / 120) * r * 0.1, r * 0.1, -r * 1.05);
    ctx.quadraticCurveTo(r * 0.3, -r * 1.45, r * 0.4, -r * 0.75); ctx.fill();
    ctx.fillStyle = body;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * 0.55, -r * 0.55); ctx.lineTo(d * r * 0.85, -r * 1.05); ctx.lineTo(d * r * 0.9, -r * 0.35); ctx.fill(); }
  }
  if (s.feat === "spikes") {
    ctx.fillStyle = silhouette ? SIL : "#6B3F9A";
    for (let i = -2; i <= 2; i++) {
      const a = -Math.PI / 2 + i * 0.45;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.18) * r * 0.85, Math.sin(a - 0.18) * r * 0.8);
      ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.3);
      ctx.lineTo(Math.cos(a + 0.18) * r * 0.85, Math.sin(a + 0.18) * r * 0.8);
      ctx.fill();
    }
  }
  if (s.feat === "horn") {
    ctx.fillStyle = silhouette ? SIL : "#7FC8F8";
    ctx.beginPath(); ctx.moveTo(-r * 0.18, -r * 0.8); ctx.lineTo(0, -r * 1.6); ctx.lineTo(r * 0.18, -r * 0.8); ctx.fill();
  }
  if (!silhouette) {
    for (const d of [-1, 1]) {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(d * r * 0.32, -r * 0.12, r * 0.19, r * 0.23, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#141B2A"; ctx.beginPath(); ctx.arc(d * r * 0.32 + r * 0.04, -r * 0.08, r * 0.1, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(d * r * 0.32 + r * 0.07, -r * 0.13, r * 0.035, 0, 7); ctx.fill();
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
