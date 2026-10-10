// Creates the $YOINK / SOL Meteora DLMM launch pool and seeds the single-sided ladder from config.ts.
// Written against @meteora-ag/dlmm 1.9.14. Run on devnet first:
//   CLUSTER=devnet RPC_URL=https://api.devnet.solana.com OPERATOR_KEYPAIR=./keys/operator.json \
//   TOKEN_MINT=<mint> LIQUIDITY_MULTISIG=<squads vault address> LAUNCH_TIME=2026-11-01T17:00:00Z \
//   npx tsx launch-pool.ts            (add DRY_RUN=1 to print the plan without sending anything)
//
// Safety: the operator key only pays fees and holds the tokens being seeded. The positions and their
// fees belong to LIQUIDITY_MULTISIG, and they are locked until LAUNCH_TIME + lockDays.
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type Cluster } from "@solana/web3.js";
import { createRequire } from "node:module";
import { LAUNCH, TOKEN, ALLOCATION, WSOL_MINT, startPriceSol } from "./config.ts";

// The DLMM SDK's ESM build does `import { BN } from "@coral-xyz/anchor"`, which Node's ESM loader rejects
// (anchor is CommonJS). Loading its CommonJS build avoids that, and taking BN from anchor keeps one BN class.
const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const DLMM = dlmmSdk.default;
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

async function send(ixs: Parameters<Transaction["add"]>, signers: Keypair[], label: string) {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
  console.log(`  ${label}: ${sig}`);
}

async function main() {
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
  if (!(await connection.getAccountInfo(pairKey))) {
    const tx = await DLMM.createCustomizablePermissionlessLbPair(
      connection, new BN(LAUNCH.binStep), tokenMint, solMint, new BN(activeId), new BN(LAUNCH.feeBps),
      ActivationType.Timestamp, true /* Alpha Vault buys first */, operator.publicKey, new BN(launchTs),
      false, undefined, undefined, opt,
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [operator], { commitment: "confirmed" });
    console.log(`Created pair: ${sig}`);
  } else console.log("Pair already exists; seeding only.");

  const pair = await DLMM.create(connection, pairKey, opt);

  // 2. One seeded, locked position group per ladder range. Each range needs its own base key.
  const keysDir = path.resolve("keys");
  fs.mkdirSync(keysDir, { recursive: true });
  for (const [i, r] of LAUNCH.ladder.entries()) {
    const baseFile = path.join(keysDir, `base-${i}.json`);
    const base = fs.existsSync(baseFile)
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(baseFile, "utf8"))))
      : Keypair.generate();
    fs.writeFileSync(baseFile, JSON.stringify(Array.from(base.secretKey)), { mode: 0o600 });

    const amount = new BN(Math.round(poolTokens * r.share)).mul(new BN(10).pow(new BN(TOKEN.decimals)));
    console.log(`Range ${r.from}x-${r.to}x`);
    const res = await pair.seedLiquidity(
      owner, amount, LAUNCH.curvature, p0 * r.from, p0 * r.to,
      base.publicKey, operator.publicKey, owner, operator.publicKey, lockRelease, true,
    );
    if (res.sendPositionOwnerTokenProveIxs.length) await send(res.sendPositionOwnerTokenProveIxs, [operator], "ownership proof");
    for (const [j, group] of res.initializeBinArraysAndPositionIxs.entries()) await send(group, [operator, base], `positions ${j + 1}/${res.initializeBinArraysAndPositionIxs.length}`);
    for (const [j, group] of res.addLiquidityIxs.entries()) await send(group, [operator], `deposit ${j + 1}/${res.addLiquidityIxs.length}`);
  }
  console.log("Done. Next: create the Alpha Vault for this pair before LAUNCH_TIME (see README), then publish the pair address.");
}

main().catch((e) => { console.error(e); process.exit(1); });
