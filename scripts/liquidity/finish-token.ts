// Finishes token distribution and revokes authorities for an existing TOKEN_MINT.
// Use this if create-token.ts was interrupted after minting but before revoking authorities.
import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AuthorityType, getAccount, getOrCreateAssociatedTokenAccount, setAuthority, transfer } from "@solana/spl-token";
import { ALLOCATION, TOKEN } from "./config.ts";

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Set ${k} (see README.md)`);
  return v;
};
const REVOKE = process.env.REVOKE !== "0";
const connection = new Connection(env("RPC_URL"), "confirmed");
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8")));
const operator = Keypair.fromSecretKey(secret);
const mint = new PublicKey(env("TOKEN_MINT"));

const units = (whole: number) => BigInt(Math.round(whole)) * 10n ** BigInt(TOKEN.decimals);
const buckets = [
  { label: "Secondary liquidity reserve", owner: new PublicKey(env("SECONDARY_RESERVE_WALLET")), share: ALLOCATION.secondaryReserve },
  { label: "Game rewards and treasury", owner: new PublicKey(env("GAME_TREASURY_WALLET")), share: ALLOCATION.gameTreasury },
  { label: "Team (vesting)", owner: new PublicKey(env("TEAM_VESTING_WALLET")), share: ALLOCATION.team },
];

async function main() {
  const total = TOKEN.totalSupply;
  console.log(`Finishing distribution for ${mint.toBase58()}`);
  
  const own = await getOrCreateAssociatedTokenAccount(connection, operator, mint, operator.publicKey);
  const balance = await getAccount(connection, own.address);
  console.log(`Operator has ${Number(balance.amount) / 10 ** TOKEN.decimals} tokens remaining`);
  
  for (const b of buckets) {
    const dest = await getOrCreateAssociatedTokenAccount(connection, operator, mint, b.owner, true);
    const destBalance = await getAccount(connection, dest.address);
    const expected = units(total * b.share);
    
    if (destBalance.amount >= expected) {
      console.log(`${b.label}: already has ${Number(destBalance.amount) / 10 ** TOKEN.decimals} (complete)`);
    } else {
      const needed = expected - destBalance.amount;
      console.log(`${b.label}: sending ${Number(needed) / 10 ** TOKEN.decimals}...`);
      await transfer(connection, operator, own.address, dest.address, operator, needed);
      console.log(`Sent ${b.label}`);
    }
  }

  if (REVOKE) {
    console.log("Revoking mint and freeze authorities...");
    await setAuthority(connection, operator, mint, operator, AuthorityType.MintTokens, null);
    await setAuthority(connection, operator, mint, operator, AuthorityType.FreezeAccount, null);
    console.log("Mint and freeze authority revoked.");
  }
  console.log(`Done. Run: npm run launch`);
}

main().catch((e) => { console.error(e); process.exit(1); });
