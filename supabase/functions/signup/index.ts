// Slab Hunt early-access list (slabhunt.fun/signup).
//   POST { action: "config" } -> { post_url, total }   (the pinned gameplay post people like, comment on and quote)
//   POST { action: "join", email, x, wallet, quote_url, tasks: { like, comment, follow }, city?, kind?, ref?, updates?, website? }
//        -> { code, position, referrals, total } | { already } | { error }
//   POST { action: "status", code } -> { code, position, referrals, total } | { error }
//   POST { action: "lookup", ref } -> { name, kind: "player" | "list" } | { error }   ("Invited by ..." on the page)
// Referral codes are names: a player's username or a list member's X handle (old 8-character codes still work).
// The wallet is a pasted Solana address, kept only for prize/allowlist delivery; game perks still need a signed wallet.
// Writes go through waitlist_join_v3 (server-only SQL). "website" is a honeypot field real people never fill in.
// At most 5 signups per network address per hour; the address is stored only as a salted hash.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KINDS = new Set(["collector", "gamer", "crypto", "explorer"]);

const REF = /^[A-Za-z0-9_.-]{1,24}$/;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// A Solana address is 32 bytes in base58.
function isSolanaAddress(s: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  let bytes = 0;
  while (n > 0n) { n >>= 8n; bytes++; }
  for (const c of s) { if (c === "1") bytes++; else break; }
  return bytes === 32;
}

async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, service);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const str = (k: string, max: number) => String(b[k] ?? "").trim().slice(0, max);

  if (b.action === "status") {
    const code = str("code", 24);
    if (!REF.test(code)) return json({ error: "not_found" });
    const { data, error } = await db.rpc("waitlist_status_v2", { p_code: code });
    return error ? json({ error: "server" }, 500) : json(data);
  }
  if (b.action === "lookup") {
    const ref = str("ref", 25).replace(/^@/, "");
    if (!REF.test(ref)) return json({ error: "not_found" });
    const { data, error } = await db.rpc("referral_lookup", { p_ref: ref });
    return error ? json({ error: "server" }, 500) : json(data);
  }
  if (b.action === "config") {
    const { data, error } = await db.rpc("waitlist_config");
    return error ? json({ error: "server" }, 500) : json(data);
  }
  if (b.action !== "join") return json({ error: "action" }, 400);

  // Bots fill every field; pretend it worked.
  if (str("website", 200)) return json({ code: "00000000", position: 0, referrals: 0, total: 0 });

  const email = str("email", 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "email" });
  const x = str("x", 31).replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(x)) return json({ error: "x" });
  const wallet = str("wallet", 60);
  if (!isSolanaAddress(wallet)) return json({ error: "wallet" });
  const quote = str("quote_url", 300).replace(/^http:/, "https:").replace("://www.", "://").replace("://mobile.", "://");
  const t = (b.tasks ?? {}) as Record<string, unknown>;
  const kind = KINDS.has(str("kind", 20)) ? str("kind", 20) : "";
  const ref = str("ref", 25).replace(/^@/, "");

  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? xff[xff.length - 1] ?? "unknown";
  const ipHash = (await sha256(`${ip}:${service.slice(-24)}`)).slice(0, 32);

  const { data, error } = await db.rpc("waitlist_join_v3", {
    p_email: email, p_x: x, p_wallet: wallet, p_quote_url: quote,
    p_tasks: { like: t.like === true, comment: t.comment === true, follow: t.follow === true },
    p_city: str("city", 80), p_kind: kind,
    p_ref: REF.test(ref) ? ref : "", p_ip_hash: ipHash, p_updates: b.updates === true,
  });
  if (error) return json({ error: "server" }, 500);
  const r = data as Record<string, unknown>;
  // Someone typing a known email shouldn't learn that person's referral code.
  if (r?.already) return json({ already: true });
  return json(r);
});
