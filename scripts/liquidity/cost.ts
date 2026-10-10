// Measures exactly what the launch cost, from the operator wallet's own transaction history.
//   npm run cost
// Prints every transaction the operator paid for, the SOL it spent (network fee + rent for new accounts),
// and the totals. Airdrops and incoming transfers are listed but not counted as cost.
import fs from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const connection = new Connection(env("RPC_URL"), "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8")))).publicKey;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(6);

async function main() {
  const sigs = (await connection.getSignaturesForAddress(operator, { limit: 1000 })).reverse();
  let fees = 0, spent = 0, received = 0, failed = 0;
  console.log(`Operator ${operator.toBase58()}: ${sigs.length} transactions\n`);
  console.log("time (UTC)            status  fee (SOL)   change (SOL)  signature");
  for (let i = 0; i < sigs.length; i += 20) {
    const batch = sigs.slice(i, i + 20);
    const txs = await connection.getParsedTransactions(batch.map((s) => s.signature), { maxSupportedTransactionVersion: 0 });
    txs.forEach((tx, k) => {
      if (!tx?.meta) return;
      const idx = tx.transaction.message.accountKeys.findIndex((a) => a.pubkey.equals(operator));
      const change = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
      const payer = tx.transaction.message.accountKeys[0].pubkey.equals(operator);
      const fee = payer ? tx.meta.fee : 0;
      if (tx.meta.err) failed++;
      if (change > 0) received += change; else { spent += -change; fees += fee; }
      const t = batch[k].blockTime ? new Date(batch[k].blockTime! * 1000).toISOString().slice(0, 19) : "?";
      console.log(`${t}  ${tx.meta.err ? "FAILED" : "ok    "}  ${sol(fee)}  ${(change >= 0 ? "+" : "") + sol(change)}  ${batch[k].signature.slice(0, 20)}…`);
    });
    await sleep(400);
  }
  console.log(`\nReceived (airdrops/transfers in): ${sol(received)} SOL`);
  console.log(`Spent: ${sol(spent)} SOL`);
  console.log(`  network fees: ${sol(fees)} SOL (${failed} failed transactions)`);
  console.log(`  rent for new accounts (mint, metadata, token accounts, pool, bins, positions, vault): ${sol(spent - fees)} SOL`);
  console.log(`Balance now: ${sol(await connection.getBalance(operator))} SOL`);
}

main().catch((e) => { console.error(e); process.exit(1); });
