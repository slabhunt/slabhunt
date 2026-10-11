// Vault Hunt fair draws: runs every minute from the database scheduler (pg_cron), authenticated by a secret header.
//   1. Freeze Vault Draws whose time is up, and open the next weekly draws from the vault.
//   2. For each frozen draw: post its entry-list hash to Solana in a memo, naming a drand round ~60 s ahead.
//   3. When that round is out: fetch it, check it, and let the database pick the winner (same math as /verify).
// The memo is paid by a fee-only "draw wallet" (secret FAIRDRAW_KEYPAIR: a solana-keygen JSON array, or a base58
// private key exported from Phantom/Solflare). It holds a little SOL
// and nothing else. If it isn't set yet, draws still settle with drand, just without the on-chain timestamp.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "npm:@solana/web3.js@1.98.0";
import bs58 from "npm:bs58@6.0.0";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const DRAND = {
  name: "quicknet",
  chain: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesis: 1692803367,
  period: 3,
  urls: ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh"],
};
const LEAD_ROUNDS = 20; // ~60 seconds after the commitment

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const roundAt = (unix: number) => Math.floor((unix - DRAND.genesis) / DRAND.period) + 1;
const timeOf = (round: number) => DRAND.genesis + (round - 1) * DRAND.period;

function rpcUrl(cluster: string) {
  const key = Deno.env.get("HELIUS_API_KEY");
  const main = cluster === "mainnet-beta";
  return key ? `https://${main ? "mainnet" : "devnet"}.helius-rpc.com/?api-key=${key}` : main ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

function drawWallet(): Keypair | null {
  const raw = Deno.env.get("FAIRDRAW_KEYPAIR");
  if (!raw) return null;
  try {
    const t = raw.trim();
    return Keypair.fromSecretKey(t.startsWith("[") ? Uint8Array.from(JSON.parse(t)) : bs58.decode(t));
  } catch { return null; }
}

/** Post a memo and wait for it to confirm. Returns the signature and the block time. */
async function postMemo(cluster: string, payer: Keypair, text: string) {
  const conn = new Connection(rpcUrl(cluster), "confirmed");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer.publicKey, recentBlockhash: blockhash,
    instructions: [new TransactionInstruction({ programId: MEMO, keys: [], data: new TextEncoder().encode(text) })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  const sig = await conn.sendTransaction(tx, { maxRetries: 3 });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error("memo failed");
  const status = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return { sig, blockTime: status?.blockTime ?? Math.floor(Date.now() / 1000) };
}

/** Fetch a drand round and check randomness = sha256(signature). Null if it isn't out yet. */
async function fetchBeacon(round: number): Promise<{ randomness: string; signature: string } | null> {
  for (const base of DRAND.urls) {
    try {
      const r = await fetch(`${base}/${DRAND.chain}/public/${round}`);
      if (r.status === 404 || r.status === 425) return null;
      if (!r.ok) continue;
      const b = await r.json();
      if (Number(b.round) !== round || !/^[0-9a-f]+$/.test(b.signature ?? "")) continue;
      const rnd = hex(await crypto.subtle.digest("SHA-256", unhex(b.signature)));
      if (rnd !== b.randomness) continue; // relay returned something inconsistent; try another
      return { randomness: rnd, signature: b.signature };
    } catch { /* try the next relay */ }
  }
  return null;
}

/** Season Pass reveal: shuffle the tier deck with the drand randomness and deal it to minted passes in address
 *  order. The exact same steps run in the browser on /verify. */
async function dealTiers(randomness: string, split: number[], assets: string[]) {
  const deck = split.flatMap((c, t) => Array(c).fill(t + 1) as number[]);
  let counter = 0;
  for (let i = deck.length - 1; i > 0; i--) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${randomness}:${counter++}`)));
    const j = (((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3]) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const sorted = [...assets].sort();
  return sorted.slice(0, deck.length).map((asset, position) => ({ asset, position, tier: deck[position] }));
}

/** Every asset in a collection, via Helius DAS. */
async function collectionAssets(cluster: string, collection: string): Promise<string[] | null> {
  const key = Deno.env.get("HELIUS_API_KEY");
  if (!key) return null;
  const url = `https://${cluster === "mainnet-beta" ? "mainnet" : "devnet"}.helius-rpc.com/?api-key=${key}`;
  const out: string[] = [];
  for (let page = 1; page < 20; page++) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetsByGroup", params: { groupKey: "collection", groupValue: collection, page, limit: 1000 } }) });
    if (!r.ok) return null;
    const items = (await r.json())?.result?.items ?? [];
    out.push(...items.filter((i: { burnt?: boolean }) => !i.burnt).map((i: { id: string }) => i.id));
    if (items.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Only the scheduler may call this: it sends a secret kept in the database vault.
  const secret = req.headers.get("x-cron-secret") ?? "";
  const { data: ok } = await admin.rpc("cron_secret_ok", { p_secret: secret });
  if (ok !== true) return json({ error: "forbidden" }, 403);

  const log: unknown[] = [];
  await admin.rpc("settle_vault_draws");
  const { data: opened } = await admin.rpc("auto_open_vault_draws");
  if (opened) log.push({ opened });

  const { data: cfg } = await admin.from("game_config").select("token_cluster").maybeSingle();
  const cluster = cfg?.token_cluster === "mainnet-beta" ? "mainnet-beta" : "devnet";
  const payer = drawWallet();
  const now = Math.floor(Date.now() / 1000);

  const { data: pending } = await admin.rpc("fair_pending");
  for (const d of (pending ?? []) as { id: number; kind: string; ref: number; status: string; hash: string; total: number; drand_round: number | null }[]) {
    try {
      if (d.status === "frozen") {
        // Pick the round only now, so it is always in the future when the commitment lands.
        const round = roundAt(Math.floor(Date.now() / 1000)) + LEAD_ROUNDS;
        let tx: string | null = null;
        if (payer) {
          const memo = `vaulthunt:fairdraw:v1 id=${d.id} ${d.kind}=${d.ref} entries=${d.hash} total=${d.total} drand=${DRAND.name}:${round}`;
          const res = await postMemo(cluster, payer, memo);
          if (res.blockTime >= timeOf(round)) { log.push({ id: d.id, late: true }); continue; } // landed too late: try again next minute
          tx = res.sig;
        }
        await admin.rpc("fair_mark_committed", { p_id: d.id, p_cluster: payer ? cluster : null, p_tx: tx, p_chain: DRAND.chain, p_round: round });
        log.push({ id: d.id, committed: round, onchain: !!tx });
      } else if (d.status === "committed" && d.drand_round && now >= timeOf(d.drand_round)) {
        const beacon = await fetchBeacon(d.drand_round);
        if (!beacon) continue;
        const { data: res, error } = await admin.rpc("fair_settle", { p_id: d.id, p_randomness: beacon.randomness });
        if (error) { log.push({ id: d.id, error: error.message }); continue; }
        log.push({ id: d.id, settled: res });
        if (payer) {
          try {
            const r = res as { winner_code: string; ticket: number };
            const out = await postMemo(cluster, payer, `vaulthunt:fairdraw:v1 result id=${d.id} drand=${DRAND.name}:${d.drand_round} ticket=${r.ticket} winner=${r.winner_code}`);
            await admin.rpc("fair_mark_result_tx", { p_id: d.id, p_tx: out.sig });
          } catch { /* the result is already final; the memo is a courtesy copy */ }
        }
      }
    } catch (e) {
      log.push({ id: d.id, error: String(e).slice(0, 200) });
    }
  }

  // Season Pass reveals: once a pass season has started and its drand round is out, deal the tiers.
  const { data: reveals } = await admin.rpc("pass_reveals_due");
  for (const r of (reveals ?? []) as { id: number; collection: string; reveal_round: number; split: number[] }[]) {
    try {
      if (now < timeOf(r.reveal_round)) continue;
      const beacon = await fetchBeacon(r.reveal_round);
      if (!beacon) continue;
      const assets = await collectionAssets(cluster, r.collection);
      if (!assets) { log.push({ reveal: r.id, error: "no_asset_list" }); continue; }
      const dealt = await dealTiers(beacon.randomness, r.split, assets);
      const { data: n, error } = await admin.rpc("store_pass_reveal", { p_season: r.id, p_randomness: beacon.randomness, p_assets: dealt });
      log.push({ reveal: r.id, passes: n, error: error?.message });
      if (payer && !error) {
        try {
          await postMemo(cluster, payer, `vaulthunt:passreveal:v1 season=${r.id} collection=${r.collection} drand=${DRAND.name}:${r.reveal_round} passes=${dealt.length}`);
        } catch { /* courtesy copy */ }
      }
    } catch (e) { log.push({ reveal: r.id, error: String(e).slice(0, 200) }); }
  }

  // Hourly: unlink NFT passes whose verified wallet no longer holds them (sold or moved).
  if (new Date().getUTCMinutes() === 37) {
    const key = Deno.env.get("HELIUS_API_KEY");
    const { data: links } = await admin.rpc("pass_links_to_check");
    const list = (links ?? []) as { user_id: string; season_id: number; asset: string; wallet: string | null }[];
    if (key && list.length) {
      try {
        const url = `https://${cluster === "mainnet-beta" ? "mainnet" : "devnet"}.helius-rpc.com/?api-key=${key}`;
        let unlinked = 0;
        for (let i = 0; i < list.length; i += 1000) {
          const part = list.slice(i, i + 1000);
          const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetBatch", params: { ids: part.map((x) => x.asset) } }) });
          if (!r.ok) break;
          const items = ((await r.json())?.result ?? []) as ({ id: string; ownership?: { owner?: string }; burnt?: boolean } | null)[];
          for (const link of part) {
            const it = items.find((x) => x?.id === link.asset);
            if (!it) continue; // unknown right now: leave it
            if (it.burnt || !link.wallet || it.ownership?.owner !== link.wallet) {
              await admin.rpc("unlink_season_pass", { p_user: link.user_id, p_season: link.season_id, p_asset: link.asset });
              unlinked++;
            }
          }
        }
        log.push({ pass_check: list.length, unlinked });
      } catch (e) { log.push({ pass_check: String(e).slice(0, 120) }); }
    }
  }

  // Hourly: weekly holder rewards for verified wallets (handled by the wallet function).
  if (new Date().getUTCMinutes() === 7) {
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`, "x-cron-secret": secret },
        body: JSON.stringify({ action: "auto_holders" }),
      });
      log.push({ holders: r.status === 200 ? await r.json() : r.status });
    } catch (e) { log.push({ holders: String(e).slice(0, 120) }); }
  }

  return json({ ok: true, log });
});
