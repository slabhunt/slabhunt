// Writes one season's pass metadata with the tier HIDDEN: every pass starts as "Unrevealed". The game deals the tiers
// with public drand randomness when the season starts (see /verify?season=N), and reveal-season.ts can then point each
// NFT at its tier's file so marketplaces show it too.
//
//   SEASON_NAME="Season 2: Night Market" SUPPLY=420 IMAGE_BASE=https://.../season-2/ npm run make-metadata
//   (images: IMAGE_BASE + unrevealed.png, common.png, uncommon.png, rare.png, epic.png, legendary.png, collection.png)
// Writes OUT (default ./metadata): collection.json, 1.json ... N.json (unrevealed), and tier-1.json ... tier-5.json.
// Upload the folder to Arweave/Irys; its URL is ITEM_URI_PREFIX for create-season and TIER_URI_PREFIX for the reveal.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

function env(k: string, fallback?: string) {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing ${k}`);
  return v;
}

const SEASON = env("SEASON_NAME");
const SUPPLY = parseInt(env("SUPPLY", "420"), 10);
const IMAGE_BASE = env("IMAGE_BASE");
const OUT = process.env.OUT ?? "./metadata";

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "collection.json"), JSON.stringify({
  name: `Season Pass: ${SEASON}`,
  description: "Season Pass for the season named. Each pass's tier is revealed when the season starts and unlocks free power-up levels for that season.",
  image: IMAGE_BASE + "collection.png",
}, null, 2));
for (let i = 1; i <= SUPPLY; i++) {
  writeFileSync(join(OUT, `${i}.json`), JSON.stringify({
    name: `Season Pass #${i}`,
    description: `Season Pass for ${SEASON}. Tier hidden until the season starts, then dealt with public drand randomness.`,
    image: IMAGE_BASE + "unrevealed.png",
    attributes: [{ trait_type: "Tier", value: "Unrevealed" }, { trait_type: "Season", value: SEASON }],
  }, null, 2));
}
TIERS.forEach((name, i) => {
  writeFileSync(join(OUT, `tier-${i + 1}.json`), JSON.stringify({
    name: `${name} Season Pass`,
    description: `${name} Season Pass for ${SEASON}. Unlocks ${i + 1} power-up level${i ? "s" : ""} in throws, speed and sight while the season runs.`,
    image: IMAGE_BASE + name.toLowerCase() + ".png",
    attributes: [
      { trait_type: "Tier", value: name },
      { trait_type: "Power-up levels", value: i + 1 },
      { trait_type: "Season", value: SEASON },
    ],
  }, null, 2));
});
console.log(`Wrote ${SUPPLY} unrevealed passes and 5 tier files to ${OUT}. Set the tier split in the game's admin (default ~70/20/7/2/0.7%).`);
