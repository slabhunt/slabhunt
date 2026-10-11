// Player characters for retro mode: original Slab Hunt pixel-art runners, each with a backpack and a gold graded slab
// sticking out. Drawn in code on a 20x26 grid, side view facing right, as a sprite sheet: frame 0 is standing,
// frames 1-4 are the run cycle. Display with image-rendering: pixelated.
// Ids are permanent (saved on profiles.avatar). 0-5 are free for everyone; later ids can be mint-only.

export const SPRITE_W = 20;
export const SPRITE_H = 26;
export const RUN_FRAMES = 4;

type Head = "messy" | "cap" | "beanie" | "spiky" | "ponytail" | "headphones";
export type Character = {
  id: number; name: string; blurb: string; head: Head;
  hair: string; hairHi: string; hat?: string; hatHi?: string;
  skin: string; skinSh: string;
  top: string; topSh: string; trim: string;
  legs: string; legsSh: string; shoe: string; shoeSh: string;
};

export const CHARACTERS: Character[] = [
  { id: 0, name: "Neon", blurb: "Night-shift hunter in a pink hoodie.", head: "messy",
    hair: "#3B2A55", hairHi: "#5C4385", skin: "#F2C29B", skinSh: "#C98F6E",
    top: "#FF3CAC", topSh: "#B8277C", trim: "#00E5FF", legs: "#3550A8", legsSh: "#22356E", shoe: "#EEE8DA", shoeSh: "#9FA8D0" },
  { id: 1, name: "Scout", blurb: "Never without a cap and a map.", head: "cap",
    hair: "#6B3A1E", hairHi: "#8E5430", hat: "#E8483A", hatHi: "#FF7A5C", skin: "#C68A5E", skinSh: "#9A6440",
    top: "#3FAE6A", topSh: "#2A7A4A", trim: "#FFD36B", legs: "#8C7A4E", legsSh: "#655634", shoe: "#4A3020", shoeSh: "#2E1D13" },
  { id: 2, name: "Drift", blurb: "Beanie on, headphones off, eyes up.", head: "beanie",
    hair: "#1E1A24", hairHi: "#3A3344", hat: "#FFD36B", hatHi: "#FFE7A3", skin: "#8D5A3B", skinSh: "#6A4029",
    top: "#3A7BD5", topSh: "#2856A0", trim: "#FFFFFF", legs: "#2A2F45", legsSh: "#1B1F30", shoe: "#FF3CAC", shoeSh: "#B8277C" },
  { id: 3, name: "Ember", blurb: "Fastest throw in the city.", head: "ponytail",
    hair: "#D9502E", hairHi: "#FF7A4A", skin: "#F5CFAE", skinSh: "#D4A586",
    top: "#2E2E3A", topSh: "#1C1C26", trim: "#FF8A3D", legs: "#5A3E8C", legsSh: "#3E2A63", shoe: "#EEE8DA", shoeSh: "#9FA8D0" },
  { id: 4, name: "Frost", blurb: "Hunts in any weather, music on.", head: "headphones",
    hair: "#E6ECF5", hairHi: "#FFFFFF", hat: "#00E5FF", hatHi: "#7CF5FF", skin: "#E8B48F", skinSh: "#C08A68",
    top: "#DDE6F2", topSh: "#A9B6CC", trim: "#4C9BE0", legs: "#3550A8", legsSh: "#22356E", shoe: "#2E2550", shoeSh: "#1A1030" },
  { id: 5, name: "Volt", blurb: "Spiky hair, short fuse, full slab binder.", head: "spiky",
    hair: "#1B1B2F", hairHi: "#3A3A5C", skin: "#A86B48", skinSh: "#7E4C31",
    top: "#F2C14E", topSh: "#C9962A", trim: "#1B1B2F", legs: "#2D2D2D", legsSh: "#1A1A1A", shoe: "#00E5FF", shoeSh: "#0090A8" },
];
export const characterById = (id: number | null | undefined) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

const OUTLINE = "#1A1030", EYE = "#1A1030", PACK = "#2E2550", PACK_HI = "#463A78", SLAB = "#DDE4F0", GOLD = "#FFD36B";

type Pt = [number, number];
// Per frame: [back foot, front foot, back hand, front hand].
const POSES: [Pt, Pt, Pt, Pt][] = [
  [[8, 25], [12, 25], [9, 15], [11, 15]],   // stand
  [[6, 24], [15, 24], [14, 13], [6, 14]],   // stride
  [[9, 25], [12, 22], [11, 15], [9, 15]],   // pass
  [[15, 24], [6, 24], [6, 14], [14, 13]],   // stride (other leg)
  [[12, 22], [9, 25], [9, 15], [11, 15]],   // pass
];

function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, w = 2) {
  ctx.fillStyle = color;
  let [x0, y0] = a; const [x1, y1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0 - (w >> 1), y0, w, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function limb(ctx: CanvasRenderingContext2D, from: Pt, to: Pt, color: string, bendForward: boolean) {
  const mid: Pt = [Math.round((from[0] + to[0]) / 2) + (bendForward ? 2 : -1), Math.round((from[1] + to[1]) / 2)];
  line(ctx, from, mid, color);
  line(ctx, mid, to, color);
}

function drawFrame(ctx: CanvasRenderingContext2D, ox: number, f: number, c: Character) {
  const [backFoot, frontFoot, backHand, frontHand] = POSES[f];
  const px = (x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(ox + x, y, w, h); };
  const P = (p: Pt): Pt => [ox + p[0], p[1]];
  const b = f === 2 || f === 4 ? -1 : 0; // body lifts on the passing frames

  // back leg and arm (shaded)
  limb(ctx, P([9, 17 + b]), P(backFoot), c.legsSh, true);
  px(backFoot[0] - 1, backFoot[1], 3, 1, c.shoeSh);
  limb(ctx, P([9, 12 + b]), P(backHand), c.topSh, false);

  // ponytail sits behind the backpack
  if (c.head === "ponytail") { px(4, 4 + b, 3, 2, c.hair); px(3, 6 + b, 3, 4, c.hair); px(3, 6 + b, 1, 3, c.hairHi); }

  // backpack with a slab sticking out
  px(4, 10 + b, 4, 7, OUTLINE);
  px(5, 11 + b, 3, 5, PACK); px(5, 11 + b, 1, 5, PACK_HI);
  px(5, 7 + b, 2, 4, OUTLINE); px(5, 7 + b, 2, 1, GOLD); px(5, 8 + b, 2, 2, SLAB);

  // torso
  px(7, 10 + b, 7, 8, OUTLINE);
  px(8, 10 + b, 5, 7, c.top); px(8, 15 + b, 5, 2, c.topSh);
  px(8, 16 + b, 5, 1, c.trim); px(12, 11 + b, 1, 4, c.trim);

  // head
  px(7, 2 + b, 8, 9, OUTLINE);
  px(8, 3 + b, 6, 7, c.skin);
  px(8, 9 + b, 6, 1, c.skinSh);
  px(12, 6 + b, 1, 2, EYE);
  px(14, 7 + b, 1, 1, c.skin); // nose
  px(12, 9 + b, 2, 1, c.skinSh); // mouth line

  // hair and headwear
  switch (c.head) {
    case "messy":
      px(7, 2 + b, 8, 3, c.hair); px(7, 5 + b, 3, 3, c.hair); px(8, 2 + b, 4, 1, c.hairHi); px(14, 4 + b, 1, 2, c.hair);
      px(6, 3 + b, 2, 3, c.top); px(6, 6 + b, 1, 4, c.top); // hood behind the head
      break;
    case "cap":
      px(7, 4 + b, 3, 4, c.hair); px(7, 4 + b, 1, 2, c.hairHi);
      px(7, 1 + b, 8, 3, c.hat!); px(8, 1 + b, 4, 1, c.hatHi!); px(13, 3 + b, 4, 1, c.hat!); px(10, 2 + b, 1, 1, "#FFFFFF");
      break;
    case "beanie":
      px(7, 5 + b, 2, 3, c.hair); px(14, 5 + b, 1, 1, c.hair);
      px(7, 0 + b, 8, 4, c.hat!); px(8, 0 + b, 3, 1, c.hatHi!); px(7, 4 + b, 8, 1, c.hatHi!);
      break;
    case "spiky":
      px(7, 2 + b, 8, 3, c.hair); px(7, 5 + b, 2, 3, c.hair);
      px(8, 0 + b, 1, 2, c.hair); px(10, 0, 1, 2 + b, c.hair); px(12, 0 + b, 1, 2, c.hair); px(14, 1 + b, 1, 2, c.hair);
      px(9, 2 + b, 3, 1, c.hairHi);
      break;
    case "ponytail":
      px(7, 2 + b, 8, 3, c.hair); px(7, 5 + b, 2, 2, c.hair); px(9, 2 + b, 4, 1, c.hairHi); px(14, 4 + b, 1, 1, c.hair);
      px(6, 4 + b, 1, 2, c.trim); // hair tie
      break;
    case "headphones":
      px(7, 2 + b, 8, 3, c.hair); px(7, 5 + b, 2, 3, c.hair); px(8, 2 + b, 3, 1, c.hairHi);
      px(7, 1 + b, 8, 1, c.hat!); px(9, 5 + b, 3, 4, c.hat!); px(10, 5 + b, 1, 4, c.hatHi!);
      break;
  }

  // front leg and arm
  limb(ctx, P([11, 17 + b]), P(frontFoot), c.legs, true);
  px(frontFoot[0] - 1, frontFoot[1], 3, 1, c.shoe);
  px(frontFoot[0] + 1, frontFoot[1] - 1, 1, 1, c.shoe);
  limb(ctx, P([11, 12 + b]), P(frontHand), c.top, false);
  px(frontHand[0], frontHand[1], 1, 1, c.skin);
}

const cache = new Map<number, string>();
/** Sprite sheet (5 frames side by side) as a PNG data URL. Frame 0 = standing, 1-4 = running. */
export function hunterSheet(id = 0): string {
  const c = characterById(id);
  const hit = cache.get(c.id);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W * (RUN_FRAMES + 1); cv.height = SPRITE_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  for (let f = 0; f <= RUN_FRAMES; f++) drawFrame(ctx, f * SPRITE_W, f, c);
  const url = cv.toDataURL("image/png");
  cache.set(c.id, url);
  return url;
}

/** Marker markup: the runner plus a ground shadow and rain splashes at its feet. */
export function hunterHtml(id = 0, scale = 3) {
  return `<div class="hunter" style="--hs:${scale}"><i class="hunter-shadow"></i><i class="hunter-splash"></i><i class="hunter-splash b"></i><span class="hunter-sprite" style="background-image:url(${hunterSheet(id)})"></span></div>`;
}

/** The same as a DOM element (for MapLibre markers). */
export function hunterElement(id = 0, scale = 3): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = hunterHtml(id, scale);
  return wrap.firstElementChild as HTMLDivElement;
}
