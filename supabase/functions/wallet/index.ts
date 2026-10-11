// Vault Hunt wallet function.
//   POST { action: "link", address, signature }  -> verify a signed challenge and link the wallet
//   POST { action: "check_pass" }                -> look for the current season's pass NFT and switch the pass on
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

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
    const { data: w } = await admin.from("wallets").select("address").eq("user_id", user.id).maybeSingle();
    if (!w) return json({ status: "no_wallet" });

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

  return json({ error: "unknown_action" }, 400);
});
