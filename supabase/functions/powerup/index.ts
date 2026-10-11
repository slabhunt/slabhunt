// Vault Hunt power-ups paid in $VDRAKE.
//   POST { action: "start", tier, wallet }        -> { purchase_id, tx }  (unsigned transaction, base64)
//   POST { action: "confirm", purchase_id, signature } -> { points } once the payment is checked on-chain
// One transaction pays for the power-up and splits it: a share is burned, the rest goes to the card vault,
// the map-drops treasury and the development multisig (percentages fixed when the purchase starts).
// The player signs in their own wallet; this function never holds keys.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
  type ParsedInstruction, type PartiallyDecodedInstruction,
} from "npm:@solana/web3.js@1.98.0";
import {
  createAssociatedTokenAccountIdempotentInstruction, createBurnCheckedInstruction, createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "npm:@solana/spl-token@0.4.9";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f-]{36}$/;

type Splits = { burn_pct: number; to: { key: string; wallet: string; pct: number }[] };
type Purchase = { id: string; user_id: string; price: string | number; cluster: string; mint: string; decimals: number; splits: Splits; status: string };

function rpcUrl(cluster: string) {
  const key = Deno.env.get("HELIUS_API_KEY");
  if (key) return `https://${cluster === "mainnet-beta" ? "mainnet" : "devnet"}.helius-rpc.com/?api-key=${key}`;
  return cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}

/** Whole-token price ("12.5") to raw units, without floating point. */
function toRaw(price: string | number, decimals: number): bigint {
  const [i, f = ""] = String(price).split(".");
  return BigInt((i || "0") + (f + "0".repeat(decimals)).slice(0, decimals));
}

/** Raw amount for each share; rounding leftovers are burned. */
function shares(p: Purchase) {
  const total = toRaw(p.price, p.decimals);
  const to = p.splits.to.map((t) => ({ ...t, amount: (total * BigInt(t.pct)) / 100n }));
  const burn = total - to.reduce((s, t) => s + t.amount, 0n);
  return { total, to, burn };
}

const b64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "signed_out" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { action?: string; tier?: number; wallet?: string; purchase_id?: string; signature?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  /* ---------- start: record the purchase and build the transaction for the player's wallet ---------- */
  if (body.action === "start") {
    const wallet = String(body.wallet ?? "");
    if (!ADDRESS.test(wallet)) return json({ error: "bad_wallet" }, 400);
    const { data: started, error } = await asUser.rpc("start_token_purchase", { p_tier: Number(body.tier) });
    if (error) return json({ error: "start_failed" }, 500);
    if (started?.error) return json({ error: started.error }, 400);

    const p = { id: started.purchase_id, user_id: user.id, price: started.price, cluster: started.cluster, mint: started.mint,
      decimals: started.decimals, splits: started.splits, status: "pending" } as Purchase;
    const conn = new Connection(rpcUrl(p.cluster), "confirmed");
    const payer = new PublicKey(wallet), mint = new PublicKey(p.mint);
    const from = getAssociatedTokenAddressSync(mint, payer);
    const { total, to, burn } = shares(p);

    // Enough $VDRAKE? (SOL for the network fee is checked by the wallet.)
    let have = 0n;
    try { have = BigInt((await conn.getTokenAccountBalance(from)).value.amount); } catch { have = 0n; }
    if (have < total) return json({ error: "balance", need: String(total), have: String(have), decimals: p.decimals }, 400);

    const ixs: TransactionInstruction[] = [];
    for (const t of to) {
      if (t.amount <= 0n) continue;
      const owner = new PublicKey(t.wallet);
      const dest = getAssociatedTokenAddressSync(mint, owner, true);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, dest, owner, mint));
      ixs.push(createTransferCheckedInstruction(from, mint, dest, payer, t.amount, p.decimals));
    }
    if (burn > 0n) ixs.push(createBurnCheckedInstruction(from, mint, payer, burn, p.decimals));
    ixs.push(new TransactionInstruction({ programId: MEMO, keys: [], data: new TextEncoder().encode(`vaulthunt:${p.id}`) }));

    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    return json({ purchase_id: p.id, tx: b64(tx.serialize()), cluster: p.cluster,
      split: { burn: String(burn), to: to.map((t) => ({ key: t.key, amount: String(t.amount) })) } });
  }

  /* ---------- confirm: check the payment on-chain, then add the points ---------- */
  if (body.action === "confirm") {
    const id = String(body.purchase_id ?? ""), sig = String(body.signature ?? "");
    if (!UUID.test(id) || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) return json({ error: "bad_input" }, 400);
    const { data: p } = await admin.from("token_purchases").select("*").eq("id", id).eq("user_id", user.id).maybeSingle<Purchase>();
    if (!p) return json({ error: "unknown" }, 404);
    if (p.status === "paid") return json({ points: 0, already: true });

    const conn = new Connection(rpcUrl(p.cluster), "confirmed");
    let tx = null;
    for (let i = 0; i < 10 && !tx; i++) {
      tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
      if (!tx) await sleep(2000);
    }
    if (!tx) return json({ error: "pending" }, 202);
    if (tx.meta?.err) return json({ error: "failed_on_chain" }, 400);

    const all: (ParsedInstruction | PartiallyDecodedInstruction)[] = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions),
    ];
    const parsed = all.filter((x): x is ParsedInstruction => "parsed" in x);
    const memoOk = parsed.some((x) => x.program === "spl-memo" && String(x.parsed) === `vaulthunt:${p.id}`);
    if (!memoOk) return json({ error: "wrong_payment" }, 400);

    const mint = new PublicKey(p.mint);
    const { to, burn } = shares(p);
    const tokenIx = parsed.filter((x) => x.program === "spl-token" && x.parsed?.info?.mint === p.mint);
    let payer = "";
    for (const t of to) {
      if (t.amount <= 0n) continue;
      const dest = getAssociatedTokenAddressSync(mint, new PublicKey(t.wallet), true).toBase58();
      const hit = tokenIx.find((x) => x.parsed.type === "transferChecked" && x.parsed.info.destination === dest
        && BigInt(x.parsed.info.tokenAmount.amount) >= t.amount);
      if (!hit) return json({ error: "wrong_payment", missing: t.key }, 400);
      payer = hit.parsed.info.authority ?? hit.parsed.info.multisigAuthority ?? payer;
    }
    if (burn > 0n && !tokenIx.some((x) => x.parsed.type === "burnChecked" && BigInt(x.parsed.info.tokenAmount.amount) >= burn)) {
      return json({ error: "wrong_payment", missing: "burn" }, 400);
    }

    const { data: credited, error } = await admin.rpc("credit_token_purchase", { p_id: p.id, p_signature: sig, p_payer: payer });
    if (error) return json({ error: "credit_failed" }, 500);
    if (credited?.error) return json({ error: credited.error }, 400);
    return json(credited);
  }

  return json({ error: "action" }, 400);
});
