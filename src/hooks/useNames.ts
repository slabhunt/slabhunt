import { useCallback, useEffect, useState } from "react";
import { supabase, type PublicProfile } from "../lib/supabase";

/** Shared cache of player display names, fetched in batches. */
const known = new Map<string, PublicProfile>();
const listeners = new Set<() => void>();

async function fetchIds(ids: string[]) {
  const missing = ids.filter((id) => !known.has(id));
  if (!missing.length) return;
  const { data } = await supabase.from("public_profiles").select("id, display_name, xp, catches").in("id", missing);
  for (const p of data ?? []) known.set(p.id, p as PublicProfile);
  listeners.forEach((l) => l());
}

export function useNames(ids: string[]) {
  const [, bump] = useState(0);
  const key = Array.from(new Set(ids)).sort().join(",");
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => { if (key) fetchIds(key.split(",")); }, [key]);
  return useCallback((id: string | null | undefined) => (id && known.get(id)?.display_name) || "Hunter", []);
}

export function forgetName(id: string) { known.delete(id); }
