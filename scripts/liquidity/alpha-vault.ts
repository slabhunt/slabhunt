// Fair-start Alpha Vault for the $VDRAKE launch pool. Written against @meteora-ag/alpha-vault 1.1.16.
//
//   npm run vault -- create          create the pro-rata vault (must happen before trading opens)
//   npm run vault -- status          show the vault's windows, deposits and state
//   npm run vault -- deposit 0.5     test deposit of 0.5 SOL from the operator wallet (devnet only)
//   npm run vault -- fill            buy from the pool with the deposits (after deposits close, before trading opens)
//
// Reads .env (RPC_URL, CLUSTER, OPERATOR_KEYPAIR, TOKEN_MINT, LAUNCH_TIME). The operator created the pool,
// so the program only lets a vault owned by the operator buy early; it holds no one else's funds.
// Add DRY_RUN=1 to print without sending.
import fs from "node:fs";
import { createRequire } from "node:module";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, type Cluster, type Transaction } from "@solana/web3.js";
import { LAUNCH, WSOL_MINT } from "./config.ts";

// Same CommonJS loading as launch-pool.ts (the SDKs' ESM builds import { BN } from anchor, which Node rejects).
const require = createRequire(import.meta.url);
const avSdk = require("@meteora-ag/alpha-vault") as typeof import("@meteora-ag/alpha-vault");
const AlphaVault = ((avSdk as unknown as { default?: typeof avSdk.default }).default ?? avSdk) as typeof avSdk.default;
const { PoolType, WhitelistMode, PROGRAM_ID, deriveAlphaVault } = avSdk;
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const { LBCLMM_PROGRAM_IDS, deriveCustomizablePermissionlessLbPair } = dlmmSdk;
const { BN } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const CLUSTER = (process.env.CLUSTER ?? "devnet") as Cluster;
const DRY = !!process.env.DRY_RUN;
const connection = new Connection(env("RPC_URL"), "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8"))));
const tokenMint = new PublicKey(env("TOKEN_MINT"));
const solMint = new PublicKey(WSOL_MINT);
const opt = { cluster: CLUSTER };

const [pool] = deriveCustomizablePermissionlessLbPair(tokenMint, solMint, new PublicKey(LBCLMM_PROGRAM_IDS[CLUSTER as keyof typeof LBCLMM_PROGRAM_IDS]));
const [vault] = deriveAlphaVault(operator.publicKey, pool, new PublicKey(PROGRAM_ID[CLUSTER as keyof typeof PROGRAM_ID]));
const iso = (t: number) => new Date(t * 1000).toISOString();

async function send(tx: Transaction, label: string) {
  if (DRY) { console.log(`DRY_RUN: would send ${label}`); return; }
  const sig = await sendAndConfirmTransaction(connection, tx, [operator], { commitment: "confirmed" });
  console.log(`${label}: ${sig}`);
}

async function create() {
  if (await connection.getAccountInfo(vault)) { console.log(`Vault already exists: ${vault.toBase58()}`); return; }
  const launchTs = Math.floor(new Date(env("LAUNCH_TIME")).getTime() / 1000);
  const v = LAUNCH.alphaVault;
  const startVesting = launchTs + v.vestingStartsAfterMinutes * 60;
  const endVesting = startVesting + v.vestingHours * 3600;
  console.log(`Pool ${pool.toBase58()}`);
  console.log(`Vault ${vault.toBase58()} (pro-rata, buys up to ${v.maxSol} SOL)`);
  console.log(`Deposits open now and close about 5 minutes before the vault buys, ahead of trading at ${iso(launchTs)}`);
  console.log(`Vault buyers' tokens unlock from ${iso(startVesting)} to ${iso(endVesting)}`);
  const tx = await AlphaVault.createCustomizableProrataVault(connection, {
    quoteMint: solMint,
    baseMint: tokenMint,
    poolAddress: pool,
    poolType: PoolType.DLMM,
    depositingPoint: new BN(Math.floor(Date.now() / 1000)),
    startVestingPoint: new BN(startVesting),
    endVestingPoint: new BN(endVesting),
    maxBuyingCap: new BN(v.maxSol).mul(new BN(LAMPORTS_PER_SOL)),
    escrowFee: new BN(0),
    whitelistMode: WhitelistMode.Permissionless,
  }, operator.publicKey, opt);
  await send(tx, "Created vault");
}

async function status() {
  const av = await AlphaVault.create(connection, vault, opt);
  const p = av.vaultPoint;
  console.log(`Vault ${vault.toBase58()} for pool ${pool.toBase58()}`);
  console.log(`Mode ${av.mode}, state ${av.vaultState}`);
  console.log(`Deposits ${iso(p.firstJoinPoint)} to ${iso(p.lastJoinPoint)}, buying until ${iso(p.lastBuyingPoint)}`);
  console.log(`Unlock ${iso(p.startVestingPoint)} to ${iso(p.endVestingPoint)}`);
  console.log(`Deposited ${av.vault.totalDeposit.toNumber() / LAMPORTS_PER_SOL} SOL, cap ${av.vault.maxBuyingCap.toNumber() / LAMPORTS_PER_SOL} SOL, bought with ${av.vault.swappedAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
}

async function deposit(sol: number) {
  if (CLUSTER === "mainnet-beta") throw new Error("Test deposits are for devnet only");
  const av = await AlphaVault.create(connection, vault, opt);
  await send(await av.deposit(new BN(Math.round(sol * LAMPORTS_PER_SOL)), operator.publicKey), `Deposited ${sol} SOL`);
}

async function fill() {
  const av = await AlphaVault.create(connection, vault, opt);
  for (let round = 1; round <= 50; round++) {
    const tx = await av.fillVault(operator.publicKey);
    if (!tx) { console.log("Nothing left to buy."); break; }
    await send(tx, `Fill ${round}`);
    if (DRY) break;
    await av.refreshState();
    const cap = av.vault.totalDeposit.lt(av.vault.maxBuyingCap) ? av.vault.totalDeposit : av.vault.maxBuyingCap;
    if (cap.eq(av.vault.swappedAmount)) { console.log("Vault has bought its full amount."); break; }
  }
}

const [cmd, arg] = process.argv.slice(2);
const run = { create, status, fill, deposit: () => deposit(Number(arg || "0.5")) }[cmd as "create"];
if (!run) { console.log("Usage: npm run vault -- create | status | deposit <SOL> | fill"); process.exit(1); }
run().catch((e) => { console.error(e); process.exit(1); });
