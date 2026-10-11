import fs from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("./keys/operator.json", "utf8"))));

async function main() {
  const balance = await connection.getBalance(operator.publicKey);
  console.log("Operator:", operator.publicKey.toBase58());
  console.log("Balance:", (balance / LAMPORTS_PER_SOL).toFixed(6), "SOL");
}

main();
