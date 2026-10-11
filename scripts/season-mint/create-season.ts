// Creates one season's Season Pass: a Metaplex Core collection (with royalties to the treasury)
// and a Core Candy Machine that sells exactly SUPPLY passes, priced in the game token,
// mintable only between START and END (the season's dates), max 1 per wallet. Each pass has a tier
// (make-metadata.ts) that unlocks free power-up levels for the season.
//
// Run on devnet first:  RPC_URL=https://api.devnet.solana.com npm run create-season
// Then paste the printed collection address and mint page URL into Gacha → Admin → Season pass mint.
import { readFileSync } from "node:fs";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity, publicKey, some, dateTime } from "@metaplex-foundation/umi";
import { createCollection, mplCore, ruleSet } from "@metaplex-foundation/mpl-core";
import { addConfigLines, create, mplCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing ${name}. See README.md.`);
  return v;
}

const RPC_URL = env("RPC_URL", "https://api.devnet.solana.com");
const KEYPAIR = env("KEYPAIR");                    // path to the authority keypair JSON (keep this file private)
const SEASON = env("SEASON_NAME");                 // e.g. "Season 1: Lantern Run"
const START = env("START");                        // ISO date, e.g. 2026-10-10T17:05:00Z (season start)
const END = env("END");                            // ISO date (season end); minting stops here
const SUPPLY = parseInt(env("SUPPLY", "111"), 10);
const TOKEN_MINT = env("TOKEN_MINT");              // the game token's mint address
const PRICE = BigInt(env("PRICE_BASE_UNITS"));     // price in the token's smallest units (e.g. 5000 tokens * 10^decimals)
const TREASURY = env("TREASURY");                  // treasury wallet that receives mint payments and royalties
const ROYALTY_BPS = parseInt(env("ROYALTY_BPS", "500"), 10); // 500 = 5%
const COLLECTION_URI = env("COLLECTION_URI");      // JSON metadata for the collection (name, image, description)
const ITEM_URI_PREFIX = env("ITEM_URI_PREFIX");    // e.g. https://.../season-1/ -> items 1.json ... N.json

async function main() {
  const umi = createUmi(RPC_URL).use(mplCore()).use(mplCandyMachine());
  const secret = new Uint8Array(JSON.parse(readFileSync(KEYPAIR, "utf8")));
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

  // 1) Collection with royalties to the treasury
  const collection = generateSigner(umi);
  await createCollection(umi, {
    collection,
    name: `Slab Hunt Pass: ${SEASON}`,
    uri: COLLECTION_URI,
    plugins: [{
      type: "Royalties",
      basisPoints: ROYALTY_BPS,
      creators: [{ address: publicKey(TREASURY), percentage: 100 }],
      ruleSet: ruleSet("None"),
    }],
  }).sendAndConfirm(umi);
  console.log("Collection:", collection.publicKey);

  // 2) Candy machine: fixed supply, token price, season window, one per wallet
  const candyMachine = generateSigner(umi);
  const [treasuryAta] = findAssociatedTokenPda(umi, { mint: publicKey(TOKEN_MINT), owner: publicKey(TREASURY) });
  // Shared rules: only during the season. Everyone pays the token price, 1 per wallet (group "pub").
  // Passes come out in random order (isSequential: false), so nobody can pick a tier; metadata from make-metadata.
  const groups = [
    { label: "pub", guards: {
      tokenPayment: some({ amount: PRICE, mint: publicKey(TOKEN_MINT), destinationAta: treasuryAta }),
      mintLimit: some({ id: 2, limit: 1 }),
    } },
  ];

  await (await create(umi, {
    candyMachine,
    collection: collection.publicKey,
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: SUPPLY,
    configLineSettings: some({ prefixName: "Season Pass #", nameLength: 4, prefixUri: ITEM_URI_PREFIX, uriLength: 9, isSequential: false }),
    guards: {
      startDate: some({ date: dateTime(START) }),
      endDate: some({ date: dateTime(END) }),
    },
    groups,
  })).sendAndConfirm(umi);
  console.log("Candy machine:", candyMachine.publicKey);

  // 3) One config line per pass: name suffix and metadata file (1.json ... N.json)
  const BATCH = 10;
  for (let i = 0; i < SUPPLY; i += BATCH) {
    const lines = Array.from({ length: Math.min(BATCH, SUPPLY - i) }, (_, k) => ({ name: String(i + k + 1), uri: `${i + k + 1}.json` }));
    await addConfigLines(umi, { candyMachine: candyMachine.publicKey, index: i, configLines: lines }).sendAndConfirm(umi);
  }
  console.log(`Loaded ${SUPPLY} passes.`);
  console.log("\nNext: set the collection address and mint page URL in the game (Gacha → Admin → Season pass mint).");
}

main().catch((e) => { console.error(e); process.exit(1); });
