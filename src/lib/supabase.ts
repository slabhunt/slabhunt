import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url || "http://localhost", key || "missing-key");

export const ALLOW_SIM = import.meta.env.VITE_ALLOW_SIMULATED_LOCATION === "true";

export type Drop = { id: string; species_id: number; lat: number; lng: number; expires_at: string; caught_by: string | null };
export type Round = { id: number; prize_name: string; prize_grade: string; prize_mint: string | null; status: "open" | "drawn"; drawn_at: string | null; winner: string | null; total_entries: number | null };
export type ChatMessage = { id: number; user_id: string; kind: "msg" | "catch" | "draw"; body: string; created_at: string };
export type Profile = { id: string; display_name: string; xp: number; catches: number; wallet: string | null; is_admin: boolean };
export type PublicProfile = { id: string; display_name: string; xp: number; catches: number };
