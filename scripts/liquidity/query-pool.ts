// Quick query to check the current pool state and price
import { Connection, PublicKey } from "@solana/web3.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dlmmSdk = require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
const DLMM = ((dlmmSdk as unknown as { default?: typeof dlmmSdk.default }).default ?? dlmmSdk) as typeof dlmmSdk.default;

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const poolAddress = new PublicKey("4RwMsu8xgPxsa4M3qi14suXDakEHschkMbaqNLySGd2N");

async function main() {
  try {
    console.log("Querying pool:", poolAddress.toBase58());
    const pool = await DLMM.create(connection, poolAddress, { cluster: "devnet" });
    
    console.log("\n=== POOL INFO ===");
    console.log("Active bin:", pool.lbPair.activeId);
    console.log("Bin step:", pool.lbPair.binStep);
    
    // Get the price from the active bin
    const activeBin = await pool.getActiveBin();
    console.log("\n=== ACTIVE BIN ===");
    console.log("Bin ID:", pool.lbPair.activeId);
    console.log("Price per lamport:", activeBin?.price || "N/A");
    console.log("X liquidity (token):", activeBin?.xAmount || "N/A");
    console.log("Y liquidity (SOL):", activeBin?.yAmount || "N/A");
    
    // Calculate price in SOL per token (assuming 6 decimals for token, 9 for SOL)
    if (activeBin?.price) {
      const pricePerLamport = parseFloat(activeBin.price);
      const pricePerSol = pricePerLamport * 1e9 / 1e6; // Convert lamport to SOL, adjust for token decimals
      console.log("\n=== PRICE ===");
      console.log("Price (SOL per token):", pricePerSol.toExponential(6));
      console.log("Price (SOL per token, decimal):", pricePerSol);
      console.log("Expected starting price: ~0.0000003 SOL/token");
    }
    
    // Try to get fee info
    console.log("\n=== FEE INFO ===");
    const feeInfo = pool.lbPair.protocolFee;
    console.log("Protocol fee:", feeInfo);
    
  } catch (error) {
    console.error("Error querying pool:", error);
  }
}

main();
