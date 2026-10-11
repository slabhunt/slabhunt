// Slab Hunt account deletions (admins only).
//   POST { action: "process_due" } -> processes every deletion request past its 7-day grace period
// For each one: removes the player's personal data (process_account_deletion), then locks the login by replacing
// the email with a placeholder and banning the account. Prize, payment and signed-terms records stay without a name.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "signed_out" }, 401);
  const { data: isAdmin } = await asUser.rpc("is_admin");
  if (isAdmin !== true) return json({ error: "admins_only" }, 403);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { action?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (body.action !== "process_due") return json({ error: "action" }, 400);

  const { data: due, error } = await admin.from("account_deletion_requests").select("id, user_id")
    .eq("status", "pending").lte("due_at", new Date().toISOString()).limit(50);
  if (error) return json({ error: "lookup_failed" }, 500);

  const done: string[] = [], failed: { user: string; step: string }[] = [];
  for (const r of due ?? []) {
    const { error: e1 } = await admin.rpc("process_account_deletion", { p_user: r.user_id });
    if (e1) { failed.push({ user: r.user_id, step: "data" }); continue; }
    const { error: e2 } = await admin.auth.admin.updateUserById(r.user_id, {
      email: `deleted-${r.user_id}@deleted.invalid`,
      ban_duration: "876000h",
      user_metadata: {},
    });
    if (e2) { failed.push({ user: r.user_id, step: "login" }); continue; }
    done.push(r.user_id);
  }
  return json({ processed: done.length, failed });
});
