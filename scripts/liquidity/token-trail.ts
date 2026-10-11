// Shows exactly where the operator's tokens went: every transaction that touched the operator's
// token account, with each account's balance change for this mint.
//   npm run token-trail
import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TOKEN } from "./config.ts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const connection = new Connection(env("RPC_URL"), "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8")))).publicKey;
const mint = new PublicKey(env("TOKEN_MINT"));
const account = getAssociatedTokenAddressSync(mint, operator);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

async function main() {
  const sigs = (await connection.getSignaturesForAddress(account, { limit: 1000 })).reverse();
  console.log(`Operator token account ${account.toBase58()} for mint ${mint.toBase58()}: ${sigs.length} transactions\n`);
  let total = 0;
  for (const s of sigs) {
    let tx = null;
    for (let a = 0; a < 8 && !tx; a++) {
      try { tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }); }
      catch { await sleep(2000 * (a + 1)); }
    }
    await sleep(700);
    if (!tx?.meta) { console.log(`${s.signature.slice(0, 20)}…  (could not load)`); continue; }
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const pre = new Map((tx.meta.preTokenBalances ?? []).filter((b) => b.mint === mint.toBase58()).map((b) => [b.accountIndex, b]));
    const post = (tx.meta.postTokenBalances ?? []).filter((b) => b.mint === mint.toBase58());
    const lines: string[] = [];
    const seen = new Set<number>();
    for (const b of post) {
      seen.add(b.accountIndex);
      const d = (b.uiTokenAmount.uiAmount ?? 0) - (pre.get(b.accountIndex)?.uiTokenAmount.uiAmount ?? 0);
      if (Math.abs(d) > 0) {
        lines.push(`    ${keys[b.accountIndex]} (owner ${b.owner?.slice(0, 8)}…): ${fmt(d)}`);
        if (keys[b.accountIndex] === account.toBase58()) total += d;
      }
    }
    for (const [i, b] of pre) if (!seen.has(i)) lines.push(`    ${keys[i]} closed, had ${b.uiTokenAmount.uiAmount}`);
    const when = s.blockTime ? new Date(s.blockTime * 1000).toISOString().slice(11, 19) : "?";
    console.log(`${when}  ${tx.meta.err ? "FAILED" : "ok"}  ${s.signature.slice(0, 20)}…`);
    for (const l of lines) console.log(l);
  }
  console.log(`\nNet change to the operator's token account: ${fmt(total)} (supply ${TOKEN.totalSupply.toLocaleString()})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
