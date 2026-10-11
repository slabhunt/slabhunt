// Detailed pool query with proper price calculation
import { Connection, PublicKey } from "@solana/web3.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const DLMM = ((dlmmSdk as unknown as { default?: typeof dlmmSdk.default }).default ?? dlmmSdk) as typeof dlmmSdk.default;
const { BN } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const poolAddress = new PublicKey("4RwMsu8xgPxsa4M3qi14suXDakEHschkMbaqNLySGd2N");

async function main() {
  try {
    console.log("Querying pool:", poolAddress.toBase58());
    const pool = await DLMM.create(connection, poolAddress, { cluster: "devnet" });
    
    const activeBinId = pool.lbPair.activeId;
    const binStep = pool.lbPair.binStep;
    
    console.log("\n=== POOL INFO ===");
    console.log("Active bin ID:", activeBinId);
    console.log("Bin step:", binStep);
    
    // Get price from bin ID using SDK method
    const pricePerLamport = DLMM.getPriceOfBinByBinId(activeBinId, binStep);
    console.log("\n=== PRICE CALCULATION ===");
    console.log("Price per lamport (from bin ID):", pricePerLamport);
    
    // Convert to SOL per token
    // Token has 6 decimals, SOL has 9 decimals
    // pricePerLamport is the price of 1 token (in base units) in lamports
    // So 1 token (1e6 base units) costs pricePerLamport * 1e6 lamports
    // In SOL: (pricePerLamport * 1e6) / 1e9 = pricePerLamport * 1e-3
    const priceInSol = pricePerLamport / 1000;
    
    console.log("Price (SOL per token):", priceInSol);
    console.log("Price (SOL per token, scientific):", priceInSol.toExponential(6));
    console.log("Expected starting price: 0.0000003 SOL/token");
    console.log("Price multiplier from start:", (priceInSol / 0.0000003).toFixed(2) + "x");
    
    // Get active bin details
    const activeBin = await pool.getActiveBin();
    if (activeBin) {
      console.log("\n=== ACTIVE BIN LIQUIDITY ===");
      const xAmount = new BN(activeBin.xAmount.toString());
      const yAmount = new BN(activeBin.yAmount.toString());
      console.log("X amount (token, raw):", xAmount.toString());
      console.log("Y amount (SOL, raw lamports):", yAmount.toString());
      console.log("X amount (token, decimal):", (parseFloat(xAmount.toString()) / 1e6).toFixed(2));
      console.log("Y amount (SOL, decimal):", (parseFloat(yAmount.toString()) / 1e9).toFixed(6));
    }
    
  } catch (error) {
    console.error("Error querying pool:", error);
  }
}

main();
