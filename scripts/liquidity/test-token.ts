// DEVNET ONLY: a plain SPL test token (no Metaplex metadata) for rehearsing the pool and vault.
// Same supply, decimals and bucket split as create-token.ts, and it revokes mint + freeze authority.
//   npm run test-token
import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AuthorityType, createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, transfer } from "@solana/spl-token";
import { ALLOCATION, TOKEN } from "./config.ts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
if ((process.env.CLUSTER ?? "devnet") === "mainnet-beta") throw new Error("test-token is for devnet only; use create-token on mainnet");
const connection = new Connection(env("RPC_URL"), "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8"))));
const units = (whole: number) => BigInt(Math.round(whole)) * 10n ** BigInt(TOKEN.decimals);

async function main() {
  const mint = await createMint(connection, operator, operator.publicKey, operator.publicKey, TOKEN.decimals);
  console.log(`Mint: ${mint.toBase58()}`);
  const own = await getOrCreateAssociatedTokenAccount(connection, operator, mint, operator.publicKey);
  await mintTo(connection, operator, mint, own.address, operator, units(TOKEN.totalSupply));
  for (const [label, key, share] of [
    ["Secondary liquidity reserve", "SECONDARY_RESERVE_WALLET", ALLOCATION.secondaryReserve],
    ["Game rewards and treasury", "GAME_TREASURY_WALLET", ALLOCATION.gameTreasury],
    ["Team (vesting)", "TEAM_VESTING_WALLET", ALLOCATION.team],
  ] as const) {
    const dest = await getOrCreateAssociatedTokenAccount(connection, operator, mint, new PublicKey(env(key)), true);
    await transfer(connection, operator, own.address, dest.address, operator, units(TOKEN.totalSupply * share));
    console.log(`Sent ${label}`);
  }
  await setAuthority(connection, operator, mint, operator, AuthorityType.MintTokens, null);
  await setAuthority(connection, operator, mint, operator, AuthorityType.FreezeAccount, null);
  console.log("Mint and freeze authority revoked.");
  console.log(`Done. Put TOKEN_MINT=${mint.toBase58()} in .env, then npm run launch`);
}

main().catch((e) => { console.error(e); process.exit(1); });
