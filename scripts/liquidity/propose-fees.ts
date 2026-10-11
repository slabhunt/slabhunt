// Weekly LP fee routine, as Squads proposals. Nothing here can move funds on its own.
//
//   1. Sweep: SOL already sitting in the Liquidity vault from earlier fee claims is split by PROCEEDS in config.ts
//      (development, secondary liquidity, card prizes, buyback, ops reserve) — proposed as one vault transaction.
//   2. Claim: the swap fees the vault's DLMM positions have earned are claimed into the vault — one proposal per
//      claim transaction.
// Signers approve and execute in the Squads app. The PROPOSER key only pays fees and creates proposals: give it the
// "Initiate" permission only (no Vote, no Execute) when you add it as a multisig member.
//
// Run on devnet first:  DRY_RUN=1 npm run propose-fees   then   npm run propose-fees
// Env: RPC_URL, CLUSTER, PROPOSER_KEYPAIR (path to a JSON key file, the JSON array, or a base58 key from Phantom), SQUADS_MULTISIG (the
// multisig account, not the vault), VAULT_INDEX (default 0), POOL_ADDRESS, and the sweep wallets:
// DEV_WALLET, SECONDARY_RESERVE_WALLET, CARD_PRIZES_WALLET, BUYBACK_WALLET, OPS_RESERVE_WALLET.
// Optional: MIN_CLAIM_SOL (default 0.05), MIN_SWEEP_SOL (default 0.1), VAULT_SOL_RESERVE (default 0.05).
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, type TransactionInstruction,
} from "@solana/web3.js";
import { createCloseAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";
import { PROCEEDS, WSOL_MINT } from "./config.ts";

const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const DLMM = ((dlmmSdk as unknown as { default?: typeof dlmmSdk.default }).default ?? dlmmSdk) as typeof dlmmSdk.default;

const env = (k: string, required = true) => {
  const v = process.env[k];
  if (!v && required) throw new Error(`Set ${k}`);
  return v ?? "";
};
const DRY = !!process.env.DRY_RUN;
const CLUSTER = process.env.CLUSTER ?? "devnet";
const connection = new Connection(env("RPC_URL"), "confirmed");
const rawKey = env("PROPOSER_KEYPAIR");
// Accepts the JSON array itself, a path to a solana-keygen JSON file, or a base58 private key exported from a wallet app.
const keyText = rawKey.trim().startsWith("[") ? rawKey : fs.existsSync(rawKey) ? fs.readFileSync(rawKey, "utf8") : rawKey;
const proposer = Keypair.fromSecretKey(keyText.trim().startsWith("[") ? Uint8Array.from(JSON.parse(keyText)) : bs58.decode(keyText.trim()));
const multisigPda = new PublicKey(env("SQUADS_MULTISIG"));
const vaultIndex = Number(process.env.VAULT_INDEX ?? 0);
const [vault] = multisig.getVaultPda({ multisigPda, index: vaultIndex });
const pool = new PublicKey(env("POOL_ADDRESS"));
const sol = (n: number) => Math.round(n * LAMPORTS_PER_SOL);
const MIN_CLAIM = sol(Number(process.env.MIN_CLAIM_SOL ?? 0.05));
const MIN_SWEEP = sol(Number(process.env.MIN_SWEEP_SOL ?? 0.1));
const RESERVE = sol(Number(process.env.VAULT_SOL_RESERVE ?? 0.05));

const SWEEP_TO: { key: keyof typeof PROCEEDS; wallet: string }[] = [
  { key: "development", wallet: env("DEV_WALLET") },
  { key: "secondaryLiquidity", wallet: env("SECONDARY_RESERVE_WALLET") },
  { key: "cardPrizes", wallet: env("CARD_PRIZES_WALLET") },
  { key: "buyback", wallet: env("BUYBACK_WALLET") },
  { key: "opsReserve", wallet: env("OPS_RESERVE_WALLET") },
];

/** Create a vault transaction and its proposal. Returns the transaction index. */
async function propose(ixs: TransactionInstruction[], memo: string) {
  const info = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(Number(info.transactionIndex) + 1);
  const message = new TransactionMessage({
    payerKey: vault, recentBlockhash: (await connection.getLatestBlockhash()).blockhash, instructions: ixs,
  });
  if (DRY) { console.log(`  [dry run] would propose #${transactionIndex}: ${memo} (${ixs.length} instructions)`); return transactionIndex; }
  const a = await multisig.rpc.vaultTransactionCreate({
    connection, feePayer: proposer, multisigPda, transactionIndex, creator: proposer.publicKey,
    vaultIndex, ephemeralSigners: 0, transactionMessage: message, memo,
  });
  const b = await multisig.rpc.proposalCreate({ connection, feePayer: proposer, multisigPda, transactionIndex, creator: proposer });
  console.log(`  proposed #${transactionIndex}: ${memo}\n    create ${a}\n    proposal ${b}`);
  return transactionIndex;
}

async function sweep() {
  // Unwrap any wrapped SOL the claims left in the vault, then split everything above the reserve.
  const wsolAta = getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT), vault, true);
  const wsol = await connection.getTokenAccountBalance(wsolAta).then((r) => Number(r.value.amount)).catch(() => 0);
  const lamports = await connection.getBalance(vault);
  const rent = wsol > 0 ? await connection.getMinimumBalanceForRentExemption(165) : 0;
  const spendable = lamports + wsol + rent - RESERVE;
  console.log(`Vault ${vault.toBase58()}: ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL + ${(wsol / LAMPORTS_PER_SOL).toFixed(4)} wSOL`);
  if (spendable < MIN_SWEEP) { console.log(`  Nothing to sweep (under ${MIN_SWEEP / LAMPORTS_PER_SOL} SOL after the reserve).`); return; }

  if (SWEEP_TO.some((t) => t.wallet === vault.toBase58())) {
    throw new Error("A sweep wallet is the Liquidity vault itself; that share would be swept again next week. Use a separate vault (e.g. vault #1) for it.");
  }
  const total = Object.values(PROCEEDS).reduce((s, p) => s + p, 0);
  if (Math.abs(total - 1) > 1e-9) throw new Error("PROCEEDS in config.ts must add up to 1");
  const ixs: TransactionInstruction[] = [];
  if (wsol > 0) ixs.push(createCloseAccountInstruction(wsolAta, vault, vault));
  let sent = 0;
  for (const [i, t] of SWEEP_TO.entries()) {
    const amount = i === SWEEP_TO.length - 1 ? spendable - sent : Math.floor(spendable * PROCEEDS[t.key]);
    sent += amount;
    if (amount <= 0) continue;
    ixs.push(SystemProgram.transfer({ fromPubkey: vault, toPubkey: new PublicKey(t.wallet), lamports: amount }));
    console.log(`  ${t.key.padEnd(18)} ${(PROCEEDS[t.key] * 100).toFixed(0).padStart(3)}%  ${(amount / LAMPORTS_PER_SOL).toFixed(4)} SOL -> ${t.wallet}`);
  }
  await propose(ixs, `Vault Hunt fee sweep ${new Date().toISOString().slice(0, 10)}`);
}

async function claim() {
  const dlmm = await DLMM.create(connection, pool, { cluster: CLUSTER as "devnet" | "mainnet-beta" });
  const { userPositions } = await dlmm.getPositionsByUserAndLbPair(vault);
  const solIsX = dlmm.tokenX.publicKey.toBase58() === WSOL_MINT;
  let solFees = 0, tokenFees = 0;
  for (const p of userPositions) {
    const x = Number(p.positionData.feeX.toString()), y = Number(p.positionData.feeY.toString());
    solFees += solIsX ? x : y; tokenFees += solIsX ? y : x;
  }
  console.log(`${userPositions.length} positions; unclaimed fees ${(solFees / LAMPORTS_PER_SOL).toFixed(4)} SOL and ${tokenFees} raw $SLAB units`);
  if (!userPositions.length) return;
  if (solFees < MIN_CLAIM) { console.log(`  Under ${MIN_CLAIM / LAMPORTS_PER_SOL} SOL in fees; not worth the transaction fees yet.`); return; }
  const txs = await dlmm.claimAllSwapFee({ owner: vault, positions: userPositions });
  for (const [i, tx] of txs.entries()) {
    await propose(tx.instructions, `Vault Hunt fee claim ${new Date().toISOString().slice(0, 10)} (${i + 1}/${txs.length})`);
  }
  console.log("  $SLAB-side fees stay in the Liquidity vault; decide their use by multisig vote.");
}

async function main() {
  console.log(`${DRY ? "[dry run] " : ""}Squads multisig ${multisigPda.toBase58()} vault #${vaultIndex} on ${CLUSTER}; proposer ${proposer.publicKey.toBase58()}`);
  const info = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const me = info.members.find((m) => m.key.equals(proposer.publicKey));
  if (!me) throw new Error("The proposer key isn't a member of this multisig. Add it with the Initiate permission only.");
  const mask = me.permissions.mask;
  if (mask & 0b110) console.warn("WARNING: the proposer can vote or execute. Give it Initiate only, so a leaked key can't move funds.");
  await sweep();   // last week's claimed fees
  await claim();   // this week's fees (executed by signers; swept next run)
  console.log("Done. Signers: open the Squads app, review each proposal's amounts and destinations, approve and execute claims first.");
}

main().catch((e) => { console.error(e); process.exit(1); });
