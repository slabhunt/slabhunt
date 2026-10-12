// Send spare SOL out of the operator wallet, always leaving a reserve for claims and fees.
//
//   npm run withdraw-sol -- <destination address>            sends everything above 0.1 SOL
//   npm run withdraw-sol -- <destination address> 0.5        sends 0.5 SOL (still refuses to go below 0.1)
//
// Reads .env: RPC_URL, OPERATOR_KEYPAIR. Add DRY_RUN=1 to print without sending.
import fs from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Set ${k}`); return v; };
const KEEP = Math.round(0.1 * LAMPORTS_PER_SOL);
const FEE = 10_000; // a little over one signature's fee

async function main() {
  const [to, amount] = process.argv.slice(2);
  if (!to) { console.log("Usage: npm run withdraw-sol -- <destination address> [SOL]"); return; }
  const dest = new PublicKey(to);
  if (!PublicKey.isOnCurve(dest.toBytes())) throw new Error("That address isn't a normal wallet (it's a program-owned address). Use your Phantom/Solflare address.");
  const connection = new Connection(env("RPC_URL"), "confirmed");
  const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8"))));
  const balance = await connection.getBalance(operator.publicKey);
  const spare = balance - KEEP - FEE;
  const lamports = amount ? Math.min(Math.round(Number(amount) * LAMPORTS_PER_SOL), spare) : spare;
  console.log(`Operator ${operator.publicKey.toBase58()} has ${balance / LAMPORTS_PER_SOL} SOL`);
  if (!(lamports > 0)) { console.log("Nothing to send: the wallet is at or below the 0.1 SOL reserve."); return; }
  console.log(`Sending ${lamports / LAMPORTS_PER_SOL} SOL to ${dest.toBase58()}, leaving about 0.1 SOL`);
  if (process.env.DRY_RUN) { console.log("DRY_RUN: not sending"); return; }
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: dest, lamports }));
  const sig = await sendAndConfirmTransaction(connection, tx, [operator], { commitment: "confirmed" });
  console.log(`Sent: https://solscan.io/tx/${sig}`);
  console.log(`Operator now has ${(await connection.getBalance(operator.publicKey)) / LAMPORTS_PER_SOL} SOL`);
}
main().catch((e) => { console.error(e); process.exit(1); });
