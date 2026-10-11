# Season Pass mint

Each season's pass is its own Solana NFT collection (Metaplex Core) sold through a Core Candy Machine:

- **Fixed supply** (420 for Season 1), **max 1 per wallet**, everyone pays (no free mint)
- **Tiers**: each pass is Common, Uncommon, Rare, Epic or Legendary, dealt in random order. While the season runs, the tier adds 1 to 5 free power-up levels to every track (throws, speed, sight); Legendary maxes everything
- **Priced in the game token**, paid straight to the treasury
- **Mintable only during the season** (start/end date guards)
- **Royalties on resales** (default 5%) to the treasury

The game checks a player's linked wallet for the current season's collection (the `wallet` edge function) and switches their pass on until the season ends.

## Genesis collection (Season 1)

- **420 passes**
- **Default split (420):** Common 294 (70%), Uncommon 84 (20%), Rare 30 (7%), Epic 9 (2%), Legendary 3 (0.7%). Change it with `SPLIT`.
- Everyone else mints in the `pub` group at the token price.

## Season schedule (first year)

| Season | Length |
|---|---|
| 1 | 3 days |
| 2 | 7 days |
| 3 | 14 days |
| 4–15 | 30 days each |

Dates live in the `seasons` table. Use each season's `starts_at` / `ends_at` as `START` / `END`.

## Before the first real mint

1. **Launch the token** (Meteora launch pool, see `scripts/liquidity`) and note its mint address and decimals.
2. **Get a Helius API key** (free tier) and add it in Supabase → Edge Functions → Secrets as `HELIUS_API_KEY`.
3. **Prepare metadata**: `SEASON_NAME="Season 1: Lantern Run" SUPPLY=420 IMAGE_BASE=https://.../ npm run make-metadata` writes `collection.json`, `1.json … 420.json` (each with a Tier) and `tiers.json` (the shuffled tier list and its seed). Upload the folder to Arweave/Irys and publish `tiers.json` so players can see the split before minting.
4. **Test on devnet** with a devnet token before mainnet.

## Run

```bash
cd scripts/season-mint
npm install
RPC_URL=https://api.devnet.solana.com \
KEYPAIR=~/keys/vault-hunt-authority.json \
SEASON_NAME="Season 1: Lantern Run" \
START=2026-10-10T17:05:00Z END=2026-10-13T17:05:00Z \
SUPPLY=420 \
TOKEN_MINT=<token mint> PRICE_BASE_UNITS=<5000 * 10^decimals> \
TREASURY=<treasury wallet> ROYALTY_BPS=500 \
COLLECTION_URI=https://.../season-1/collection.json \
ITEM_URI_PREFIX=https://.../season-1/ \
npm run create-season
```

Then, in the game under **Gacha → Admin → Season pass mint**:

1. Paste the printed **collection address** and save.
2. Under **In-game mint**, paste the **Candy Machine address** and save. The pass card now shows a Mint button; no separate mint page is needed.
3. Make sure the treasury has a $VDRAKE token account (send it any amount of $VDRAKE once), or paid mints fail.

Players mint from their wallet app's browser. The game builds the transaction, their wallet signs it, and the pass switches on when the minting wallet is their verified wallet in Profile. Once a collection is set, the game shows "Mint pass" and checks wallets automatically. To stop selling the in-game coin pass, set `game_config.pass_coins_enabled = false`.

Keep the authority keypair offline and out of this repo.
