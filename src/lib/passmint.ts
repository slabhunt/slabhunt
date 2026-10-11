// Season Pass mint from inside the game. The server builds the mint transaction(s); the player's wallet signs and
// sends them; the server then checks the new pass on-chain and switches it on for this account.
import { supabase } from "./supabase";
import { findWallet } from "./wallet";

type SendingWallet = {
  connect: () => Promise<{ publicKey: { toString(): string } } | void>;
  publicKey?: { toString(): string } | null;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string } | string>;
};
export type MintStatus = {
  season: string; ends_at: string; cluster: string; left: number; supply: number; price: number | null;
  token_mint: string | null; free: boolean; minted_free: boolean; minted_paid: boolean; whitelist_ready: boolean;
  error?: string;
};
export type MintResult = { status?: string; error?: string; need?: string; asset?: string; owner?: string; tier?: number };

async function fnError(e: unknown): Promise<{ error: string; need?: string }> {
  try { const j = await (e as { context?: Response }).context?.clone().json(); return { error: j?.error ?? "failed", need: j?.need }; }
  catch { return { error: "failed" }; }
}

async function connect(): Promise<{ w: SendingWallet; pk: string } | { error: string }> {
  const found = findWallet();
  if (!found) return { error: "no_wallet" };
  const w = found.w as unknown as SendingWallet;
  if (!w.signAndSendTransaction) return { error: "wallet_unsupported" };
  const res = await w.connect();
  const pk = (res && "publicKey" in res ? res.publicKey : w.publicKey)?.toString();
  return pk ? { w, pk } : { error: "no_key" };
}

/** Supply, price and whether the connected wallet (if any) mints free. Doesn't ask the wallet to connect. */
export async function mintStatus(): Promise<MintStatus | { error: string }> {
  const found = findWallet();
  const pk = (found?.w as unknown as SendingWallet | undefined)?.publicKey?.toString();
  const { data, error } = await supabase.functions.invoke("passmint", { body: { action: "status", wallet: pk } });
  if (error) return fnError(error);
  return data as MintStatus;
}

export async function mintPass(onStep: (s: string) => void): Promise<MintResult> {
  const c = await connect();
  if ("error" in c) return c;
  onStep("Preparing your pass...");
  const built = await supabase.functions.invoke("passmint", { body: { action: "build", wallet: c.pk } });
  if (built.error) return fnError(built.error);
  const b = built.data as { txs?: string[]; asset?: string; free?: boolean; error?: string; need?: string };
  if (b.error || !b.txs?.length || !b.asset) return { error: b.error ?? "failed", need: b.need };

  const { VersionedTransaction, Connection } = await import("@solana/web3.js");
  const rpc = (await mintStatus().then((s) => ("cluster" in s && s.cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com")));
  const conn = new Connection(rpc, "confirmed");
  for (const [i, t] of b.txs.entries()) {
    onStep(b.txs.length > 1 && i === 0 ? "Approve the free-mint check in your wallet (1 of 2)..." : `Approve the mint in your wallet${b.txs.length > 1 ? " (2 of 2)" : ""}...`);
    let sig: string;
    try {
      const sent = await c.w.signAndSendTransaction!(VersionedTransaction.deserialize(Uint8Array.from(atob(t), (ch) => ch.charCodeAt(0))));
      sig = typeof sent === "string" ? sent : sent.signature;
    } catch {
      return { error: "rejected" };
    }
    if (i < b.txs.length - 1) {
      onStep("Waiting for the network...");
      // The proof must land before the mint uses it.
      for (let k = 0; k < 20; k++) {
        const st = await conn.getSignatureStatus(sig).catch(() => null);
        const v = st?.value;
        if (v?.err) return { error: "failed_on_chain" };
        if (v?.confirmationStatus === "confirmed" || v?.confirmationStatus === "finalized") break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  onStep("Checking your new pass...");
  for (let i = 0; i < 5; i++) {
    const r = await supabase.functions.invoke("passmint", { body: { action: "confirm", asset: b.asset } });
    const d = r.data as MintResult | null;
    if (d?.status && d.status !== "pending") return { ...d, asset: b.asset };
    await new Promise((res) => setTimeout(res, 3000));
  }
  return { status: "pending", asset: b.asset };
}

export async function saveWhitelist(addresses: string[]): Promise<{ saved?: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke("passmint", { body: { action: "admin_whitelist", addresses } });
  if (error) return fnError(error);
  return data as { saved?: number; error?: string };
}
