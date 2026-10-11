// Creates the $SLAB / SOL Meteora DLMM launch pool and seeds the single-sided ladder from config.ts.
// Written against @meteora-ag/dlmm 1.9.14. Run on devnet first:
//   CLUSTER=devnet RPC_URL=https://api.devnet.solana.com OPERATOR_KEYPAIR=./keys/operator.json \
//   TOKEN_MINT=<mint> LIQUIDITY_MULTISIG=<squads vault address> LAUNCH_TIME=2026-11-01T17:00:00Z \
//   npx tsx launch-pool.ts            (add DRY_RUN=1 to print the plan without sending anything)
//
// Safety: the operator key only pays fees and holds the tokens being seeded. The positions and their
// fees belong to LIQUIDITY_MULTISIG, and they are locked until LAUNCH_TIME + lockDays.
import fs from "node:fs";
import path from "node:path";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, type Cluster } from "@solana/web3.js";
import { createRequire } from "node:module";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LAUNCH, TOKEN, ALLOCATION, WSOL_MINT, startPriceSol } from "./config.ts";
import { assertVaultAddress } from "./wallet-check.ts";

// The DLMM SDK's ESM build does `import { BN } from "@coral-xyz/anchor"`, which Node's ESM loader rejects
// (anchor is CommonJS). Loading its CommonJS build avoids that, and taking BN from anchor keeps one BN class.
const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
// Its CommonJS build may hand back the class itself or a module object with a default export.
const DLMM = ((dlmmSdk as unknown as { default?: typeof dlmmSdk.default }).default ?? dlmmSdk) as typeof dlmmSdk.default;
const { ActivationType, LBCLMM_PROGRAM_IDS, deriveCustomizablePermissionlessLbPair } = dlmmSdk;
const { BN } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");

const env = (k: string, required = true) => {
  const v = process.env[k];
  if (!v && required) throw new Error(`Set ${k}`);
  return v ?? "";
};
const CLUSTER = (process.env.CLUSTER ?? "devnet") as Cluster;
const DRY = !!process.env.DRY_RUN;
const connection = new Connection(env("RPC_URL"), "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8"))));
const tokenMint = new PublicKey(env("TOKEN_MINT"));
const owner = new PublicKey(env("LIQUIDITY_MULTISIG"));
const launchTs = Math.floor(new Date(env("LAUNCH_TIME")).getTime() / 1000);
if (!(launchTs > Date.now() / 1000)) throw new Error("LAUNCH_TIME must be in the future");
const solMint = new PublicKey(WSOL_MINT);
const opt = { cluster: CLUSTER };

/** UI price (SOL per token) to the pool's per-lamport price. */
const lamportPrice = (p: number) => p * 10 ** (9 - TOKEN.decimals);

const MAX_TX_BYTES = 1232;

/** Size of a legacy transaction with these instructions and signer count. */
async function txSize(ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const msg = tx.compileMessage().serialize().length;
  const n = tx.compileMessage().header.numRequiredSignatures;
  return 1 + 64 * n + msg;
}

/**
 * Sends a group of instructions. If the group is over Solana's size limit (a deposit plus the
 * final "leftover" deposit can be), it is split: each instruction goes in its own transaction,
 * in the same order, with the group's compute-budget instructions in front of each one.
 */
async function send(ixs: TransactionInstruction[], signers: Keypair[], label: string) {
  if ((await txSize(ixs, signers)) <= MAX_TX_BYTES) {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
    console.log(`  ${label}: ${sig}`);
    return;
  }
  const budget = ixs.filter((ix) => ix.programId.equals(ComputeBudgetProgram.programId));
  const work = ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  for (const [k, ix] of work.entries()) {
    const part = [...budget, ix];
    const size = await txSize(part, signers);
    if (size > MAX_TX_BYTES) throw new Error(`${label}: one instruction alone is ${size} bytes (limit ${MAX_TX_BYTES}); this needs a lookup-table transaction`);
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...part), signers, { commitment: "confirmed" });
    console.log(`  ${label} (part ${k + 1}/${work.length}): ${sig}`);
  }
}

// Progress log so a re-run doesn't resend the ownership proof.
const progressFile = path.resolve("keys", "launch-progress.json");
const done: Record<string, true> = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, "utf8")) : {};
const mark = (key: string) => { done[key] = true; fs.writeFileSync(progressFile, JSON.stringify(done, null, 2)); };

async function main() {
  await assertVaultAddress(connection, owner, "LIQUIDITY_MULTISIG");
  const p0 = startPriceSol();
  const activeId = DLMM.getBinIdFromPrice(lamportPrice(p0), LAUNCH.binStep, true);
  const programId = new PublicKey(LBCLMM_PROGRAM_IDS[CLUSTER as keyof typeof LBCLMM_PROGRAM_IDS]);
  const [pairKey] = deriveCustomizablePermissionlessLbPair(tokenMint, solMint, programId);
  const lockRelease = new BN(launchTs + LAUNCH.lockDays * 86_400);
  const poolTokens = TOKEN.totalSupply * ALLOCATION.launchPool;

  console.log(`Cluster ${CLUSTER}, pair ${pairKey.toBase58()}`);
  console.log(`Start price ${p0} SOL (bin ${activeId}), bin step ${LAUNCH.binStep}, fee ${LAUNCH.feeBps} bps`);
  console.log(`Trading opens ${new Date(launchTs * 1000).toISOString()}, positions locked until ${new Date(lockRelease.toNumber() * 1000).toISOString()}`);
  console.log(`Positions and fees owned by ${owner.toBase58()}`);
  LAUNCH.ladder.forEach((r) => console.log(`  ${r.from}x-${r.to}x: ${(poolTokens * r.share).toLocaleString()} tokens`));
  if (DRY) { console.log("DRY_RUN: nothing sent."); return; }

  // 1. The pair (skipped if it already exists).
  const freshPair = !(await connection.getAccountInfo(pairKey));
  if (freshPair) {
    const tx = await DLMM.createCustomizablePermissionlessLbPair(
      connection, new BN(LAUNCH.binStep), tokenMint, solMint, new BN(activeId), new BN(LAUNCH.feeBps),
      ActivationType.Timestamp, true /* Alpha Vault buys first */, operator.publicKey, new BN(launchTs),
      false, undefined, undefined, opt,
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [operator], { commitment: "confirmed" });
    console.log(`Created pair: ${sig}`);
  } else console.log("Pair already exists; seeding only.");

  const pair = await DLMM.create(connection, pairKey, opt);
  const operatorTokenAccount = getAssociatedTokenAddressSync(tokenMint, operator.publicKey);
  const tokenBalance = async () => BigInt((await connection.getTokenAccountBalance(operatorTokenAccount)).value.amount);
  const one = 10n ** BigInt(TOKEN.decimals);
  const held = await tokenBalance();
  console.log(`Operator holds ${Number(held / one).toLocaleString()} tokens before seeding`);
  if (freshPair && held < BigInt(Math.round(poolTokens)) * one) {
    throw new Error(`Operator holds ${held / one} tokens but the launch pool needs ${poolTokens}. Stopping before depositing.`);
  }

  // The final "leftover" deposit names the operator's wrapped-SOL account even though it adds no SOL,
  // so make sure that account exists (no-op if it already does).
  const operatorWsol = getAssociatedTokenAddressSync(solMint, operator.publicKey);
  if (!(await connection.getAccountInfo(operatorWsol))) {
    await send([createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, operatorWsol, operator.publicKey, solMint)], [operator], "operator wrapped-SOL account");
  }

  // 2. One seeded, locked position group per ladder range. Each range needs its own base key.
  const keysDir = path.resolve("keys");
  fs.mkdirSync(keysDir, { recursive: true });
  for (const [i, r] of LAUNCH.ladder.entries()) {
    const baseFile = path.join(keysDir, `base-${i}.json`);
    const base = fs.existsSync(baseFile)
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(baseFile, "utf8"))))
      : Keypair.generate();
    fs.writeFileSync(baseFile, JSON.stringify(Array.from(base.secretKey)), { mode: 0o600 });

    let amount = new BN(Math.round(poolTokens * r.share)).mul(new BN(10).pow(new BN(TOKEN.decimals)));
    // Each range's ownership proof sends 1 base unit of the token to the owner, so the final range keeps
    // back 1 whole token; otherwise its last deposit comes up a few units short.
    if (i === LAUNCH.ladder.length - 1) amount = amount.sub(new BN(10).pow(new BN(TOKEN.decimals)));
    console.log(`Range ${r.from}x-${r.to}x`);
    let res;
    try {
      res = await pair.seedLiquidity(
        owner, amount, LAUNCH.curvature, p0 * r.from, p0 * r.to,
        base.publicKey, operator.publicKey, owner, operator.publicKey, lockRelease, true,
      );
    } catch (e) {
      // After trading opens, ranges the price has already entered can't be seeded again; they were
      // filled before launch, so a re-run (e.g. to finish a higher range) skips them.
      if (String(e).includes("minPrice < current pair price")) { console.log("  price is already inside or above this range; skipping"); continue; }
      throw e;
    }
    const proofKey = `${pairKey.toBase58()}:range${i}:proof`;
    if (res.sendPositionOwnerTokenProveIxs.length && !done[proofKey]) {
      await send(res.sendPositionOwnerTokenProveIxs, [operator], "ownership proof");
      mark(proofKey);
    }
    for (const [j, group] of res.initializeBinArraysAndPositionIxs.entries()) await send(group, [operator, base], `positions ${j + 1}/${res.initializeBinArraysAndPositionIxs.length}`);
    // The SDK leaves out positions that already hold liquidity, so a re-run never deposits twice.
    if (res.addLiquidityIxs.length === 0) console.log("  deposits: already done");
    if (res.addLiquidityIxs.length > 0) {
      // Guard: stop if a range takes more than it should (a re-run deposits only the unfilled positions).
      const before = await tokenBalance();
      for (const [j, group] of res.addLiquidityIxs.entries()) await send(group, [operator], `deposit ${j + 1}/${res.addLiquidityIxs.length}`);
      const used = before - (await tokenBalance());
      console.log(`  range used ${Number(used) / 10 ** TOKEN.decimals} tokens (planned ${Number(amount.toString()) / 10 ** TOKEN.decimals})`);
      if (used > BigInt(amount.toString()) + 10n ** BigInt(TOKEN.decimals)) throw new Error("This range took more tokens than planned. Stopping; check the pool before continuing.");
    }
  }
  console.log("Done. Next: create the Alpha Vault for this pair before LAUNCH_TIME (see README), then publish the pair address.");
}

main().catch((e) => { console.error(e); process.exit(1); });
