// Creates the $YOINK token, splits the supply into the buckets in config.ts, and revokes the mint
// and freeze authorities so no more can ever be made. Run on devnet first.
//
//   CLUSTER=devnet RPC_URL=https://api.devnet.solana.com OPERATOR_KEYPAIR=./keys/operator.json \
//   SECONDARY_RESERVE_WALLET=<liquidity multisig> GAME_TREASURY_WALLET=<treasury multisig> \
//   TEAM_VESTING_WALLET=<vesting contract or escrow> npm run create-token
//
// The launch-pool share stays with the operator wallet, which seeds it next with launch-pool.ts.
// Add DRY_RUN=1 to print the plan only. Set REVOKE=0 on devnet if you want to mint test tokens later.
import fs from "node:fs";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity, none, percentAmount, publicKey, transactionBuilder, type PublicKey } from "@metaplex-foundation/umi";
import { createAndMint, mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { AuthorityType, createTokenIfMissing, findAssociatedTokenPda, setAuthority, transferTokens } from "@metaplex-foundation/mpl-toolbox";
import { ALLOCATION, TOKEN } from "./config.ts";

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Set ${k} (see README.md)`);
  return v;
};
const DRY = !!process.env.DRY_RUN;
const REVOKE = process.env.REVOKE !== "0";
const URI = env("METADATA_URI", "https://vault-hunt.vercel.app/brand/yoink.json");

const umi = createUmi(env("RPC_URL")).use(mplTokenMetadata());
const secret = new Uint8Array(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8")));
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

const units = (whole: number) => BigInt(Math.round(whole)) * 10n ** BigInt(TOKEN.decimals);
const buckets: { label: string; owner: PublicKey; share: number }[] = [
  { label: "Secondary liquidity reserve", owner: publicKey(env("SECONDARY_RESERVE_WALLET")), share: ALLOCATION.secondaryReserve },
  { label: "Game rewards and treasury", owner: publicKey(env("GAME_TREASURY_WALLET")), share: ALLOCATION.gameTreasury },
  { label: "Team (vesting)", owner: publicKey(env("TEAM_VESTING_WALLET")), share: ALLOCATION.team },
];

async function main() {
  const total = TOKEN.totalSupply;
  console.log(`${TOKEN.name} ($${TOKEN.symbol}), ${total.toLocaleString()} supply, ${TOKEN.decimals} decimals`);
  console.log(`Metadata: ${URI}`);
  console.log(`Launch pool (stays with operator ${umi.identity.publicKey}): ${(total * ALLOCATION.launchPool).toLocaleString()}`);
  for (const b of buckets) console.log(`${b.label} -> ${b.owner}: ${(total * b.share).toLocaleString()}`);
  console.log(REVOKE ? "Mint and freeze authority will be revoked." : "REVOKE=0: authorities kept (devnet testing only).");
  if (DRY) { console.log("DRY_RUN: nothing sent."); return; }

  // 1. Mint the whole supply to the operator.
  const mint = generateSigner(umi);
  await createAndMint(umi, {
    mint,
    name: TOKEN.name,
    symbol: TOKEN.symbol,
    uri: URI,
    sellerFeeBasisPoints: percentAmount(0),
    decimals: TOKEN.decimals,
    amount: units(total),
    tokenOwner: umi.identity.publicKey,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);
  console.log(`Mint: ${mint.publicKey}`);
  fs.mkdirSync("keys", { recursive: true });
  fs.writeFileSync("keys/token-mint.txt", `${mint.publicKey}\n`);

  // 2. Send each bucket to its wallet.
  const [source] = findAssociatedTokenPda(umi, { mint: mint.publicKey, owner: umi.identity.publicKey });
  for (const b of buckets) {
    const [destination] = findAssociatedTokenPda(umi, { mint: mint.publicKey, owner: b.owner });
    await transactionBuilder()
      .add(createTokenIfMissing(umi, { mint: mint.publicKey, owner: b.owner }))
      .add(transferTokens(umi, { source, destination, amount: units(total * b.share) }))
      .sendAndConfirm(umi);
    console.log(`Sent ${b.label}`);
  }

  // 3. No more tokens, no freezing, ever.
  if (REVOKE) {
    await transactionBuilder()
      .add(setAuthority(umi, { owned: mint.publicKey, owner: umi.identity, authorityType: AuthorityType.MintTokens, newAuthority: none() }))
      .add(setAuthority(umi, { owned: mint.publicKey, owner: umi.identity, authorityType: AuthorityType.FreezeAccount, newAuthority: none() }))
      .sendAndConfirm(umi);
    console.log("Mint and freeze authority revoked.");
  }
  console.log(`Done. Next: TOKEN_MINT=${mint.publicKey} npm run launch`);
}

main().catch((e) => { console.error(e); process.exit(1); });
