// Admin pricing helpers: turn dollar targets into $SLAB amounts at the live (or a typed-in) token price.
import { supabase } from "./supabase";

/** Live $SLAB price in USD from Jupiter, or null before launch / on failure. */
export async function slabUsd(): Promise<number | null> {
  const { data } = await supabase.rpc("power_ups");
  const mint = (data as { mint?: string | null; cluster?: string } | null)?.mint;
  const cluster = (data as { cluster?: string } | null)?.cluster;
  if (!mint || cluster !== "mainnet-beta") return null;
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
    if (!r.ok) return null;
    const p = Number((await r.json())?.[mint]?.usdPrice);
    return p > 0 ? p : null;
  } catch { return null; }
}

/** Round to 3 significant figures, down, so a dollar price never overshoots. */
export function sig3(n: number) {
  if (!(n > 0)) return 0;
  const m = Math.pow(10, Math.floor(Math.log10(n)) - 2);
  return Number((Math.floor(n / m + 1e-9) * m).toPrecision(3));
}
