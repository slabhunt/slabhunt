// /vault: the $SLAB fair-start vault (Meteora Alpha Vault, pro-rata). The server (edge function "alphavault") builds and
// simulates each transaction; the visitor's own wallet signs and sends it. Times come from the pool on-chain:
// trading opens 2026-10-12 00:00 UTC (8 PM New York, Oct 11).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { findWallet, walletBrowseLinks } from "../lib/wallet";

const MINT = "B8FCj8MPSzLG21yxoBff3jdZmQSZDMt8WCVZTkFUMnEQ";
const VAULT_ADDRESS = "4XHvRr8Zo3GhBYsR3SHat8PUL9W2WRFfu9Y2Yt4xc9i9";
const POOL_ADDRESS = "HpWdga7dnyaMKszeoow98reTqcyDyuipzdfyJSBMmaGR";
const DEPOSITS_CLOSE = new Date("2026-10-11T22:55:00Z"); // 6:55 PM New York
const TRADING_OPENS = new Date("2026-10-12T00:00:00Z");  // 8:00 PM New York
const UNLOCK_START = new Date("2026-10-12T01:00:00Z");
const UNLOCK_END = new Date("2026-10-13T01:00:00Z");
const LAMPORTS = 1_000_000_000;

type Status = {
  phase: string; cap_lamports: string; total_deposit_lamports: string; depositors: string; swapped_lamports: string;
  mine: { totalDeposit: string; claimedToken: string } | null; balance_lamports: number | null;
};
type SendingWallet = {
  connect: () => Promise<{ publicKey: { toString(): string } } | void>;
  publicKey?: { toString(): string } | null;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string } | string>;
};

const fmt = (d: Date) => d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const sol = (lamports: string | number | null | undefined) => (Number(lamports ?? 0) / LAMPORTS).toLocaleString(undefined, { maximumFractionDigits: 4 });
function left(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}
const ERRORS: Record<string, string> = {
  not_enough_sol: "Not enough SOL in this wallet for that amount plus fees (keep about 0.01 SOL extra).",
  deposits_closed: "Deposits are closed.",
  bad_amount: "Enter an amount between 0.001 and 50 SOL.",
  more_than_deposited: "That's more than you deposited.",
  no_deposit: "This wallet has no deposit in the vault.",
  rejected: "You cancelled in your wallet.",
  no_wallet: "No Solana wallet found in this browser.",
  wallet_unsupported: "This wallet can't send transactions from here. Try Phantom, Solflare or Backpack.",
};

function Addr({ label, value, kind }: { label: string; value: string; kind: "token" | "account" }) {
  return (
    <p className="info-text">
      {label}: <a className="addr" href={`https://solscan.io/${kind}/${value}`} target="_blank" rel="noopener noreferrer">{value}</a>
    </p>
  );
}

async function fnError(e: unknown) {
  try { const j = await (e as { context?: Response }).context?.clone().json(); return (j?.error as string) ?? "failed"; } catch { return "failed"; }
}

export default function VaultDeposit() {
  const [now, setNow] = useState(Date.now());
  const [owner, setOwner] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const refresh = useCallback(async (who: string | null = owner) => {
    const { data } = await supabase.functions.invoke("alphavault", { body: { action: "status", owner: who ?? undefined } });
    if (data && !(data as { error?: string }).error) setStatus(data as Status);
  }, [owner]);
  useEffect(() => { refresh(); const t = setInterval(() => refresh(), 20000); return () => clearInterval(t); }, [refresh]);

  const depositsOpen = now < DEPOSITS_CLOSE.getTime();
  const trading = now >= TRADING_OPENS.getTime();
  const hasWallet = typeof window !== "undefined" && !!findWallet();

  async function connect(): Promise<{ w: SendingWallet; pk: string } | null> {
    const found = findWallet();
    if (!found) { setMsg({ ok: false, text: ERRORS.no_wallet }); return null; }
    const w = found.w as unknown as SendingWallet;
    if (!w.signAndSendTransaction) { setMsg({ ok: false, text: ERRORS.wallet_unsupported }); return null; }
    try {
      const res = await w.connect();
      const pk = (res && "publicKey" in res ? res.publicKey : w.publicKey)?.toString();
      if (!pk) return null;
      setOwner(pk); refresh(pk);
      return { w, pk };
    } catch { setMsg({ ok: false, text: ERRORS.rejected }); return null; }
  }

  async function run(action: "deposit" | "withdraw", lamports: number) {
    setMsg(null);
    const c = await connect();
    if (!c) return;
    setBusy(action === "deposit" ? "Preparing your deposit..." : "Preparing your withdrawal...");
    try {
      const built = await supabase.functions.invoke("alphavault", { body: { action, owner: c.pk, lamports } });
      if (built.error) { setMsg({ ok: false, text: ERRORS[await fnError(built.error)] ?? "Couldn't prepare the transaction. Try again." }); return; }
      const b = built.data as { tx?: string; error?: string };
      if (!b.tx) { setMsg({ ok: false, text: ERRORS[b.error ?? ""] ?? "Couldn't prepare the transaction." }); return; }
      setBusy("Approve it in your wallet...");
      const { VersionedTransaction } = await import("@solana/web3.js");
      let sig: string;
      try {
        const sent = await c.w.signAndSendTransaction!(VersionedTransaction.deserialize(Uint8Array.from(atob(b.tx), (ch) => ch.charCodeAt(0))));
        sig = typeof sent === "string" ? sent : sent.signature;
      } catch { setMsg({ ok: false, text: ERRORS.rejected }); return; }
      setBusy("Confirming...");
      await new Promise((r) => setTimeout(r, 4000));
      await refresh(c.pk);
      setMsg({ ok: true, text: action === "deposit" ? `Deposited ${sol(lamports)} SOL.` : `Withdrew ${sol(lamports)} SOL.`, sig });
    } finally { setBusy(null); }
  }

  const lamportsIn = Math.round(Number(amount) * LAMPORTS);
  const mine = Number(status?.mine?.totalDeposit ?? 0);
  const total = Number(status?.total_deposit_lamports ?? 0);
  const cap = Number(status?.cap_lamports ?? 50 * LAMPORTS);
  const myShare = total > 0 ? Math.min(1, cap / total) * mine : 0;

  return (
    <div className="vault-deposit">
      <h2>Fair-start vault</h2>
      <p className="vault-desc">
        Instead of a race at the open, anyone can put SOL into the vault before trading starts. Right before the open the vault
        buys $SLAB at the starting price (up to 50 SOL in total) and shares it out in proportion to each deposit. If more than
        50 SOL comes in, everyone gets the unused part back. You can withdraw any time until deposits close.
      </p>

      <div className="vault-stats">
        <div><small>{depositsOpen ? "Deposits close in" : trading ? "Trading" : "Deposits"}</small><b>{depositsOpen ? left(DEPOSITS_CLOSE.getTime() - now) : trading ? "Live" : "Closed"}</b></div>
        <div><small>Trading opens</small><b>{trading ? "Now" : left(TRADING_OPENS.getTime() - now)}</b></div>
        <div><small>In the vault</small><b>{status ? `${sol(total)} / 50 SOL` : "…"}</b></div>
        <div><small>Depositors</small><b>{status?.depositors ?? "…"}</b></div>
      </div>

      <div className="deposit-section">
        {depositsOpen ? (
          <>
            {owner && (
              <p className="info-text">
                Wallet <span className="addr">{owner.slice(0, 4)}…{owner.slice(-4)}</span> · balance {sol(status?.balance_lamports)} SOL ·
                your deposit <b>{sol(mine)} SOL</b>{mine > 0 && total > cap ? ` (about ${sol(myShare)} SOL gets used, the rest comes back)` : ""}
              </p>
            )}
            {hasWallet ? (
              <>
                <div className="vault-form">
                  <label>Amount (SOL)
                    <input type="number" inputMode="decimal" min="0.001" max="50" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!!busy} />
                  </label>
                  <button className="btn" disabled={!!busy || !(lamportsIn >= 1_000_000)} onClick={() => run("deposit", lamportsIn)}>Deposit</button>
                  {mine > 0 && <button className="btn ghost" disabled={!!busy || !(lamportsIn >= 1_000_000 && lamportsIn <= mine)} onClick={() => run("withdraw", lamportsIn)}>Withdraw</button>}
                  {mine > 0 && <button className="btn ghost" disabled={!!busy} onClick={() => run("withdraw", mine)}>Withdraw all</button>}
                </div>
                {!owner && <button className="btn ghost small" disabled={!!busy} onClick={connect}>Connect wallet to see your deposit</button>}
              </>
            ) : (
              <p className="info-text">
                Open this page in your wallet app to deposit: <a href={walletBrowseLinks().phantom}>Phantom</a> · <a href={walletBrowseLinks().solflare}>Solflare</a>
              </p>
            )}
            {busy && <p className="info-text">{busy}</p>}
            {msg && (
              <p className={`info-text ${msg.ok ? "" : "highlight"}`}>
                {msg.text} {msg.sig && <a href={`https://solscan.io/tx/${msg.sig}`} target="_blank" rel="noopener noreferrer">View on Solscan</a>}
              </p>
            )}
            <p className="info-text small">
              Your wallet shows exactly what the transaction does before you approve. It only moves SOL into your own vault
              account (escrow) and sets up your $SLAB token account. Never send SOL straight to any address on this page.
              You can also use <a href={`https://app.meteora.ag/dlmm/${POOL_ADDRESS}`} target="_blank" rel="noopener noreferrer">Meteora's page</a>.
            </p>
          </>
        ) : trading
          ? <p className="info-text">Trading is open. Vault depositors claim their $SLAB on <a href={`https://app.meteora.ag/dlmm/${POOL_ADDRESS}`} target="_blank" rel="noopener noreferrer">Meteora</a> as it unlocks. Always check the mint address below.</p>
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
          <li>The vault buys in the hour before the open</li>
          <li>Trading opens: {fmt(TRADING_OPENS)}</li>
          <li>Vault buyers' $SLAB unlocks gradually from {fmt(UNLOCK_START)} to {fmt(UNLOCK_END)}</li>
        </ol>
        <p className="info-text small">$SLAB is the in-game token of Slab Hunt. It is not an investment and can lose all its value. You never need it to play or win. <a href="/legal">Terms</a></p>
      </div>
    </div>
  );
}
