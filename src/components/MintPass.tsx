// In-game Season Pass mint: shows supply and price, mints a random-tier pass, and turns the pass on.
import { useCallback, useEffect, useState } from "react";
import { mintPass, mintStatus, type MintStatus } from "../lib/passmint";
import { findWallet, walletBrowseLinks } from "../lib/wallet";

const ERR: Record<string, string> = {
  no_wallet: "Open Vault Hunt inside your wallet app (Phantom or Solflare) to mint.",
  wallet_unsupported: "This wallet can't send transactions from a web page. Try Phantom or Solflare.",
  rejected: "Mint cancelled in your wallet.",
  sold_out: "Sold out. Every pass for this season has been minted.",
  already_minted: "This wallet already minted its pass for this season.",
  not_eligible: "This wallet isn't on the free list and paid minting isn't open.",
  balance: "Not enough $VDRAKE in this wallet for the pass.",
  failed_on_chain: "The transaction failed on-chain, so nothing was charged.",
  not_launched: "The pass mint opens soon.",
  lookup_failed: "Couldn't reach the network. Try again in a minute.",
};
const DONE: Record<string, string> = {
  active: "Your Season Pass is active!",
  registered: "Pass minted! Its tier is revealed when its season starts, and the perks switch on then.",
  verify_wallet: "Minted! Now link this wallet in Profile (\"Prove it's mine\") and tap \"Check my wallet\" to switch the pass on.",
  asset_used: "Minted, but that pass is already active on another account.",
  pending: "Minted! The network is still catching up; tap \"Check my wallet\" in a minute.",
  wrong_collection: "That NFT isn't from this season's collection.",
};

export default function MintPass({ onActive, onCheck, toast }: { onActive: () => void; onCheck: () => void; toast: (m: string) => void }) {
  const [st, setSt] = useState<MintStatus | null>(null);
  const [step, setStep] = useState("");
  const load = useCallback(async () => {
    const r = await mintStatus();
    if ("left" in r) setSt(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function go() {
    setStep("Connecting your wallet...");
    const r = await mintPass(setStep);
    setStep("");
    if (r.error) { toast(ERR[r.error] ?? "Couldn't mint right now. Try again."); load(); return; }
    const names = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary"];
    toast(r.status === "active" && r.tier ? `You got a ${names[r.tier]} pass: +${r.tier} level${r.tier > 1 ? "s" : ""} in every power-up this season!` : DONE[r.status ?? ""] ?? "Minted!");
    if (r.status === "active" || r.status === "registered") onActive();
    load();
  }

  const inWallet = !!findWallet();
  if (!st) return <p className="sub">Loading the pass mint...</p>;
  const soldOut = st.left <= 0;
  const done = st.minted_free || st.minted_paid;
  return (
    <div className="mint-pass stack">
      <div className="row mint-meta">
        <span className="tag">{st.left.toLocaleString()} of {st.supply.toLocaleString()} left</span>
        {st.price != null && <span className="tag">{st.price.toLocaleString()} $VDRAKE</span>}
        {st.free && <span className="tag ok">You mint free</span>}
        {st.cluster !== "mainnet-beta" && <span className="tag">Test network</span>}
      </div>
      {step ? <p className="sub" aria-live="polite">{step}</p>
        : soldOut ? <p className="sub">Sold out for this season.</p>
        : done && !st.free ? <p className="sub ok">This wallet has minted its pass. <button className="btn ghost small" onClick={onCheck}>Check my wallet</button></p>
        : inWallet ? (
          <div className="row">
            <button className="btn" onClick={go}>{st.free ? "Mint my free pass" : `Mint pass · ${st.price?.toLocaleString() ?? "?"} $VDRAKE`}</button>
            <button className="btn ghost" onClick={onCheck}>I already minted</button>
          </div>
        ) : (
          <div className="stack">
            <p className="sub">Minting happens in your wallet app. Open Vault Hunt there:</p>
            <div className="row">
              <a className="btn" href={walletBrowseLinks().phantom}>Open in Phantom</a>
              <a className="btn ghost" href={walletBrowseLinks().solflare}>Open in Solflare</a>
            </div>
          </div>
        )}
      <p className="sub small">One pass per wallet. Every pass gets a random tier (Common to Legendary), revealed for all passes at once when the season starts, using public randomness nobody can predict. Mint with the wallet you've linked in Profile, so the game can switch your pass on.</p>
    </div>
  );
}
