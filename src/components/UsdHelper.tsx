// Admin helper: type a dollar target, get the $SLAB amount at the live price (or a price you type in).
import { useState } from "react";
import { sig3, slabUsd } from "../lib/price";

export default function UsdHelper({ label, defaultUsd, onTokens, toast }: {
  label: string; defaultUsd: string; onTokens: (tokens: number) => void; toast: (m: string) => void;
}) {
  const [usd, setUsd] = useState(defaultUsd);
  const [tokenUsd, setTokenUsd] = useState("");
  const [busy, setBusy] = useState(false);

  async function live() {
    setBusy(true);
    const p = await slabUsd();
    setBusy(false);
    if (!p) { toast("No live $SLAB price yet (before launch or on devnet). Type a token price instead."); return; }
    setTokenUsd(String(p));
    apply(p);
  }
  function apply(p = Number(tokenUsd)) {
    const d = Number(usd);
    if (!(d > 0) || !(p > 0)) { toast("Enter a dollar amount and a token price."); return; }
    const t = sig3(d / p);
    onTokens(t);
    toast(`$${d} ≈ ${t.toLocaleString()} $SLAB at $${p} each. Remember to save.`);
  }

  return (
    <div className="usd-helper">
      <span className="sub small">{label}</span>
      <div className="row">
        <label className="field grow">Target $<input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} /></label>
        <label className="field grow">$ per token<input inputMode="decimal" value={tokenUsd} onChange={(e) => setTokenUsd(e.target.value)} placeholder="0.000033" /></label>
      </div>
      <div className="row">
        <button className="btn ghost small" disabled={busy} onClick={live}>{busy ? "Checking..." : "Use live price"}</button>
        <button className="btn ghost small" onClick={() => apply()}>Convert</button>
      </div>
    </div>
  );
}
