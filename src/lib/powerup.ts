// Buy a $VDRAKE power-up: the server builds the payment (split between burn, card vault, map drops and
// development), the player's own wallet signs and sends it, then the server checks it on-chain.
import { supabase } from "./supabase";
import { findWallet } from "./wallet";

type SendingWallet = {
  connect: () => Promise<{ publicKey: { toString(): string } } | void>;
  publicKey?: { toString(): string } | null;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string } | string>;
};

async function fnError(e: unknown): Promise<string> {
  try { return (await (e as { context?: Response }).context?.json())?.error ?? "failed"; } catch { return "failed"; }
}

export async function buyPowerUp(tier: number, onStep: (s: string) => void): Promise<{ points?: number; error?: string; need?: string }> {
  const found = findWallet();
  if (!found) return { error: "no_wallet" };
  const w = found.w as unknown as SendingWallet;
  if (!w.signAndSendTransaction) return { error: "wallet_unsupported" };
  const res = await w.connect();
  const pk = (res && "publicKey" in res ? res.publicKey : w.publicKey)?.toString();
  if (!pk) return { error: "no_key" };

  onStep("Preparing payment...");
  const start = await supabase.functions.invoke("powerup", { body: { action: "start", tier, wallet: pk } });
  if (start.error) {
    let need: string | undefined;
    try { const j = await (start.error as { context?: Response }).context?.clone().json(); need = j?.need; } catch { /* ignore */ }
    return { error: await fnError(start.error), need };
  }
  const { purchase_id, tx } = start.data as { purchase_id: string; tx: string };

  // The Solana library is big, so it loads only when someone actually pays.
  const { VersionedTransaction } = await import("@solana/web3.js");
  const bytes = Uint8Array.from(atob(tx), (c) => c.charCodeAt(0));
  onStep("Approve the payment in your wallet...");
  let signature: string;
  try {
    const sent = await w.signAndSendTransaction(VersionedTransaction.deserialize(bytes));
    signature = typeof sent === "string" ? sent : sent.signature;
  } catch {
    return { error: "rejected" };
  }

  onStep("Checking the payment...");
  for (let i = 0; i < 6; i++) {
    const c = await supabase.functions.invoke("powerup", { body: { action: "confirm", purchase_id, signature } });
    if (!c.error && (c.data as { error?: string })?.error !== "pending") return { points: (c.data as { points?: number }).points ?? 0 };
    if (c.error) {
      const code = await fnError(c.error);
      if (code !== "pending") return { error: code };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { error: "pending" };
}
