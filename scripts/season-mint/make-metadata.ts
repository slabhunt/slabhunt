// Writes one season's pass metadata: collection.json plus 1.json ... N.json, each with a Tier attribute.
// Tiers are shuffled with a seed, and the full list is written to tiers.json, so anyone can check the split.
// Upload the folder to permanent storage (Arweave/Irys), then use its URL as ITEM_URI_PREFIX in create-season.
//
//   SEASON_NAME="Season 1: Lantern Run" SUPPLY=420 IMAGE_BASE=https://.../season-1/ npm run make-metadata
//   (images: IMAGE_BASE + common.png, uncommon.png, rare.png, epic.png, legendary.png, collection.png)
// Optional: SPLIT="294,84,30,9,3" (Common..Legendary counts, must add up to SUPPLY), SEED=any text, OUT=./metadata
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const TIERS = [
  { name: "Common", levels: 1 },
  { name: "Uncommon", levels: 2 },
  { name: "Rare", levels: 3 },
  { name: "Epic", levels: 4 },
  { name: "Legendary", levels: 5 },
];

function env(k: string, fallback?: string) {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing ${k}`);
  return v;
}

/** Default split ~70 / 20 / 7 / 2 / 0.7 %, rounded so it adds up to the supply. */
function defaultSplit(n: number) {
  const pct = [0.7, 0.2, 0.0715, 0.0215];
  const counts = pct.map((p) => Math.round(n * p));
  counts.push(Math.max(1, n - counts.reduce((a, b) => a + b, 0)));
  return counts;
}

const SEASON = env("SEASON_NAME");
const SUPPLY = parseInt(env("SUPPLY", "420"), 10);
const IMAGE_BASE = env("IMAGE_BASE");
const SEED = process.env.SEED ?? createHash("sha256").update(`${SEASON}:${Date.now()}`).digest("hex").slice(0, 16);
const OUT = process.env.OUT ?? "./metadata";
const split = process.env.SPLIT ? process.env.SPLIT.split(",").map((x) => parseInt(x, 10)) : defaultSplit(SUPPLY);
if (split.length !== 5 || split.reduce((a, b) => a + b, 0) !== SUPPLY) throw new Error(`SPLIT must be 5 counts adding up to ${SUPPLY}: got ${split}`);

// Fisher-Yates with a SHA-256 stream from the seed, so the order can be re-created from tiers.json's seed.
const pool = split.flatMap((c, t) => Array(c).fill(t) as number[]);
let counter = 0;
const rand = (max: number) => {
  const h = createHash("sha256").update(`${SEED}:${counter++}`).digest();
  return h.readUInt32BE(0) % max;
};
for (let i = pool.length - 1; i > 0; i--) { const j = rand(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "collection.json"), JSON.stringify({
  name: `Vault Hunt Pass: ${SEASON}`,
  description: "Season Pass for Vault Hunt. Each pass has a tier that unlocks free power-up levels for the season.",
  image: IMAGE_BASE + "collection.png",
}, null, 2));
pool.forEach((t, i) => {
  const tier = TIERS[t];
  writeFileSync(join(OUT, `${i + 1}.json`), JSON.stringify({
    name: `Season Pass #${i + 1}`,
    description: `${tier.name} Season Pass for ${SEASON}. Unlocks ${tier.levels} power-up level${tier.levels > 1 ? "s" : ""} in throws, speed and sight while the season runs.`,
    image: IMAGE_BASE + tier.name.toLowerCase() + ".png",
    attributes: [
      { trait_type: "Tier", value: tier.name },
      { trait_type: "Power-up levels", value: tier.levels },
      { trait_type: "Season", value: SEASON },
    ],
  }, null, 2));
});
writeFileSync(join(OUT, "tiers.json"), JSON.stringify({ season: SEASON, seed: SEED, split: Object.fromEntries(TIERS.map((t, i) => [t.name, split[i]])),
  tiers: pool.map((t) => TIERS[t].name) }, null, 2));
console.log(`Wrote ${SUPPLY} passes to ${OUT}: ${TIERS.map((t, i) => `${t.name} ${split[i]}`).join(", ")}. Seed ${SEED}.`);
console.log("Publish tiers.json with the mint so players can see the split before minting.");
