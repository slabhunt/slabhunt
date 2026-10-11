// Street-aware spawn points. For each map area (a zoom-14 tile, about 2 km across) the game needs, this downloads the
// free OpenStreetMap vector tile from OpenFreeMap once, paints roads, rail, buildings and water onto a small grid, and
// stores up to 1,200 random spots that are clear of all of them (sidewalks, plazas, parks, lots). spawn_here then
// places creatures only on those spots, so they never sit in the middle of a street or inside a building.
//
// Called by pg_cron every minute and right away when a player reaches a new area, always with x-cron-secret.
//   POST { action: "tick" } -> { done: [...], failed: [...] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const Z = 14, GRID = 512, MAX_POINTS = 1200;

// Road width in metres by OpenMapTiles class; spots must be at least half that plus a margin away from the centreline.
const ROAD_W: Record<string, number> = {
  motorway: 18, trunk: 16, primary: 13, secondary: 11, tertiary: 10, minor: 8, service: 5, raceway: 8,
  busway: 8, bus_guideway: 6, rail: 7, transit: 6,
};
const MARGIN_M = 3;

/* ---------- minimal Mapbox Vector Tile (protobuf) reader ---------- */
class Reader {
  pos = 0;
  constructor(public buf: Uint8Array) {}
  varint(): number {
    let r = 0, s = 0, b: number;
    do { b = this.buf[this.pos++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
    return r;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const n = this.varint(); this.pos += n; }
    else if (wire === 5) this.pos += 4;
    else throw new Error("bad wire type " + wire);
  }
  bytes(): Uint8Array { const n = this.varint(); const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  str(): string { return new TextDecoder().decode(this.bytes()); }
  packed(): number[] { const end = this.varint() + this.pos; const out: number[] = []; while (this.pos < end) out.push(this.varint()); return out; }
}
type Feature = { type: number; tags: number[]; geom: number[] };
type Layer = { name: string; extent: number; keys: string[]; values: unknown[]; features: Feature[] };

function readValue(r: Reader): unknown {
  const end = r.varint() + r.pos; let v: unknown = null;
  while (r.pos < end) {
    const tag = r.varint(), f = tag >> 3, w = tag & 7;
    if (f === 1) v = r.str(); else if (f === 2) { v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; }
    else if (f === 3) { v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; }
    else if (f === 4 || f === 5) v = r.varint(); else if (f === 6) { const z = r.varint(); v = (z >>> 1) ^ -(z & 1); }
    else if (f === 7) v = !!r.varint(); else r.skip(w);
  }
  return v;
}
function readFeature(r: Reader): Feature {
  const end = r.varint() + r.pos; const f: Feature = { type: 0, tags: [], geom: [] };
  while (r.pos < end) {
    const tag = r.varint(), n = tag >> 3, w = tag & 7;
    if (n === 2) f.tags = r.packed(); else if (n === 3) f.type = r.varint(); else if (n === 4) f.geom = r.packed(); else r.skip(w);
  }
  return f;
}
function readTile(buf: Uint8Array, want: Set<string>): Map<string, Layer> {
  const r = new Reader(buf); const out = new Map<string, Layer>();
  while (r.pos < buf.length) {
    const tag = r.varint();
    if (tag >> 3 !== 3) { r.skip(tag & 7); continue; }
    const end = r.varint() + r.pos;
    const L: Layer = { name: "", extent: 4096, keys: [], values: [], features: [] };
    const featStarts: number[] = [];
    while (r.pos < end) {
      const t = r.varint(), n = t >> 3, w = t & 7;
      if (n === 1) L.name = r.str(); else if (n === 5) L.extent = r.varint(); else if (n === 3) L.keys.push(r.str());
      else if (n === 4) L.values.push(readValue(r)); else if (n === 2) { featStarts.push(r.pos); r.skip(w); } else r.skip(w);
    }
    if (want.has(L.name)) {
      for (const p of featStarts) { const fr = new Reader(buf); fr.pos = p; L.features.push(readFeature(fr)); }
      out.set(L.name, L);
    }
    r.pos = end;
  }
  return out;
}
function prop(L: Layer, f: Feature, key: string): unknown {
  for (let i = 0; i < f.tags.length; i += 2) if (L.keys[f.tags[i]] === key) return L.values[f.tags[i + 1]];
  return undefined;
}
/** Geometry as rings/lines of [x, y] in tile units. */
function geometry(f: Feature): [number, number][][] {
  const out: [number, number][][] = []; let x = 0, y = 0, cur: [number, number][] | null = null, i = 0;
  while (i < f.geom.length) {
    const c = f.geom[i++], cmd = c & 7, count = c >> 3;
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < count; k++) {
        const dx = f.geom[i++], dy = f.geom[i++];
        x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
        if (cmd === 1) { cur = []; out.push(cur); }
        cur!.push([x, y]);
      }
    } else if (cmd === 7 && cur && cur.length) cur.push(cur[0]);
  }
  return out;
}

/* ---------- painting the "blocked" grid ---------- */
function paintLine(g: Uint8Array, pts: [number, number][], s: number, rad: number) {
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0] * s, ay = pts[i - 1][1] * s, bx = pts[i][0] * s, by = pts[i][1] * s;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad)), x1 = Math.min(GRID - 1, Math.ceil(Math.max(ax, bx) + rad));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad)), y1 = Math.min(GRID - 1, Math.ceil(Math.max(ay, by) + rad));
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9, r2 = rad * rad;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let t = ((px - ax) * dx + (py - ay) * dy) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      if (ex * ex + ey * ey <= r2) g[y * GRID + x] = 1;
    }
  }
}
function paintPolygon(g: Uint8Array, rings: [number, number][][], s: number) {
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) { minY = Math.min(minY, p[1] * s); maxY = Math.max(maxY, p[1] * s); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(GRID - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5, xs: number[] = [];
    for (const r of rings) for (let i = 1; i < r.length; i++) {
      const ay = r[i - 1][1] * s, by = r[i][1] * s;
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        const ax = r[i - 1][0] * s, bx = r[i][0] * s;
        xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(GRID - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) g[y * GRID + x] = 1;
    }
  }
}

/* ---------- tile maths ---------- */
function tileToLngLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z, lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lng, lat];
}

let tileUrl: string | null = null;
async function fetchTile(x: number, y: number): Promise<Uint8Array | null> {
  if (!tileUrl) {
    const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json() as { tiles: string[] };
    tileUrl = tj.tiles[0];
  }
  const res = await fetch(tileUrl.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y)));
  if (res.status === 404 || res.status === 204) return null; // nothing mapped here (open sea)
  if (!res.ok) throw new Error(`tile ${res.status}`);
  let buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  return buf;
}

async function spotsFor(x: number, y: number): Promise<{ lat: number; lng: number }[]> {
  const buf = await fetchTile(x, y);
  const [, latN] = tileToLngLat(x, y, Z), [, latS] = tileToLngLat(x, y + 1, Z);
  const metresPerCell = (40075016.686 * Math.cos(((latN + latS) / 2) * Math.PI / 180)) / 2 ** Z / GRID;
  const blocked = new Uint8Array(GRID * GRID);
  if (buf) {
    const layers = readTile(buf, new Set(["transportation", "building", "water", "waterway"]));
    const scaleOf = (L: Layer) => GRID / L.extent;
    const roads = layers.get("transportation");
    if (roads) for (const f of roads.features) {
      if (f.type !== 2) continue;
      const cls = String(prop(roads, f, "class") ?? ""), brunnel = prop(roads, f, "brunnel");
      const w = ROAD_W[cls];
      if (!w || brunnel === "tunnel") continue;
      const rad = (w / 2 + MARGIN_M) / metresPerCell;
      for (const line of geometry(f)) paintLine(blocked, line, scaleOf(roads), rad);
    }
    const ww = layers.get("waterway");
    if (ww) for (const f of ww.features) for (const line of geometry(f)) paintLine(blocked, line, scaleOf(ww), (4 + MARGIN_M) / metresPerCell);
    for (const name of ["building", "water"]) {
      const L = layers.get(name);
      if (L) for (const f of L.features) if (f.type === 3) paintPolygon(blocked, geometry(f), scaleOf(L));
    }
  }
  // Pick random clear cells, at least one cell in from every blocked neighbour.
  const free: number[] = [];
  for (let cy = 1; cy < GRID - 1; cy++) for (let cx = 1; cx < GRID - 1; cx++) {
    const i = cy * GRID + cx;
    if (!blocked[i] && !blocked[i - 1] && !blocked[i + 1] && !blocked[i - GRID] && !blocked[i + GRID]) free.push(i);
  }
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  return free.slice(0, MAX_POINTS).map((i) => {
    const cx = (i % GRID) + 0.25 + Math.random() * 0.5, cy = Math.floor(i / GRID) + 0.25 + Math.random() * 0.5;
    const [lng, lat] = tileToLngLat(x + cx / GRID, y + cy / GRID, Z);
    return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 };
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("cron_secret_ok", { p_secret: req.headers.get("x-cron-secret") ?? "" });
  if (ok !== true) return json({ error: "forbidden" }, 403);

  const { data: tiles } = await db.rpc("spawn_cells_pending", { p_limit: 3 });
  const done: string[] = [], failed: string[] = [];
  for (const t of (tiles ?? []) as string[]) {
    const [, xs, ys] = t.split("/");
    try {
      const pts = await spotsFor(Number(xs), Number(ys));
      const { error } = await db.rpc("spawn_cell_store", { p_tile: t, p_points: pts });
      if (error) throw new Error(error.message);
      done.push(`${t}:${pts.length}`);
    } catch (e) {
      await db.rpc("spawn_cell_fail", { p_tile: t, p_error: String((e as Error)?.message ?? e).slice(0, 200) });
      failed.push(t);
    }
  }
  return json({ done, failed });
});
