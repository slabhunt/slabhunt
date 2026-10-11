// The player's pixel-art runner for retro mode: an original Slab Hunt character (neon-pink hoodie, cyan trim, a
// backpack with a gold graded slab sticking out). Drawn in code on a 20x26 grid, side view facing right, as a sprite
// sheet: frame 0 is standing, frames 1-4 are the run cycle. Display it with image-rendering: pixelated.

export const SPRITE_W = 20;
export const SPRITE_H = 26;
export const RUN_FRAMES = 4;

const C = {
  outline: "#1A1030",
  hair: "#3B2A55", hairHi: "#5C4385",
  skin: "#F2C29B", skinSh: "#C98F6E",
  hoodie: "#FF3CAC", hoodieSh: "#B8277C", trim: "#00E5FF",
  jeans: "#3550A8", jeansSh: "#22356E",
  shoe: "#EEE8DA", shoeSh: "#9FA8D0",
  pack: "#2E2550", packHi: "#463A78",
  slab: "#DDE4F0", gold: "#FFD36B",
  eye: "#1A1030",
};

type Pt = [number, number];
// Per frame: [back foot, front foot, back hand, front hand]. Hip at (10,16), shoulder at (10,10).
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
  // Knee/elbow pushed forward (to the right) so legs bend like a runner's.
  const mid: Pt = [Math.round((from[0] + to[0]) / 2) + (bendForward ? 2 : -1), Math.round((from[1] + to[1]) / 2)];
  line(ctx, from, mid, color);
  line(ctx, mid, to, color);
}

function drawFrame(ctx: CanvasRenderingContext2D, ox: number, f: number) {
  const [backFoot, frontFoot, backHand, frontHand] = POSES[f];
  const px = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(ox + x, y, w, h); };
  const P = (p: Pt): Pt => [ox + p[0], p[1]];
  const hip: Pt = [10, 17], shoulder: Pt = [10, 11];
  const bob = f === 2 || f === 4 ? -1 : 0; // body lifts on the passing frames

  // back leg and arm (shaded)
  limb(ctx, P([9, 17 + bob]), P(backFoot), C.jeansSh, true);
  px(backFoot[0] - 1, backFoot[1], 3, 1, C.shoeSh);
  limb(ctx, P([9, shoulder[1] + 1 + bob]), P(backHand), C.hoodieSh, false);

  // backpack with a slab sticking out
  px(4, 10 + bob, 4, 7, C.outline);
  px(5, 11 + bob, 3, 5, C.pack); px(5, 11 + bob, 1, 5, C.packHi);
  px(5, 7 + bob, 2, 4, C.outline); px(5, 7 + bob, 2, 1, C.gold); px(5, 8 + bob, 2, 2, C.slab);

  // torso (hoodie)
  px(7, 10 + bob, 7, 8, C.outline);
  px(8, 10 + bob, 5, 7, C.hoodie); px(8, 15 + bob, 5, 2, C.hoodieSh);
  px(8, 16 + bob, 5, 1, C.trim); px(12, 11 + bob, 1, 4, C.trim);

  // head
  px(7, 2 + bob, 8, 9, C.outline);
  px(8, 3 + bob, 6, 7, C.skin);
  px(8, 9 + bob, 6, 1, C.skinSh);
  px(7, 2 + bob, 8, 3, C.hair); px(7, 5 + bob, 3, 3, C.hair); px(8, 2 + bob, 4, 1, C.hairHi);
  px(14, 4 + bob, 1, 2, C.hair); // fringe tip
  px(12, 6 + bob, 1, 2, C.eye);
  px(14, 7 + bob, 1, 1, C.skin); // nose
  px(12, 9 + bob, 2, 1, C.skinSh); // mouth line
  px(6, 3 + bob, 2, 3, C.hoodie); px(6, 6 + bob, 1, 4, C.hoodie); // hood behind the head

  // front leg and arm
  limb(ctx, P([11, hip[1] + bob]), P(frontFoot), C.jeans, true);
  px(frontFoot[0] - 1, frontFoot[1], 3, 1, C.shoe);
  px(frontFoot[0] + 1, frontFoot[1] - 1, 1, 1, C.shoe);
  limb(ctx, P([11, shoulder[1] + 1 + bob]), P(frontHand), C.hoodie, false);
  px(frontHand[0], frontHand[1], 1, 1, C.skin);
}

let cached: string | null = null;
/** Sprite sheet (5 frames side by side) as a PNG data URL. Frame 0 = standing, 1-4 = running. */
export function hunterSheet(): string {
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = SPRITE_W * (RUN_FRAMES + 1); c.height = SPRITE_H;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  for (let f = 0; f <= RUN_FRAMES; f++) drawFrame(ctx, f * SPRITE_W, f);
  cached = c.toDataURL("image/png");
  return cached;
}

/** A marker element: the runner plus a ground shadow and rain splashes at its feet. */
export function hunterElement(scale = 3): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "hunter";
  el.style.setProperty("--hs", String(scale));
  el.innerHTML = `<i class="hunter-shadow"></i><i class="hunter-splash"></i><i class="hunter-splash b"></i><span class="hunter-sprite"></span>`;
  (el.querySelector(".hunter-sprite") as HTMLElement).style.backgroundImage = `url(${hunterSheet()})`;
  return el;
}
