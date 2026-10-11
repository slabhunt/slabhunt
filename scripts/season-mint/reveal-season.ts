// Optional, after the game has revealed a season's tiers: point each pass NFT at its tier's metadata file so wallets
// and marketplaces show the tier. The game itself doesn't need this; it reads tiers from the reveal.
// Signed by the collection's update authority (the same key that ran create-season). Keep it offline.
//
//   RPC_URL=https://api.devnet.solana.com KEYPAIR=~/keys/season-authority.json SEASON_ID=2 \
//   COLLECTION=<collection address> TIER_URI_PREFIX=https://.../season-2/ \
//   SUPABASE_URL=https://naghdnhloupdnsmuhqws.supabase.co SUPABASE_ANON_KEY=<public anon key> npm run reveal-season
// Add DRY_RUN=1 to print the changes without sending anything.
import { readFileSync } from "node:fs";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { mplCore, update, fetchAssetV1 } from "@metaplex-foundation/mpl-core";

function env(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}`);
  return v;
}
const NAMES = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary"];

async function main() {
  const umi = createUmi(env("RPC_URL")).use(mplCore());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(new Uint8Array(JSON.parse(readFileSync(env("KEYPAIR"), "utf8"))))));
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/pass_reveal_public`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env("SUPABASE_ANON_KEY"), Authorization: `Bearer ${env("SUPABASE_ANON_KEY")}` },
    body: JSON.stringify({ p_season: Number(env("SEASON_ID")) }),
  });
  const reveal = await r.json() as { revealed_at: string | null; assets: { asset: string; tier: number }[] };
  if (!reveal?.revealed_at) throw new Error("This season isn't revealed yet.");
  const prefix = env("TIER_URI_PREFIX");
  const collection = publicKey(env("COLLECTION"));
  let done = 0;
  for (const a of reveal.assets) {
    const uri = `${prefix}tier-${a.tier}.json`;
    const asset = await fetchAssetV1(umi, publicKey(a.asset));
    if (asset.uri === uri) continue;
    const name = `${NAMES[a.tier]} ${asset.name}`;
    if (process.env.DRY_RUN) { console.log(`[dry run] ${a.asset}: ${name} -> ${uri}`); continue; }
    await update(umi, { asset, collection: { publicKey: collection }, name, uri }).sendAndConfirm(umi);
    done++;
  }
  console.log(`Updated ${done} of ${reveal.assets.length} passes.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
