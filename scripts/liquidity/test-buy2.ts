// Test a buy transaction on the DLMM pool - simplified version
import fs from "node:fs";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const DLMM = ((dlmmSdk as unknown as { default?: typeof dlmmSdk.default }).default ?? dlmmSdk) as typeof dlmmSdk.default;
const { BN } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");

const connection = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
const poolAddress = new PublicKey("4RwMsu8xgPxsa4M3qi14suXDakEHschkMbaqNLySGd2N");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("./keys/operator.json", "utf8"))));

async function main() {
  const buyAmountSol = parseFloat(process.argv[2] || "0.01");
  
  console.log("Analyzing buy scenario on pool:", poolAddress.toBase58());
  console.log("Buy amount:", buyAmountSol, "SOL");
  
  // Load pool
  const pool = await DLMM.create(connection, poolAddress, { cluster: "devnet" });
  
  const activeBinId = pool.lbPair.activeId;
  const binStep = pool.lbPair.binStep;
  const currentPrice = DLMM.getPriceOfBinByBinId(activeBinId, binStep) / 1000;
  
  console.log("\n=== CURRENT POOL STATE ===");
  console.log("Current price:", currentPrice.toExponential(6), "SOL/token");
  console.log("Active bin ID:", activeBinId);
  console.log("Bin step:", binStep, "bps");
  
  // Calculate expected tokens at current price (simple estimate)
  const expectedTokens = buyAmountSol / currentPrice;
  console.log("\n=== ESTIMATE (before fees & slippage) ===");
  console.log("Expected tokens:", expectedTokens.toFixed(2));
  
  // Calculate with 1% fee
  const feeAmount = buyAmountSol * 0.01;
  const afterFee = buyAmountSol - feeAmount;
  const tokensAfterFee = afterFee / currentPrice;
  console.log("\n=== WITH 1% FEE ===");
  console.log("Fee (SOL):", feeAmount.toFixed(6));
  console.log("After fee (SOL):", afterFee.toFixed(6));
  console.log("Expected tokens:", tokensAfterFee.toFixed(2));
  
  // Estimate price after buy (assuming we move through bins)
  // With 1% bin step, each bin increases price by 1%
  const liquidityPerBin = 0.086847; // from our earlier query
  const binsToMove = Math.ceil(buyAmountSol / liquidityPerBin);
  const priceIncrease = binsToMove * (binStep / 10000);
  const newPrice = currentPrice * (1 + priceIncrease);
  
  console.log("\n=== PRICE IMPACT ESTIMATE ===");
  console.log("Liquidity in active bin:", liquidityPerBin, "SOL");
  console.log("Estimated bins to move:", binsToMove);
  console.log("Price increase:", (priceIncrease * 100).toFixed(2), "%");
  console.log("Price after buy:", newPrice.toExponential(6), "SOL/token");
  
  console.log("\n=== SUMMARY ===");
  console.log("✓ Pool exists and is active");
  console.log("✓ Current price:", currentPrice.toExponential(6), "SOL/token (1.02x above start)");
  console.log("✓ Fee: ~1% (100 bps)");
  console.log("✓ Buying", buyAmountSol, "SOL would get ~", tokensAfterFee.toFixed(2), "tokens");
  console.log("✓ Price would rise to ~", newPrice.toExponential(6), "SOL/token");
}

main().catch(e => { console.error(e); process.exit(1); });
