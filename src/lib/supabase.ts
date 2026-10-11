import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url || "http://localhost", key || "missing-key");

export const ALLOW_SIM = import.meta.env.VITE_ALLOW_SIMULATED_LOCATION === "true";

export type Drop = { id: string; species_id: number; lat: number; lng: number; expires_at: string; caught_by: string | null };
export type Round = { id: number; prize_name: string; prize_grade: string; prize_mint: string | null; status: "open" | "drawn"; drawn_at: string | null; winner: string | null; total_entries: number | null; fair_id?: number | null };
export type ChatMessage = { id: number; user_id: string; kind: "msg" | "catch" | "draw"; body: string; created_at: string };
export type Profile = { id: string; display_name: string; xp: number; catches: number; wallet: string | null; is_admin: boolean };
export type PublicProfile = { id: string; display_name: string; xp: number; catches: number };
export type Status = {
  coins: number; sight_m: number; vault_holder: boolean; boost_until: string | null;
  has_pass: boolean; pass_until: string | null; pass_price: number; pass_days: number;
  pass_sight_m: number; pass_bounty_mult: number; daily_cap: number; entries_today: number;
  boost_cost: number; boost_minutes: number; free_hop_m: number; km_per_coin: number;
  travel_base: number; travel_max: number; pull_price: number; turbo_pct: number; sellback_days: number;
  bounty: { c: number; u: number; r: number; l?: number };
  pot: { id: number; name: string; total: number; remaining: number } | null;
  throws_free?: number; throws_used?: number; bonus_throws?: number;
  throw_pack_size?: number; throw_pack_price?: number; throws_reset_at?: string;
  server_now: string;
};

export type Hotspot = { name: string; lat: number; lng: number; radius_m: number };
export type Season = {
  id: number; name: string; starts_at: string; ends_at: string;
  collection: string | null; mint_url: string | null; mint_price_tokens: number | null; supply: number | null;
  pass_coins_enabled: boolean; minted: number; species: number[]; hotspots: Hotspot[]; server_now: string;
  candy_machine?: string | null; cluster?: string; has_whitelist?: boolean;
};

export function timeLeft(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Same formula the server uses in travel_to. */
export function tripCost(s: Status, meters: number) {
  if (meters <= s.free_hop_m) return 0;
  return Math.min(s.travel_base + Math.ceil((meters - s.free_hop_m) / (s.km_per_coin * 1000)), s.travel_max);
}
