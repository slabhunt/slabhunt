// Minimal Solana wallet linking: connect an injected wallet (Phantom, Solflare, Backpack...),
// sign a challenge message (no transaction, no fees) and let the server verify it.
import { supabase } from "./supabase";

type InjectedWallet = {
  connect: () => Promise<{ publicKey: { toString(): string } } | void>;
  publicKey?: { toString(): string } | null;
  signMessage: (msg: Uint8Array, display?: "utf8") => Promise<{ signature: Uint8Array } | Uint8Array>;
};

declare global {
  interface Window {
    phantom?: { solana?: InjectedWallet };
    solflare?: InjectedWallet;
    backpack?: InjectedWallet;
    solana?: InjectedWallet;
  }
}

export function findWallet(): { name: string; w: InjectedWallet } | null {
  if (window.phantom?.solana) return { name: "Phantom", w: window.phantom.solana };
  if (window.solflare) return { name: "Solflare", w: window.solflare };
  if (window.backpack) return { name: "Backpack", w: window.backpack };
  if (window.solana) return { name: "Wallet", w: window.solana };
  return null;
}

/** Links that reopen this page inside a wallet app's browser (for phones). */
export function walletBrowseLinks() {
  const url = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.origin);
  return {
    phantom: `https://phantom.app/ul/browse/${url}?ref=${ref}`,
    solflare: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`,
  };
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (const b of bytes) { if (b === 0) out += "1"; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

export async function linkWallet(): Promise<{ address?: string; error?: string }> {
  const found = findWallet();
  if (!found) return { error: "no_wallet" };
  const { w } = found;
  const res = await w.connect();
  const pk = (res && "publicKey" in res ? res.publicKey : w.publicKey)?.toString();
  if (!pk) return { error: "no_key" };

  const { data: message, error } = await supabase.rpc("wallet_challenge");
  if (error || typeof message !== "string") return { error: "challenge" };
  const signed = await w.signMessage(new TextEncoder().encode(message), "utf8");
  const sig = signed instanceof Uint8Array ? signed : signed.signature;

  const { data, error: fnErr } = await supabase.functions.invoke("wallet", { body: { action: "link", address: pk, signature: base58(sig) } });
  if (fnErr) {
    // Supabase wraps non-2xx responses; read the server's reason when we can.
    const ctx = (fnErr as { context?: Response }).context;
    try { const j = await ctx?.json(); return { error: j?.error ?? "link_failed" }; } catch { return { error: "link_failed" }; }
  }
  return { address: (data as { linked?: string })?.linked };
}

export async function checkPass(): Promise<string> {
  const { data, error } = await supabase.functions.invoke("wallet", { body: { action: "check_pass" } });
  if (error) return "lookup_failed";
  return (data as { status?: string })?.status ?? "lookup_failed";
}
