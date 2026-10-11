# Launch day: Sunday, Oct 11, 2026

Times are your time (Haiti/Eastern, UTC-4) with UTC in brackets. Trading opens **8:00 PM (00:00 UTC Oct 12)**.
Everything runs on **your computer** in `scripts/liquidity`, with your own wallets. If any step fails, stop and paste
the error; don't improvise with real tokens.

| When | Step |
|---|---|
| now - 3:15 PM | **Squads multisig** (see below). Send the vault addresses in chat so they can be checked. |
| 3:15 PM | `git pull`, `npm install`. Fill `.env` (mainnet section below). |
| 3:30 PM | `npm run upload-metadata`: uploads logo + metadata to Arweave; put the printed `METADATA_URI` in `.env`. |
| 3:40 PM | `DRY_RUN=1 npm run create-token`: read the plan and the wallet check. Then `npm run create-token`. Put `TOKEN_MINT` in `.env`. |
| 3:50 PM | `DRY_RUN=1 npm run launch`, then `npm run launch`. Open the pair on Meteora: 4 ranges, owner = Liquidity vault, lock 180 days. |
| 4:00 PM | `npm run vault -- create`, then `npm run vault -- status`. Deposits are open from now until ~6:55 PM. |
| 4:05 PM | **Announce on X:** name, ticker, mint address, the fair-start vault link, how deposits and refunds work, open time. Pin it. |
| 4:10 PM | `npm run cost`. Note the result. |
| 6:55 PM | Deposits close (about 65 minutes before open). |
| 7:00-7:50 PM | `npm run vault -- fill` (the vault buys before anyone else). Run `npm run vault -- status` after: "bought with" should be filled. |
| 8:00 PM | **Trading opens.** Post the Meteora and DexScreener links. |
| tonight | Publish mint, pool, positions, lock, vault and multisig addresses (disclosure + X). DexScreener "Enhanced token info" with `token-banner-1500x500.png`. |
| this week | Team tokens into a Streamflow vesting contract (12-month cliff, 36 months linear) from the Team vault. Jupiter verification. |
| day 7+ | Raydium + Orca pools from the reserve (see README). |

## Squads multisig (app.squads.so)

1. Pick 3 signer wallets on **different devices**, e.g. Phantom on your phone, a second wallet on your computer (or a
   Ledger), and one held by someone you trust. Each signer keeps its own recovery phrase on paper.
2. At app.squads.so, connect one of the signer wallets and create a multisig named "Slab Hunt" with all 3 members and a
   **threshold of 2**. It costs about 0.1 SOL.
3. Use the multisig's **vault** addresses (the default vault, plus more vaults/accounts if you add them for
   Treasury and Team). **Not** the multisig account address: tokens sent there are lost. The scripts now refuse that
   address.
4. Send a tiny amount of SOL (0.001) to each vault and check it arrives in the Squads app.

## `.env` for mainnet

```
CLUSTER=mainnet-beta
RPC_URL=<your Helius mainnet URL>
OPERATOR_KEYPAIR=./keys/operator.json        # the mainnet operator wallet with 1.5-2 SOL
LIQUIDITY_MULTISIG=<Liquidity vault>
SECONDARY_RESERVE_WALLET=<Liquidity vault>
GAME_TREASURY_WALLET=<Treasury vault>
TEAM_VESTING_WALLET=<Team vault>
LAUNCH_TIME=2026-10-12T00:00:00Z
METADATA_URI=<from upload-metadata>
TOKEN_MINT=<from create-token>
```

## In the game after launch

- Admin → Power-ups: set the $SLAB mint address. **Leave $SLAB purchases (power-ups, draw tickets, pass mint) switched
  off until a lawyer has signed off.** Coins, catching and the free raffles keep working as they are.
- Add the mint address to `LAUNCH_KIT.md` and the site.
