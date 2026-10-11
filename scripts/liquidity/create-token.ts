// Creates the token, adds its name/symbol/logo (Metaplex metadata), splits the supply into the buckets
// in config.ts, and revokes the mint and freeze authorities so no more can ever be made. Devnet first.
//
//   npm run create-token            (DRY_RUN=1 to print the plan only; REVOKE=0 on devnet to keep authorities)
//
// The token itself, the transfers and the revokes use the standard SPL token library (the same path as
// test-token.ts, proven on devnet). Metaplex is used for one step only: attaching the metadata.
// The launch-pool share stays with the operator wallet, which seeds it next with launch-pool.ts.
import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AuthorityType, createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, transfer } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, none, percentAmount, publicKey, some } from "@metaplex-foundation/umi";
import { createMetadataAccountV3, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { ALLOCATION, TOKEN } from "./config.ts";
import { assertVaultAddress } from "./wallet-check.ts";

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Set ${k} (see README.md)`);
  return v;
};
const DRY = !!process.env.DRY_RUN;
const REVOKE = process.env.REVOKE !== "0";
const URI = env("METADATA_URI", "https://vault-hunt.vercel.app/brand/slab.json");
const connection = new Connection(env("RPC_URL"), "confirmed");
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8")));
const operator = Keypair.fromSecretKey(secret);
// Who can later fix the name/logo. Defaults to the treasury multisig so no single key controls it.
const metadataAuthority = new PublicKey(env("METADATA_AUTHORITY", env("GAME_TREASURY_WALLET")));

const units = (whole: number) => BigInt(Math.round(whole)) * 10n ** BigInt(TOKEN.decimals);
const buckets = [
  { label: "Secondary liquidity reserve", owner: new PublicKey(env("SECONDARY_RESERVE_WALLET")), share: ALLOCATION.secondaryReserve },
  { label: "Game rewards and treasury", owner: new PublicKey(env("GAME_TREASURY_WALLET")), share: ALLOCATION.gameTreasury },
  { label: "Team (vesting)", owner: new PublicKey(env("TEAM_VESTING_WALLET")), share: ALLOCATION.team },
];

async function main() {
  const total = TOKEN.totalSupply;
  console.log(`${TOKEN.name} ($${TOKEN.symbol}), ${total.toLocaleString()} supply, ${TOKEN.decimals} decimals`);
  console.log(`Metadata: ${URI} (update authority ${metadataAuthority.toBase58()})`);
  console.log(`Launch pool (stays with operator ${operator.publicKey.toBase58()}): ${(total * ALLOCATION.launchPool).toLocaleString()}`);
  for (const b of buckets) console.log(`${b.label} -> ${b.owner.toBase58()}: ${(total * b.share).toLocaleString()}`);
  console.log(REVOKE ? "Mint and freeze authority will be revoked." : "REVOKE=0: authorities kept (devnet testing only).");
  await assertVaultAddress(connection, metadataAuthority, "Metadata authority");
  for (const b of buckets) await assertVaultAddress(connection, b.owner, b.label);
  console.log("Wallet check: every destination is a wallet or Squads vault (not a multisig account).");
  if (DRY) { console.log("DRY_RUN: nothing sent."); return; }

  // 1. Generate the mint keypair and create it, with the operator as mint and freeze authority.
  const mintKeypair = Keypair.generate();
  const mint = await createMint(connection, operator, operator.publicKey, operator.publicKey, TOKEN.decimals, mintKeypair);
  console.log(`Mint: ${mint.toBase58()}`);
  
  // Wait for the mint to be confirmed and fetchable before attaching metadata.
  await new Promise(resolve => setTimeout(resolve, 2000));
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) throw new Error("Mint account not found after creation");
  console.log(`Mint confirmed (${mintInfo.data.length} bytes).`);
  
  fs.mkdirSync("keys", { recursive: true });
  fs.writeFileSync("keys/token-mint.txt", `${mint.toBase58()}\n`);

  // 2. Name, symbol and logo. Attaches metadata to the existing mint.
  const umi = createUmi(env("RPC_URL")).use(mplTokenMetadata());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));
  await createMetadataAccountV3(umi, {
    mint: publicKey(mint.toBase58()),
    mintAuthority: umi.identity,
    // The treasury multisig controls the name/logo from the start (it doesn't need to sign), so no
    // follow-up hand-off is needed.
    updateAuthority: publicKey(metadataAuthority.toBase58()),
    data: {
      name: TOKEN.name,
      symbol: TOKEN.symbol,
      uri: URI,
      sellerFeeBasisPoints: 0,
      creators: none(),
      collection: none(),
      uses: none(),
    },
    isMutable: true,
    collectionDetails: none(),
  }).sendAndConfirm(umi);
  console.log(`Metadata attached; update authority is ${metadataAuthority.toBase58()}.`);

  // 3. Mint the full supply to the operator, then send each bucket to its wallet.
  const own = await getOrCreateAssociatedTokenAccount(connection, operator, mint, operator.publicKey);
  await mintTo(connection, operator, mint, own.address, operator, units(total));
  for (const b of buckets) {
    const dest = await getOrCreateAssociatedTokenAccount(connection, operator, mint, b.owner, true);
    await transfer(connection, operator, own.address, dest.address, operator, units(total * b.share));
    console.log(`Sent ${b.label}`);
  }

  // 4. No more tokens, no freezing, ever.
  if (REVOKE) {
    await setAuthority(connection, operator, mint, operator, AuthorityType.MintTokens, null);
    await setAuthority(connection, operator, mint, operator, AuthorityType.FreezeAccount, null);
    console.log("Mint and freeze authority revoked.");
  }
  console.log(`Done. Put TOKEN_MINT=${mint.toBase58()} in .env, then npm run launch`);
}

main().catch((e) => { console.error(e); process.exit(1); });
