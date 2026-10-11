// Test a buy transaction on the DLMM pool
import fs from "node:fs";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
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
  const dryRun = process.env.DRY_RUN === "1";
  
  console.log("Testing buy transaction on pool:", poolAddress.toBase58());
  console.log("Buyer:", operator.publicKey.toBase58());
  console.log("Buy amount:", buyAmountSol, "SOL");
  console.log("Dry run:", dryRun);
  
  // Load pool
  const pool = await DLMM.create(connection, poolAddress, { cluster: "devnet" });
  
  const activeBinId = pool.lbPair.activeId;
  const binStep = pool.lbPair.binStep;
  const currentPrice = DLMM.getPriceOfBinByBinId(activeBinId, binStep) / 1000;
  
  console.log("\n=== BEFORE BUY ===");
  console.log("Current price:", currentPrice.toExponential(6), "SOL/token");
  console.log("Active bin:", activeBinId);
  
  // Get quote for buying with SOL
  const buyAmountLamports = new BN(Math.round(buyAmountSol * LAMPORTS_PER_SOL));
  
  try {
    // Get swap quote
    const swapQuote = await pool.swapQuote(
      buyAmountLamports,
      true, // swapForY = true means we're swapping X (SOL) for Y (token)
      new BN(10), // 0.1% slippage
      operator.publicKey
    );
    
    console.log("\n=== SWAP QUOTE ===");
    console.log("In amount (SOL):", buyAmountSol);
    console.log("Out amount (tokens, raw):", swapQuote.outAmount.toString());
    console.log("Out amount (tokens):", (parseFloat(swapQuote.outAmount.toString()) / 1e6).toFixed(2));
    console.log("Min out amount (tokens):", (parseFloat(swapQuote.minOutAmount.toString()) / 1e6).toFixed(2));
    console.log("Fee (lamports):", swapQuote.fee.toString());
    console.log("Fee (SOL):", (parseFloat(swapQuote.fee.toString()) / LAMPORTS_PER_SOL).toFixed(6));
    console.log("Fee (%):", ((parseFloat(swapQuote.fee.toString()) / parseFloat(buyAmountLamports.toString())) * 100).toFixed(2));
    console.log("Price impact (%):", swapQuote.priceImpact.toFixed(4));
    
    // Calculate effective price
    const tokensReceived = parseFloat(swapQuote.outAmount.toString()) / 1e6;
    const effectivePrice = buyAmountSol / tokensReceived;
    console.log("Effective price:", effectivePrice.toExponential(6), "SOL/token");
    console.log("Price after buy:", (currentPrice * (1 + swapQuote.priceImpact / 100)).toExponential(6), "SOL/token");
    
    if (!dryRun) {
      console.log("\n=== EXECUTING BUY ===");
      const swapTx = await pool.swap({
        inToken: pool.tokenX.publicKey, // SOL
        binArraysPubkey: swapQuote.binArraysPubkey,
        inAmount: buyAmountLamports,
        lbPair: pool.pubkey,
        user: operator.publicKey,
        minOutAmount: swapQuote.minOutAmount,
        outToken: pool.tokenY.publicKey, // Token
      });
      
      const sig = await sendAndConfirmTransaction(connection, swapTx, [operator], { commitment: "confirmed" });
      console.log("✅ Transaction confirmed:", sig);
      console.log("Explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    } else {
      console.log("\n⚠️  DRY RUN - No transaction sent");
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
