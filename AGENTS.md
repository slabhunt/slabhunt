# Slab Hunt — guide for coding agents (Cursor, Claude, others)

Slab Hunt (formerly Vault Hunt) is a location game with original creatures (no Pokémon names, art or trade dress). Players catch creatures on a real map for free raffle entries to win real graded cards. The token is **Slab ($SLAB)** on Solana (renamed from Vaultdrake / $VDRAKE on Oct 11, 2026; Vaultdrake is still a creature).

Live app: https://slabhunt.fun (also https://vault-hunt.vercel.app; Vercel deploys every push to `main`). Technical ids (repo, Vercel project, memo prefixes `vaulthunt:`) keep the old name on purpose.

## Stack

- `src/`: Vite + React 18 + TypeScript, react-leaflet maps. `npm run build` runs `tsc` then Vite. `tsconfig` covers `src/` only.
- `supabase/migrations/`: Postgres schema and all game logic as SQL functions (RPCs). Supabase project `naghdnhloupdnsmuhqws`.
- `supabase/functions/wallet/`: Deno edge function (wallet link, .sol lookup, NFT pass check).
- `scripts/season-mint/`: Season Pass NFT collection (Metaplex Core + Candy Machine).
- `scripts/liquidity/`: $SLAB token creation and the Meteora launch pool. Read its README first.
- `public/brand/`: token logo files and metadata JSON.

## Rules that matter

1. **The server decides.** Catches, coins, entries, travel, gacha and auctions are SQL functions with `security definer`. Never trust the client for rewards; never give the client write access to game tables.
2. **Migrations only add.** Change the database with a new file in `supabase/migrations/`; never edit an applied one. Avoid `drop` and `update` without `where` (approvals get flagged).
3. **Creatures**: names and art live in `src/lib/species.ts` + `src/lib/roster.ts`; game numbers live in the `species` table. Ids are permanent: never reorder.
4. **Original IP only.** No "Poké", "Pika", "ball", "gotta catch", or look-alike designs anywhere.
5. **Raffles and the gacha run on earned coins only.** Don't add anything that sells coins or entries for the token or money without a legal review.
6. **Lock down every new SQL function.** Functions are callable by everyone by default. After `create function`, add `revoke execute on function ... from public, anon;` and then `grant execute ... to authenticated` only if players should call it. Server-only helpers (coins, payments, deletions) get no grant. New tables: enable RLS; players never get insert/update/delete rights (chat posting is the one exception). Revoke from `authenticated` too for server-only helpers (older functions got it by default; since migration 20261011063453 new ones start with no player access). Check with `has_function_privilege('authenticated', ...)`.
7. **Prize randomness uses `secure_random()`**, never `random()`.
8. **Perks tied to a wallet require a verified wallet** (`wallets.verified`, proven by signature). A pasted address is only for prize delivery.

## On-chain safety (scripts/liquidity, scripts/season-mint)

- **Devnet first, every time.** Run with `DRY_RUN=1`, then devnet, check the result in an explorer, then mainnet.
- **Never commit or print secrets**: `.env`, `keys/`, keypair JSON. They're gitignored; keep it that way.
- **Positions and treasury belong to the Squads multisigs.** The operator hot wallet only pays fees and holds tokens briefly. Don't change a script so the operator owns positions or fees.
- **Launch numbers live in `scripts/liquidity/config.ts`** and must match the public disclosure doc. Change both together.
- Don't add new on-chain programs or token extensions (no transfer hooks) without asking.

## Commands

```bash
npm install && npm run dev            # app at localhost:5173 (needs .env with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
npm run build                         # type-check + build
cd scripts/liquidity && npm install
npm run plan                          # print the launch ladder (no network)
npm run create-token                  # mint $SLAB (reads .env; DRY_RUN=1 first)
npm run launch                        # create + seed the Meteora launch pool
```
