// Referral links: slabhunt.fun/?ref=<username>. The game remembers the ref it was opened with, and once the visitor
// has an account (and accepted the terms) it tells the server who invited them. The server only accepts it once,
// within 3 days of the account being created, and never for yourself.
import { supabase } from "./supabase";

const KEY = "sh_ref";
const NAME = /^[A-Za-z0-9_.-]{3,24}$/;

export function captureRef() {
  try {
    const ref = new URLSearchParams(location.search).get("ref")?.replace(/^@/, "") ?? "";
    if (NAME.test(ref)) localStorage.setItem(KEY, ref);
  } catch { /* storage blocked: no referral, nothing else breaks */ }
}

export async function claimStoredRef(): Promise<string | null> {
  let ref: string | null = null;
  try { ref = localStorage.getItem(KEY); } catch { return null; }
  if (!ref) return null;
  const { data, error } = await supabase.rpc("claim_referral", { p_ref: ref });
  if (error) return null; // try again next visit
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
  const r = data as { ok?: boolean; by?: string } | null;
  return r?.ok && r.by ? r.by : null;
}

export type MyReferrals = { code: string; players: number; signups: number; by: string | null };
export async function myReferrals(): Promise<MyReferrals | null> {
  const { data } = await supabase.rpc("my_referrals");
  return (data as MyReferrals | null) ?? null;
}

export const gameLink = (name: string) => `https://slabhunt.fun/?ref=${encodeURIComponent(name)}`;
export const signupLink = (name: string) => `https://slabhunt.fun/signup?ref=${encodeURIComponent(name)}`;
