// Vault Hunt username sign-in.
//   POST { username, password } -> { access_token, refresh_token } or { error }
// Looks up the email behind a username on the server (emails never reach the browser), then signs in
// with the normal password check. Limited to 8 tries per username and 30 per network address every 15 minutes.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const NAME = /^[A-Za-z0-9_.-]{3,24}$/;
const WINDOW_MS = 15 * 60 * 1000;
const PER_NAME = 8, PER_IP = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { username?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!NAME.test(username) || !password || password.length > 200) return json({ error: "invalid" }, 400);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const [byName, byIp] = await Promise.all([
    admin.from("login_attempts").select("id", { count: "exact", head: true }).ilike("username", username.replace(/[\\%_]/g, "\\$&")).eq("ok", false).gte("created_at", since),
    admin.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("ok", false).gte("created_at", since),
  ]);
  if ((byName.count ?? 0) >= PER_NAME || (byIp.count ?? 0) >= PER_IP) return json({ error: "slow_down" }, 429);

  const fail = async () => {
    await admin.from("login_attempts").insert({ username, ip, ok: false });
    return json({ error: "invalid" }, 401);
  };

  // Same answer whether the username exists or the password is wrong.
  const { data: prof } = await admin.from("profiles").select("id").ilike("display_name", username.replace(/[\\%_]/g, "\\$&")).maybeSingle();
  if (!prof) return fail();
  const { data: u } = await admin.auth.admin.getUserById(prof.id);
  const email = u?.user?.email;
  if (!email) return fail();

  const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    if (error && /not confirmed/i.test(error.message)) return json({ error: "unconfirmed" }, 401);
    return fail();
  }
  await admin.from("login_attempts").insert({ username, ip, ok: true });
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
