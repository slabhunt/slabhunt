// /vault: information about the $SLAB fair-start vault (Meteora Alpha Vault). Deposits happen on Meteora's site; this
// page never asks for a wallet or a transaction. Times are New York time (UTC-4).
import { useEffect, useState } from "react";

const MINT = "B8FCj8MPSzLG21yxoBff3jdZmQSZDMt8WCVZTkFUMnEQ";
const VAULT_ADDRESS = "4XHvRr8Zo3GhBYsR3SHat8PUL9W2WRFfu9Y2Yt4xc9i9";
const POOL_ADDRESS = "HpWdga7dnyaMKszeoow98reTqcyDyuipzdfyJSBMmaGR";
const DEPOSITS_CLOSE = new Date("2026-10-12T02:55:00Z"); // 10:55 PM New York, Oct 11
const TRADING_OPENS = new Date("2026-10-12T04:00:00Z");  // midnight New York
const UNLOCK_START = new Date("2026-10-12T05:00:00Z");   // 1 hour after open
const UNLOCK_END = new Date("2026-10-13T05:00:00Z");     // 24 hours later

const fmt = (d: Date) => d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
function left(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}

function Addr({ label, value, kind }: { label: string; value: string; kind: "token" | "account" }) {
  return (
    <p className="info-text">
      {label}: <a className="addr" href={`https://solscan.io/${kind}/${value}`} target="_blank" rel="noopener noreferrer">{value}</a>
    </p>
  );
}

export default function VaultDeposit() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const depositsOpen = now < DEPOSITS_CLOSE.getTime();
  const trading = now >= TRADING_OPENS.getTime();

  return (
    <div className="vault-deposit">
      <h2>Fair-start vault</h2>
      <p className="vault-desc">
        Instead of a race at the open, anyone can put SOL into the vault before trading starts. Right before the open the vault
        buys $SLAB at the starting price (up to 50 SOL in total) and shares it out in proportion to each deposit. If more than
        50 SOL comes in, everyone gets the unused part back.
      </p>

      <div className="vault-stats">
        <div><small>{depositsOpen ? "Deposits close in" : trading ? "Trading" : "Deposits"}</small><b>{depositsOpen ? left(DEPOSITS_CLOSE.getTime() - now) : trading ? "Live" : "Closed"}</b></div>
        <div><small>Trading opens</small><b>{trading ? "Now" : left(TRADING_OPENS.getTime() - now)}</b></div>
        <div><small>Vault cap</small><b>50 SOL</b></div>
      </div>

      <div className="deposit-section">
        {depositsOpen ? (
          <>
            <p className="info-text">Deposit on Meteora's vault page (the button below). Connect your wallet there and enter how much SOL.</p>
            <p className="info-text highlight">Never send SOL straight to the addresses on this page. Only deposit through Meteora's page; a plain transfer can't be counted or refunded.</p>
            <a className="btn" href={`https://app.meteora.ag/alpha-vault/${VAULT_ADDRESS}`} target="_blank" rel="noopener noreferrer">Open the vault on Meteora</a>
          </>
        ) : trading
          ? <p className="info-text">Trading is open. Buy on Meteora or Jupiter, and always check the mint address below.</p>
          : <p className="info-text">Deposits are closed. The vault buys before trading opens at {fmt(TRADING_OPENS)}.</p>}
      </div>

      <div className="vault-info">
        <h3>Addresses (check these before you buy)</h3>
        <Addr label="$SLAB mint" value={MINT} kind="token" />
        <Addr label="Fair-start vault" value={VAULT_ADDRESS} kind="account" />
        <Addr label="Pool" value={POOL_ADDRESS} kind="account" />
        <p className="info-text">Other tokens also use the ticker SLAB. Ours is "Slab Hunt" with the mint above.</p>

        <h3>Timeline</h3>
        <ol>
          <li>Deposits close: {fmt(DEPOSITS_CLOSE)}</li>
          <li>The vault buys in the last hour before the open</li>
          <li>Trading opens: {fmt(TRADING_OPENS)}</li>
          <li>Vault buyers' $SLAB unlocks gradually from {fmt(UNLOCK_START)} to {fmt(UNLOCK_END)}</li>
        </ol>
        <p className="info-text small">$SLAB is the in-game token of Slab Hunt. It is not an investment and can lose all its value. You never need it to play or win. <a href="/legal">Terms</a></p>
      </div>
    </div>
  );
}
