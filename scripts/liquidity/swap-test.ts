// DEVNET ONLY: buys a little of the token with SOL from the operator wallet and reports the price
// before and after, the fee, and the tokens received.
//   npm run swap-test -- 0.1        (SOL to spend, default 0.1)
import fs from "node:fs";
import { createRequire } from "node:module";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, type Cluster } from "@solana/web3.js";
import { TOKEN, WSOL_MINT } from "./config.ts";

const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const DLMM = ((dlmmSdk as unknown as { default?: typeof dlmmSdk.default }).default ?? dlmmSdk) as typeof dlmmSdk.default;
const { LBCLMM_PROGRAM_IDS, deriveCustomizablePermissionlessLbPair } = dlmmSdk;
const { BN } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const CLUSTER = (process.env.CLUSTER ?? "devnet") as Cluster;
if (CLUSTER === "mainnet-beta") throw new Error("swap-test is for devnet only");
const connection = new Connection(env("RPC_URL"), "confirmed");
const user = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8"))));
const tokenMint = new PublicKey(env("TOKEN_MINT"));
const solMint = new PublicKey(WSOL_MINT);
const opt = { cluster: CLUSTER };

async function main() {
  const solIn = Number(process.argv[2] || "0.1");
  const [pairKey] = deriveCustomizablePermissionlessLbPair(tokenMint, solMint, new PublicKey(LBCLMM_PROGRAM_IDS[CLUSTER as keyof typeof LBCLMM_PROGRAM_IDS]));
  const pair = await DLMM.create(connection, pairKey, opt);
  const priceNow = async () => Number((await pair.getActiveBin()).pricePerToken);

  const before = await priceNow();
  console.log(`Pool ${pairKey.toBase58()}`);
  console.log(`Price before: ${before.toExponential(4)} SOL per token (start was 3.0000e-7)`);

  const inAmount = new BN(Math.round(solIn * LAMPORTS_PER_SOL));
  const swapForY = false; // spend SOL (Y), receive the token (X)
  const binArrays = await pair.getBinArrayForSwap(swapForY);
  const quote = pair.swapQuote(inAmount, swapForY, new BN(100), binArrays);
  console.log(`Quote: ${solIn} SOL -> ${(Number(quote.outAmount.toString()) / 10 ** TOKEN.decimals).toLocaleString()} tokens`);
  console.log(`Fee: ${Number(quote.fee.toString()) / LAMPORTS_PER_SOL} SOL (${((Number(quote.fee.toString()) / Number(inAmount.toString())) * 100).toFixed(2)}% of the amount in), of which protocol ${Number(quote.protocolFee.toString()) / LAMPORTS_PER_SOL} SOL`);

  const tx = await pair.swap({
    inToken: solMint, outToken: tokenMint, inAmount, minOutAmount: quote.minOutAmount,
    lbPair: pair.pubkey, user: user.publicKey, binArraysPubkey: quote.binArraysPubkey,
  });
  const sig = await sendAndConfirmTransaction(connection, tx, [user], { commitment: "confirmed" });
  console.log(`Swap: ${sig}`);
  await pair.refetchStates();
  const after = await priceNow();
  console.log(`Price after: ${after.toExponential(4)} SOL per token (${(((after - before) / before) * 100).toFixed(2)}% move)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
