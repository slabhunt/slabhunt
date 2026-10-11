// Season Pass mint, inside the game. The server builds the Core Candy Machine transaction, the player's own wallet
// signs and sends it, then the server checks the new NFT on-chain and switches the pass on.
//   POST { action: "status", wallet? }        -> supply left, price, dates, whether this wallet is on the free list
//   POST { action: "build", wallet }          -> base64 transactions to sign, in order (whitelist proof first if needed)
//   POST { action: "confirm", asset, signature } -> checks the asset belongs to the player's verified wallet, grants the pass and its tier
//   POST { action: "admin_whitelist", addresses } (admins) -> saves the exact whitelist used for the Merkle root
// The new asset's keypair is created here and only signs for the asset itself; it holds nothing.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createUmi } from "npm:@metaplex-foundation/umi-bundle-defaults@0.9.2";
import {
  createNoopSigner, generateSigner, publicKey, signerIdentity, some, transactionBuilder, unwrapOption, isSome,
} from "npm:@metaplex-foundation/umi@0.9.2";
import { mplCore, fetchAssetV1 } from "npm:@metaplex-foundation/mpl-core@1.1.1";
import {
  mplCandyMachine, fetchCandyMachine, safeFetchCandyGuard, mintV1, route, getMerkleRoot, getMerkleProof,
  safeFetchAllowListProofFromSeeds, safeFetchMintCounterFromSeeds,
} from "npm:@metaplex-foundation/mpl-core-candy-machine@0.2.2";
import { setComputeUnitLimit, findAssociatedTokenPda } from "npm:@metaplex-foundation/mpl-toolbox@0.9.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const TIER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
const tierOf = (attrs: { trait_type?: string; value?: unknown }[] | undefined) =>
  TIER[String(attrs?.find((x) => String(x.trait_type).toLowerCase() === "tier")?.value ?? "").toLowerCase()] ?? 0;
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");

function rpcUrl(cluster: string) {
  const key = Deno.env.get("HELIUS_API_KEY");
  const main = cluster === "mainnet-beta";
  return key ? `https://${main ? "mainnet" : "devnet"}.helius-rpc.com/?api-key=${key}` : main ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}

type Season = { id: number; name: string; starts_at: string; ends_at: string; collection: string | null; candy_machine: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "signed_out" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { action?: string; wallet?: string; asset?: string; signature?: string; addresses?: string[] };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const nowIso = new Date().toISOString();
  const { data: season } = await admin.from("seasons").select("id, name, starts_at, ends_at, collection, candy_machine")
    .lte("starts_at", nowIso).gt("ends_at", nowIso).order("starts_at", { ascending: false }).limit(1).maybeSingle();
  const s = season as Season | null;
  if (!s) return json({ error: "no_season" });
  if (!s.candy_machine || !s.collection) return json({ error: "not_launched" });
  const { data: cfg } = await admin.from("game_config").select("token_cluster, token_decimals").maybeSingle();
  const cluster = cfg?.token_cluster === "mainnet-beta" ? "mainnet-beta" : "devnet";

  const umi = createUmi(rpcUrl(cluster)).use(mplCore()).use(mplCandyMachine());
  const cmKey = publicKey(s.candy_machine);
  const { data: wl } = await admin.from("season_whitelists").select("addresses, merkle_root").eq("season_id", s.id).maybeSingle();
  const whitelist: string[] = wl?.addresses ?? [];

  // Read the candy machine and its guard groups once.
  let cm, guard;
  try {
    cm = await fetchCandyMachine(umi, cmKey);
    guard = await safeFetchCandyGuard(umi, cm.mintAuthority);
  } catch {
    return json({ error: "lookup_failed" }, 502);
  }
  const groups = guard?.groups ?? [];
  const wlGroup = groups.find((g) => g.label === "wl");
  const pubGroup = groups.find((g) => g.label === "pub");
  const pay = pubGroup && isSome(pubGroup.guards.tokenPayment) ? unwrapOption(pubGroup.guards.tokenPayment) : null;
  const root = wlGroup && isSome(wlGroup.guards.allowList) ? unwrapOption(wlGroup.guards.allowList)!.merkleRoot : null;
  const decimals = cfg?.token_decimals ?? 6;
  const left = Number(cm.data.itemsAvailable) - Number(cm.itemsRedeemed);

  // Admin: save the whitelist exactly as used by create-season, checked against the on-chain Merkle root.
  if (body.action === "admin_whitelist") {
    const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!me?.is_admin) return json({ error: "admins_only" }, 403);
    const list = (body.addresses ?? []).map((a) => String(a).trim()).filter(Boolean);
    if (!list.length || list.some((a) => !ADDRESS.test(a))) return json({ error: "bad_list" }, 400);
    if (!root) return json({ error: "no_wl_group" }, 400);
    const computed = getMerkleRoot(list);
    if (hex(computed) !== hex(root)) return json({ error: "root_mismatch" }, 400);
    const { error } = await admin.from("season_whitelists").upsert({ season_id: s.id, addresses: list, merkle_root: hex(computed), saved_at: nowIso });
    if (error) return json({ error: "save_failed" }, 500);
    return json({ saved: list.length });
  }

  const wallet = body.wallet && ADDRESS.test(body.wallet) ? body.wallet : null;
  const onList = !!wallet && !!root && whitelist.includes(wallet);

  async function used(id: number, w: string) {
    const c = await safeFetchMintCounterFromSeeds(umi, { id, user: publicKey(w), candyMachine: cmKey, candyGuard: cm.mintAuthority });
    return (c?.count ?? 0) > 0;
  }

  if (body.action === "status") {
    const wlUsed = onList ? await used(1, wallet!) : false;
    const pubUsed = wallet && pubGroup ? await used(2, wallet) : false;
    return json({
      season: s.name, ends_at: s.ends_at, cluster, left, supply: Number(cm.data.itemsAvailable),
      price: pay ? Number(pay.amount) / 10 ** decimals : null, token_mint: pay ? String(pay.mint) : null,
      free: onList && !wlUsed, minted_free: wlUsed, minted_paid: pubUsed, whitelist_ready: !root || whitelist.length > 0,
    });
  }

  if (body.action === "build") {
    if (!wallet) return json({ error: "no_wallet" }, 400);
    if (left <= 0) return json({ error: "sold_out" });
    const useWl = onList && !(await used(1, wallet));
    if (!useWl && (!pubGroup || !pay)) return json({ error: "not_eligible" });
    if (!useWl && await used(2, wallet)) return json({ error: "already_minted" });

    const minter = createNoopSigner(publicKey(wallet));
    umi.use(signerIdentity(minter));
    const txs: string[] = [];

    // Whitelist: prove membership once (creates a small proof account), then mint.
    if (useWl) {
      const proved = await safeFetchAllowListProofFromSeeds(umi, { merkleRoot: root!, user: minter.publicKey, candyMachine: cmKey, candyGuard: cm.mintAuthority });
      if (!proved) {
        const t = await route(umi, {
          candyMachine: cmKey, guard: "allowList", group: some("wl"),
          routeArgs: { path: "proof", merkleRoot: root!, merkleProof: getMerkleProof(whitelist, wallet) },
        }).buildAndSign(umi);
        txs.push(b64(umi.transactions.serialize(t)));
      }
    } else {
      // The buyer needs enough $VDRAKE; the treasury's token account must exist (create-season README).
      const [ata] = findAssociatedTokenPda(umi, { mint: pay!.mint, owner: minter.publicKey });
      const bal = await umi.rpc.getAccount(ata);
      if (!bal.exists) return json({ error: "balance", need: String(Number(pay!.amount) / 10 ** decimals) });
    }

    const asset = generateSigner(umi);
    const mintArgs = useWl
      ? { allowList: some({ merkleRoot: root! }), mintLimit: some({ id: 1 }) }
      : { tokenPayment: some({ mint: pay!.mint, destinationAta: pay!.destinationAta }), mintLimit: some({ id: 2 }) };
    const mintTx = await transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 800_000 }))
      .add(mintV1(umi, { candyMachine: cmKey, asset, collection: publicKey(s.collection), mintArgs, group: some(useWl ? "wl" : "pub") }))
      .buildAndSign(umi);
    txs.push(b64(umi.transactions.serialize(mintTx)));
    return json({ txs, asset: String(asset.publicKey), free: useWl, cluster });
  }

  if (body.action === "confirm") {
    if (!body.asset || !ADDRESS.test(body.asset)) return json({ error: "bad_input" }, 400);
    const { data: w } = await admin.from("wallets").select("address, verified").eq("user_id", user.id).maybeSingle();
    let a;
    for (let i = 0; i < 6; i++) {
      try { a = await fetchAssetV1(umi, publicKey(body.asset)); break; } catch { await new Promise((r) => setTimeout(r, 2500)); }
    }
    if (!a) return json({ status: "pending" });
    const inCollection = a.updateAuthority.type === "Collection" && String(a.updateAuthority.address) === s.collection;
    if (!inCollection) return json({ status: "wrong_collection" });
    if (!w || !w.verified || w.address !== String(a.owner)) return json({ status: "verify_wallet", owner: String(a.owner) });
    // The tier lives in the pass's metadata (make-metadata.ts): Common 1 ... Legendary 5 power-up levels.
    let tier = 0;
    try { tier = tierOf((await (await fetch(a.uri)).json())?.attributes); } catch { /* host slow; try again */ }
    if (!tier) return json({ status: "pending" });
    const { data: until, error } = await admin.rpc("grant_nft_pass_tier", { p_user: user.id, p_season: s.id, p_asset: body.asset, p_tier: tier });
    if (error) return json({ status: /duplicate|unique/i.test(error.message) ? "asset_used" : "grant_failed" });
    return json({ status: "active", pass_until: until, tier });
  }

  return json({ error: "unknown_action" }, 400);
});
