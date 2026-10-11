// $SLAB fair-start vault (Meteora Alpha Vault, pro-rata) from slabhunt.fun/vault. This function only READS the chain and
// BUILDS unsigned transactions; the visitor's own wallet signs and sends them. It holds no keys and writes nothing.
//   POST { action: "status", owner? }            -> vault totals and timing, plus the owner's deposit if given
//   POST { action: "deposit", owner, lamports }  -> base64 v0 transaction: (open escrow) + wrap SOL + deposit + unwrap
//   POST { action: "withdraw", owner, lamports } -> base64 v0 transaction: withdraw from the escrow + unwrap
// Every built transaction is simulated here first; if the simulation fails the visitor gets the reason, not a transaction.
// Instruction layouts are from Meteora's alpha_vault IDL 0.4.1 (program vaU6kP7iNEGkbmPkLmZfGwiGxd4Mob24QQCie5R9kd2).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Buffer } from "node:buffer";
import {
  ComputeBudgetProgram, Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "npm:@solana/web3.js@1.98.0";

const PROGRAM = new PublicKey("vaU6kP7iNEGkbmPkLmZfGwiGxd4Mob24QQCie5R9kd2");
const VAULT = new PublicKey("4XHvRr8Zo3GhBYsR3SHat8PUL9W2WRFfu9Y2Yt4xc9i9");
const ESCROW_FEE_RECEIVER = new PublicKey("BJQbRiRWhJCyTYZcAuAL3ngDCx3AyFQGKDq8zhiZAKUw");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const MIN_LAMPORTS = 1_000_000; // 0.001 SOL
const MAX_LAMPORTS = 50_000_000_000; // the vault's whole buying cap

const DISC = {
  createNewEscrow: [60, 154, 170, 202, 252, 109, 83, 199],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
};

const ALLOWED_ORIGINS = ["https://slabhunt.fun", "https://www.slabhunt.fun", "https://vault-hunt.vercel.app", "http://localhost:5173"];
function corsFor(req: Request) {
  const o = req.headers.get("origin") ?? "";
  const ok = ALLOWED_ORIGINS.includes(o) || /^https:\/\/vault-hunt-[a-z0-9-]+\.vercel\.app$/.test(o);
  return {
    "Access-Control-Allow-Origin": ok ? o : "https://slabhunt.fun",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function rpcUrl() {
  const key = Deno.env.get("HELIUS_API_KEY");
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
}

const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
const readU64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset).getBigUint64(o, true);
const pk = (d: Uint8Array, o: number) => new PublicKey(d.slice(o, o + 32));
const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
const [EVENT_AUTHORITY] = PublicKey.findProgramAddressSync([new TextEncoder().encode("__event_authority")], PROGRAM);
const escrowOf = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([new TextEncoder().encode("escrow"), VAULT.toBuffer(), owner.toBuffer()], PROGRAM)[0];

type Vault = { pool: PublicKey; tokenVault: PublicKey; quoteMint: PublicKey; baseMint: PublicKey; maxBuyingCap: bigint; totalDeposit: bigint; totalEscrow: bigint; swappedAmount: bigint; boughtToken: bigint; startVesting: bigint; endVesting: bigint; depositingPoint: bigint; mode: number };
function decodeVault(d: Uint8Array): Vault {
  // 8-byte discriminator, then 7 pubkeys, then u64s (see IDL "Vault")
  const o = 8 + 7 * 32;
  return {
    pool: pk(d, 8), tokenVault: pk(d, 40), quoteMint: pk(d, 104), baseMint: pk(d, 136),
    maxBuyingCap: readU64(d, o), totalDeposit: readU64(d, o + 8), totalEscrow: readU64(d, o + 16), swappedAmount: readU64(d, o + 24),
    boughtToken: readU64(d, o + 32), startVesting: readU64(d, o + 56), endVesting: readU64(d, o + 64),
    mode: d[o + 74], depositingPoint: readU64(d, o + 96),
  };
}
type Escrow = { totalDeposit: bigint; claimedToken: bigint; refunded: boolean; withdrawnOverflow: bigint };
function decodeEscrow(d: Uint8Array): Escrow {
  return { totalDeposit: readU64(d, 72), claimedToken: readU64(d, 80), refunded: d[96] === 1, withdrawnOverflow: readU64(d, 112) };
}

// From the pool on-chain: activation_point 1791763200 (2026-10-12 00:00 UTC), pre_activation_duration 3600. Deposits
// close 1 hour (pre-activation) + 5 minutes before trading opens: 22:55 UTC Oct 11 (6:55 PM New York).
const TRADING_OPENS = Date.parse("2026-10-12T00:00:00Z") / 1000;
const LAST_JOIN = TRADING_OPENS - 3600 - 300;

function ix(keys: [PublicKey, boolean, boolean][], data: number[] | Uint8Array, programId = PROGRAM) {
  return new TransactionInstruction({ programId, keys: keys.map(([pubkey, isWritable, isSigner]) => ({ pubkey, isSigner, isWritable })), data: Buffer.from(data) });
}
const createAtaIdempotent = (payer: PublicKey, owner: PublicKey, mint: PublicKey) =>
  ix([[payer, true, true], [ata(owner, mint), true, false], [owner, false, false], [mint, false, false], [SystemProgram.programId, false, false], [TOKEN_PROGRAM, false, false]], [1], ATA_PROGRAM);
const syncNative = (account: PublicKey) => ix([[account, true, false]], [17], TOKEN_PROGRAM);
const closeAccount = (account: PublicKey, owner: PublicKey) => ix([[account, true, false], [owner, true, false], [owner, false, true]], [9], TOKEN_PROGRAM);

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) {
    console.error("alphavault", e);
    return new Response(JSON.stringify({ error: "server_error", detail: String(e).slice(0, 200) }), { status: 500, headers: { ...corsFor(req), "Content-Type": "application/json" } });
  }
});

async function handle(req: Request): Promise<Response> {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, (_k, v) => typeof v === "bigint" ? v.toString() : v), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: { action?: string; owner?: string; lamports?: number };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const conn = new Connection(rpcUrl(), "confirmed");

  let owner: PublicKey | null = null;
  if (body.owner) {
    try { owner = new PublicKey(body.owner); } catch { return json({ error: "bad_owner" }, 400); }
  }

  const vaultInfo = await conn.getAccountInfo(VAULT).catch(() => null);
  if (!vaultInfo || !vaultInfo.owner.equals(PROGRAM)) return json({ error: "vault_unreachable" }, 502);
  const v = decodeVault(vaultInfo.data);
  const now = Math.floor(Date.now() / 1000);
  const phase = now < Number(v.depositingPoint) ? "preparing" : now <= LAST_JOIN ? "depositing" : now < TRADING_OPENS ? "buying" : now < Number(v.startVesting) ? "locked" : now < Number(v.endVesting) ? "unlocking" : "done";

  if (body.action === "status") {
    let mine: (Escrow & { escrow: string }) | null = null;
    let balance: number | null = null;
    if (owner) {
      const esc = escrowOf(owner);
      const [e, bal] = await Promise.all([conn.getAccountInfo(esc).catch(() => null), conn.getBalance(owner).catch(() => null)]);
      if (e) mine = { ...decodeEscrow(e.data), escrow: esc.toBase58() };
      balance = bal;
    }
    return json({
      vault: VAULT.toBase58(), mode: v.mode === 0 ? "prorata" : "fcfs", phase, now,
      deposits_open_at: Number(v.depositingPoint), deposits_close_at: LAST_JOIN, trading_opens_at: TRADING_OPENS,
      unlock_start: Number(v.startVesting), unlock_end: Number(v.endVesting),
      cap_lamports: v.maxBuyingCap, total_deposit_lamports: v.totalDeposit, depositors: v.totalEscrow,
      swapped_lamports: v.swappedAmount, bought_token: v.boughtToken, mine, balance_lamports: balance,
    });
  }

  if (body.action !== "deposit" && body.action !== "withdraw") return json({ error: "unknown_action" }, 400);
  if (!owner) return json({ error: "bad_owner" }, 400);
  if (phase !== "depositing") return json({ error: "deposits_closed", phase }, 409);
  const lamports = Math.floor(Number(body.lamports));
  if (!Number.isFinite(lamports) || lamports < MIN_LAMPORTS || lamports > MAX_LAMPORTS) return json({ error: "bad_amount" }, 400);
  if (!v.quoteMint.equals(WSOL)) return json({ error: "unexpected_vault" }, 500);

  const escrow = escrowOf(owner);
  const wsolAta = ata(owner, WSOL);
  const escrowInfo = await conn.getAccountInfo(escrow).catch(() => null);
  const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })];

  if (body.action === "deposit") {
    if (!escrowInfo) {
      ixs.push(ix([
        [VAULT, true, false], [v.pool, false, false], [escrow, true, false], [owner, false, false], [owner, true, true],
        [ESCROW_FEE_RECEIVER, true, false], [SystemProgram.programId, false, false], [EVENT_AUTHORITY, false, false], [PROGRAM, false, false],
      ], DISC.createNewEscrow));
    }
    ixs.push(createAtaIdempotent(owner, owner, WSOL));
    ixs.push(createAtaIdempotent(owner, owner, v.baseMint)); // so $SLAB can be claimed to it later
    ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: wsolAta, lamports }));
    ixs.push(syncNative(wsolAta));
    ixs.push(ix([
      [VAULT, true, false], [v.pool, false, false], [escrow, true, false], [wsolAta, true, false], [v.tokenVault, true, false],
      [WSOL, false, false], [TOKEN_PROGRAM, false, false], [owner, false, true], [EVENT_AUTHORITY, false, false], [PROGRAM, false, false],
    ], [...DISC.deposit, ...u64(BigInt(lamports))]));
    ixs.push(closeAccount(wsolAta, owner)); // any SOL not taken goes straight back
  } else {
    if (!escrowInfo) return json({ error: "no_deposit" }, 409);
    const e = decodeEscrow(escrowInfo.data);
    if (BigInt(lamports) > e.totalDeposit) return json({ error: "more_than_deposited", deposited: e.totalDeposit }, 409);
    ixs.push(createAtaIdempotent(owner, owner, WSOL));
    ixs.push(ix([
      [VAULT, true, false], [v.pool, false, false], [escrow, true, false], [wsolAta, true, false], [v.tokenVault, true, false],
      [WSOL, false, false], [TOKEN_PROGRAM, false, false], [owner, false, true], [EVENT_AUTHORITY, false, false], [PROGRAM, false, false],
    ], [...DISC.withdraw, ...u64(BigInt(lamports))]));
    ixs.push(closeAccount(wsolAta, owner)); // unwrap back to SOL
  }

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false }).catch((e) => ({ value: { err: String(e), logs: [] as string[] } }));
  if (sim.value.err) {
    const logs = sim.value.logs ?? [];
    const insufficient = logs.some((l) => /insufficient lamports|insufficient funds/i.test(l)) || JSON.stringify(sim.value.err).includes("InsufficientFunds");
    return json({ error: insufficient ? "not_enough_sol" : "simulation_failed", detail: sim.value.err, logs: logs.slice(-12) }, 422);
  }
  return json({ tx: btoa(String.fromCharCode(...tx.serialize())), escrow: escrow.toBase58(), lamports, simulated: true });
}
