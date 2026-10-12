// Launch-pool positions: what's in them and what fees can be claimed. Written against @meteora-ag/dlmm 1.9.14.
//
//   npm run lp-fees                 show each position: $SLAB left, SOL taken in from buys (locked), and claimable fees
//   npm run lp-fees -- claim        claim all swap fees to the operator, then send them on to LIQUIDITY_MULTISIG
//
// The positions are owned by the operator wallet (see README "Mainnet launch"), so only the operator can claim.
// SOL that buyers paid stays inside the positions as liquidity and is locked until the lock release point;
// only swap fees can be claimed before then. Add DRY_RUN=1 to print without sending.
// Reads .env: RPC_URL, OPERATOR_KEYPAIR, TOKEN_MINT, LIQUIDITY_MULTISIG, CLUSTER (mainnet-beta).
import fs from "node:fs";
import { createRequire } from "node:module";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type Cluster } from "@solana/web3.js";
import { createTransferInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, getAccount } from "@solana/spl-token";
import { assertVaultAddress } from "./wallet-check.ts";

const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const DLMM = ((dlmmSdk as unknown as { default?: typeof dlmmSdk.default }).default ?? dlmmSdk) as typeof dlmmSdk.default;

const POOL = new PublicKey("HpWdga7dnyaMKszeoow98reTqcyDyuipzdfyJSBMmaGR");
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Set ${k}`); return v; };
const CLUSTER = (process.env.CLUSTER ?? "mainnet-beta") as Cluster;
const DRY = !!process.env.DRY_RUN;
const KEEP_FOR_GAS = 0.02 * LAMPORTS_PER_SOL; // the operator keeps this much SOL for transaction fees

const connection = new Connection(env("RPC_URL"), "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8"))));
const mint = new PublicKey(env("TOKEN_MINT"));
const slab = (raw: string | number | bigint) => (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 });
const sol = (raw: string | number | bigint) => (Number(raw) / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 6 });

async function load() {
  const pool = await DLMM.create(connection, POOL, { cluster: CLUSTER as "mainnet-beta" });
  const { userPositions } = await pool.getPositionsByUserAndLbPair(operator.publicKey);
  // Token X is $SLAB, token Y is SOL, as created by launch-pool.ts. Check rather than assume.
  const slabIsX = pool.tokenX.publicKey.equals(mint);
  return { pool, positions: userPositions, slabIsX };
}

async function status() {
  const { pool, positions, slabIsX } = await load();
  const active = await pool.getActiveBin();
  console.log(`Pool ${POOL.toBase58()}  price ${Number(active.pricePerToken).toExponential(4)} SOL per $SLAB`);
  console.log(`Positions owned by ${operator.publicKey.toBase58()}: ${positions.length}\n`);
  let tSlab = 0, tSol = 0, fSlab = 0, fSol = 0;
  for (const p of positions) {
    const d = p.positionData;
    const [inSlab, inSol] = slabIsX ? [d.totalXAmount, d.totalYAmount] : [d.totalYAmount, d.totalXAmount];
    const [feeSlab, feeSol] = slabIsX ? [d.feeX, d.feeY] : [d.feeY, d.feeX];
    tSlab += Number(inSlab); tSol += Number(inSol);
    fSlab += Number(feeSlab.toString()); fSol += Number(feeSol.toString());
    console.log(`${p.publicKey.toBase58()}  bins ${d.lowerBinId}..${d.upperBinId}  $SLAB left ${slab(inSlab)}  SOL from buys ${sol(inSol)}  fees ${sol(feeSol.toString())} SOL + ${slab(feeSlab.toString())} $SLAB`);
  }
  console.log(`\nTotal $SLAB still in the pool:   ${slab(tSlab)}`);
  console.log(`Total SOL from buys (LOCKED):    ${sol(tSol)}  (unlocks with the positions on 2027-04-10)`);
  console.log(`Claimable now (swap fees):       ${sol(fSol)} SOL + ${slab(fSlab)} $SLAB`);
}

async function claim() {
  const multisig = new PublicKey(env("LIQUIDITY_MULTISIG"));
  await assertVaultAddress(connection, multisig, "LIQUIDITY_MULTISIG");
  const { pool, positions } = await load();
  const solBefore = await connection.getBalance(operator.publicKey);
  const opAta = getAssociatedTokenAddressSync(mint, operator.publicKey);
  const slabBefore = await getAccount(connection, opAta).then((a) => a.amount).catch(() => 0n);

  let txs: Transaction[];
  try { txs = await pool.claimAllSwapFee({ owner: operator.publicKey, positions }); }
  catch (e) { console.log(String(e).includes("No fee") ? "No fees to claim yet." : String(e)); return; }
  console.log(`Claiming fees from ${positions.length} positions in ${txs.length} transaction(s)`);
  if (DRY) { console.log("DRY_RUN: not sending"); return; }
  for (const [i, tx] of txs.entries()) {
    const sig = await sendAndConfirmTransaction(connection, tx, [operator], { commitment: "confirmed" });
    console.log(`Claim ${i + 1}: ${sig}`);
  }

  // Forward exactly what the claim added, so the operator holds nothing beyond its gas money.
  const solGain = BigInt(await connection.getBalance(operator.publicKey)) - BigInt(solBefore);
  const slabGain = (await getAccount(connection, opAta).then((a) => a.amount).catch(() => 0n)) - slabBefore;
  const balance = BigInt(await connection.getBalance(operator.publicKey));
  const sendSol = solGain > 0n ? (balance - solGain >= BigInt(KEEP_FOR_GAS) ? solGain : (balance > BigInt(KEEP_FOR_GAS) ? balance - BigInt(KEEP_FOR_GAS) : 0n)) : 0n;
  const fwd = new Transaction();
  if (sendSol > 0n) fwd.add(SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: multisig, lamports: sendSol }));
  if (slabGain > 0n) {
    const dest = getAssociatedTokenAddressSync(mint, multisig, true);
    fwd.add(createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, dest, multisig, mint));
    fwd.add(createTransferInstruction(opAta, dest, operator.publicKey, slabGain));
  }
  if (!fwd.instructions.length) { console.log("Nothing to forward."); return; }
  const sig = await sendAndConfirmTransaction(connection, fwd, [operator], { commitment: "confirmed" });
  console.log(`Sent ${sol(sendSol)} SOL and ${slab(slabGain)} $SLAB to the Liquidity vault ${multisig.toBase58()}: ${sig}`);
}

const cmd = process.argv[2] ?? "status";
({ status, claim } as Record<string, () => Promise<void>>)[cmd]?.().catch((e) => { console.error(e); process.exit(1); })
  ?? console.log("Usage: npm run lp-fees [-- claim]");
