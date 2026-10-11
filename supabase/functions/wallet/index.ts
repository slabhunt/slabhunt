// Vault Hunt wallet function.
//   POST { action: "link", address, signature }  -> verify a signed challenge and link the wallet
//   POST { action: "check_pass" }                -> look for the current season's pass NFT and switch the pass on
//   POST { action: "claim_holder" }              -> weekly Power Cells for holding $VDRAKE / Vault Hunt NFTs
// Signing a message moves no funds. Pass ownership is read from the Helius DAS API (secret HELIUS_API_KEY).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import nacl from "npm:tweetnacl@1.0.3";
import bs58 from "npm:bs58@6.0.0";
import { PublicKey } from "npm:@solana/web3.js@1.98.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Solana Name Service, read straight from the chain (no third-party lookup service).
const SNS_PROGRAM = new PublicKey("namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX");
const SOL_TLD = new PublicKey("58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx");

function mainnetRpc() {
  const key = Deno.env.get("HELIUS_API_KEY");
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
}

/** "dubie" -> the wallet that owns dubie.sol, or null if nobody registered it. */
async function resolveSol(label: string): Promise<string | null> {
  const hashed = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("SPL Name Service" + label)));
  const [account] = PublicKey.findProgramAddressSync([hashed, new Uint8Array(32), SOL_TLD.toBytes()], SNS_PROGRAM);
  const r = await fetch(mainnetRpc(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [account.toBase58(), { encoding: "base64" }] }),
  });
  if (!r.ok) throw new Error("rpc " + r.status);
  const data = (await r.json())?.result?.value?.data?.[0];
  if (!data) return null;
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (bytes.length < 64) return null;
  // Name account header: parent (32 bytes), owner (32 bytes), class (32 bytes).
  return new PublicKey(bytes.slice(32, 64)).toBase58();
}

// ---------- Holder rewards ----------
const HOLDER_COLS = "holder_rewards_enabled, holder_tiers, holder_nft_collections, holder_cells_per_nft, holder_max_nft_cells, holder_min_hold_hours, token_mint, token_cluster";
type HolderCfg = {
  holder_rewards_enabled: boolean; holder_tiers: { min: number; cells: number }[]; holder_nft_collections: string[];
  holder_cells_per_nft: number; holder_max_nft_cells: number; holder_min_hold_hours: number; token_mint: string | null; token_cluster: string;
};
class Busy extends Error {}

function clusterRpc(cluster: string) {
  const key = Deno.env.get("HELIUS_API_KEY");
  const main = cluster === "mainnet-beta";
  return key ? `https://${main ? "mainnet" : "devnet"}.helius-rpc.com/?api-key=${key}` : main ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}
async function rpcCall(rpc: string, method: string, params: unknown) {
  const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!r.ok) throw new Error("rpc " + r.status);
  const out = await r.json();
  if (out.error) throw new Error(out.error.message ?? "rpc");
  return out.result;
}
async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

/** Lowest $VDRAKE balance the wallet had at any moment in the last `hours` (0 = current balance).
 *  Reads every token-account transaction in the window; a token account opened inside the window counts as 0 before it. */
async function heldBalance(rpc: string, owner: string, mint: string, hours: number): Promise<number> {
  const res = await rpcCall(rpc, "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
  const accounts: { pubkey: string; amount: number }[] = (res?.value ?? []).map((a: any) => ({
    pubkey: a.pubkey, amount: Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0) }));
  if (hours <= 0) return accounts.reduce((s, a) => s + a.amount, 0);
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  let total = 0;
  for (const acc of accounts) {
    const sigs: { signature: string; blockTime: number | null }[] = await rpcCall(rpc, "getSignaturesForAddress", [acc.pubkey, { limit: 100 }]);
    const recent = sigs.filter((s) => (s.blockTime ?? 0) >= since);
    if (recent.length === 100) throw new Busy();                    // too much activity to check this window
    if (sigs.length > 0 && sigs.length < 100 && (sigs[sigs.length - 1].blockTime ?? 0) >= since) continue; // opened inside the window
    let low = acc.amount;
    const txs = await inBatches(recent, 8, (s) => rpcCall(rpc, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]));
    for (const tx of txs) {
      if (!tx) continue;
      const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k.pubkey));
      const idx = keys.indexOf(acc.pubkey);
      if (idx < 0) continue;
      const amt = (list: any[]) => Number(list?.find((b: any) => b.accountIndex === idx)?.uiTokenAmount?.uiAmount ?? 0);
      low = Math.min(low, amt(tx.meta?.preTokenBalances), amt(tx.meta?.postTokenBalances));
    }
    total += Math.max(0, low);
  }
  return total;
}

/** Vault Hunt NFTs in the wallet that haven't moved in the last `hours`, up to `want`. Needs Helius (DAS). */
async function heldNfts(owner: string, collections: string[], hours: number, want: number): Promise<number> {
  const key = Deno.env.get("HELIUS_API_KEY");
  if (!key || !collections.length || want <= 0) return 0;
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  let count = 0;
  for (const c of collections) {
    const res = await rpcCall(rpc, "searchAssets", { ownerAddress: owner, grouping: ["collection", c], page: 1, limit: 20 });
    for (const asset of res?.items ?? []) {
      if (count >= want) return count;
      if (hours > 0) {
        const sigs = await rpcCall(rpc, "getSignaturesForAsset", { id: asset.id, page: 1, limit: 1 });
        const last = sigs?.items?.[0]?.[0];
        if (last) {
          const tx = await rpcCall(rpc, "getTransaction", [last, { encoding: "json", maxSupportedTransactionVersion: 0 }]);
          if ((tx?.blockTime ?? 0) >= since) continue;             // moved or minted inside the window
        }
      }
      count++;
    }
  }
  return count;
}

/** Work out and credit this week's cells for one wallet. Used by the claim button and the weekly auto-credit. */
async function creditHolder(admin: any, cfg: HolderCfg, userId: string, wallet: string) {
  const hours = cfg.holder_min_hold_hours ?? 24;
  let balance = 0, nfts = 0;
  try {
    if (cfg.token_mint) balance = await heldBalance(clusterRpc(cfg.token_cluster), wallet, cfg.token_mint, hours);
    const perNft = Math.max(1, cfg.holder_cells_per_nft ?? 1);
    const cols = (cfg.holder_nft_collections ?? []).filter((c) => ADDRESS.test(c));
    nfts = await heldNfts(wallet, cols, hours, Math.ceil((cfg.holder_max_nft_cells ?? 3) / perNft));
  } catch (e) {
    return { status: e instanceof Busy ? "busy" : "lookup_failed" };
  }
  const tiers = Array.isArray(cfg.holder_tiers) ? cfg.holder_tiers : [];
  const tierCells = tiers.filter((t) => balance >= Number(t.min)).reduce((m, t) => Math.max(m, Number(t.cells) || 0), 0);
  const nftCells = Math.min(nfts * (cfg.holder_cells_per_nft ?? 1), cfg.holder_max_nft_cells ?? 3);
  const cells = Math.floor(tierCells + nftCells);
  if (cells < 1) return { status: "not_holding", balance, nfts, hours };
  const { data: res, error } = await admin.rpc("credit_holder_reward", { p_user: userId, p_wallet: wallet, p_balance: balance, p_nfts: nfts, p_cells: cells });
  if (error) return { status: "grant_failed" };
  if ((res as { error?: string })?.error === "claimed") return { status: "claimed" };
  return { status: "credited", cells, balance, nfts, hours };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Scheduler only: credit this week's holder rewards automatically (a few wallets per run).
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret) {
    const svc = createClient(url, service);
    const { data: ok } = await svc.rpc("cron_secret_ok", { p_secret: cronSecret });
    if (ok !== true) return json({ error: "forbidden" }, 403);
    const { data: cfg } = await svc.from("game_config").select(HOLDER_COLS).maybeSingle();
    if (!cfg?.holder_rewards_enabled) return json({ skipped: "off" });
    const { data: list } = await svc.rpc("holder_auto_candidates", { p_limit: 15 });
    const done: Record<string, number> = {};
    for (const c of (list ?? []) as { user_id: string; address: string }[]) {
      const out = await creditHolder(svc, cfg as HolderCfg, c.user_id, c.address);
      await svc.rpc("holder_mark_checked", { p_user: c.user_id, p_status: out.status });
      done[out.status] = (done[out.status] ?? 0) + 1;
    }
    return json({ checked: (list ?? []).length, done });
  }

  // Who is calling?
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "signed_out" }, 401);
  const admin = createClient(url, service);

  let body: { action?: string; address?: string; signature?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  // Resolve a Solana Name Service domain (e.g. "dubie.sol") to the wallet address it points to.
  if (body.action === "resolve") {
    const raw = String((body as { name?: string }).name ?? "").trim().toLowerCase();
    const label = raw.replace(/\.sol$/, "");
    if (!/^[a-z0-9-_]{1,64}$/.test(label)) return json({ error: "bad_name" }, 400);
    try {
      const address = await resolveSol(label);
      if (!address || !ADDRESS.test(address)) return json({ error: "not_found" }, 404);
      return json({ name: `${label}.sol`, address });
    } catch {
      return json({ error: "lookup_failed" }, 502);
    }
  }

  if (body.action === "link") {
    const address = String(body.address ?? "");
    const signature = String(body.signature ?? "");
    if (!ADDRESS.test(address) || !signature) return json({ error: "bad_input" }, 400);

    const { data: n } = await admin.from("wallet_nonces").select("nonce, created_at").eq("user_id", user.id).maybeSingle();
    if (!n || Date.now() - new Date(n.created_at).getTime() > 10 * 60 * 1000) return json({ error: "expired" }, 400);

    const message = "Vault Hunt wants you to link this wallet to your player.\nThis does not move any funds.\nNonce: " + n.nonce;
    let ok = false;
    try {
      ok = nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(signature), bs58.decode(address));
    } catch { ok = false; }
    if (!ok) return json({ error: "bad_signature" }, 400);

    await admin.from("wallet_nonces").delete().eq("user_id", user.id);
    const { data: taken } = await admin.from("wallets").select("user_id, verified").eq("address", address).maybeSingle();
    if (taken && taken.user_id !== user.id) {
      // A verified owner can't be displaced; an unverified (pasted) link gives way to the real owner.
      if (taken.verified) return json({ error: "taken" }, 409);
      await admin.from("wallets").delete().eq("user_id", taken.user_id);
    }
    const { error } = await admin.from("wallets").upsert({ user_id: user.id, address, verified: true, verified_at: new Date().toISOString() });
    if (error) return json({ error: "save_failed" }, 500);
    return json({ linked: address });
  }

  if (body.action === "check_pass") {
    const { data: w } = await admin.from("wallets").select("address, verified").eq("user_id", user.id).maybeSingle();
    if (!w) return json({ status: "no_wallet" });
    // Only a wallet the player proved they own (signed message) can unlock perks; a pasted address can't.
    if (!w.verified) return json({ status: "verify_wallet" });

    const nowIso = new Date().toISOString();
    const { data: season } = await admin.from("seasons").select("id, name, collection, ends_at")
      .lte("starts_at", nowIso).gt("ends_at", nowIso).order("starts_at", { ascending: false }).limit(1).maybeSingle();
    if (!season) return json({ status: "no_season" });
    if (!season.collection) return json({ status: "not_launched" });

    const key = Deno.env.get("HELIUS_API_KEY");
    if (!key) return json({ status: "not_configured" });

    const rpc = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "vault-hunt", method: "searchAssets",
        params: { ownerAddress: w.address, grouping: ["collection", season.collection], page: 1, limit: 5 },
      }),
    });
    if (!rpc.ok) return json({ status: "lookup_failed" }, 502);
    const out = await rpc.json();
    const asset = out?.result?.items?.[0];
    if (!asset?.id) return json({ status: "not_holding" });

    const { data: until, error } = await admin.rpc("grant_nft_pass", { p_user: user.id, p_season: season.id, p_asset: asset.id });
    if (error || !until) return json({ status: "grant_failed" }, 500);
    return json({ status: "active", pass_until: until, asset: asset.id });
  }

  // Weekly holder reward: credit Power Cells (in-game items only) for what the verified wallet held
  // the whole time over the last N hours. One claim per account and per wallet each week.
  if (body.action === "claim_holder") {
    const { data: w } = await admin.from("wallets").select("address, verified").eq("user_id", user.id).maybeSingle();
    if (!w) return json({ status: "no_wallet" });
    if (!w.verified) return json({ status: "verify_wallet" });
    const { data: cfg } = await admin.from("game_config").select(HOLDER_COLS).maybeSingle();
    const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!cfg || !(cfg.holder_rewards_enabled || me?.is_admin)) return json({ status: "off" });
    const out = await creditHolder(admin, cfg as HolderCfg, user.id, w.address);
    return json(out, out.status === "lookup_failed" ? 502 : 200);
  }

  return json({ error: "unknown_action" }, 400);
});
