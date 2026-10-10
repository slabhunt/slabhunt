# Season Pass mint

Each season's pass is its own Solana NFT collection (Metaplex Core) sold through a Core Candy Machine:

- **Fixed supply** (111 to start), **max 1 per wallet**
- **Priced in the game token**, paid straight to the treasury
- **Mintable only during the season** (start/end date guards)
- **Royalties on resales** (default 5%) to the treasury

The game checks a player's linked wallet for the current season's collection (the `wallet` edge function) and switches their pass on until the season ends.

## Season schedule (first year)

| Season | Length |
|---|---|
| 1 | 3 days |
| 2 | 7 days |
| 3 | 14 days |
| 4–15 | 30 days each |

Dates live in the `seasons` table. Use each season's `starts_at` / `ends_at` as `START` / `END`.

## Before the first real mint

1. **Launch the token** (Raydium LaunchLab) and note its mint address and decimals.
2. **Get a Helius API key** (free tier) and add it in Supabase → Edge Functions → Secrets as `HELIUS_API_KEY`.
3. **Prepare metadata**: one collection JSON and `1.json … 111.json` item files (name, image, attributes), hosted on Arweave/Irys or another permanent host.
4. **Test on devnet** with a devnet token before mainnet.

## Run

```bash
cd scripts/season-mint
npm install
RPC_URL=https://api.devnet.solana.com \
KEYPAIR=~/keys/vault-hunt-authority.json \
SEASON_NAME="Season 1: Lantern Run" \
START=2026-10-10T17:05:00Z END=2026-10-13T17:05:00Z \
SUPPLY=111 \
TOKEN_MINT=<token mint> PRICE_BASE_UNITS=<5000 * 10^decimals> \
TREASURY=<treasury wallet> ROYALTY_BPS=500 \
COLLECTION_URI=https://.../season-1/collection.json \
ITEM_URI_PREFIX=https://.../season-1/ \
npm run create-season
```

Then paste the printed **collection address** and your **mint page URL** into the game under **Gacha → Admin → Season pass mint**. Once a collection is set, the game shows "Mint pass" and checks wallets automatically. To stop selling the in-game coin pass, set `game_config.pass_coins_enabled = false`.

Keep the authority keypair offline and out of this repo.
