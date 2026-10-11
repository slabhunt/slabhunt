# $VDRAKE liquidity runbook

Draft settings live in `config.ts`. `npm run plan` prints the ladder and what it raises; no keys or network needed.

## Defaults and why

| Setting | Value | Why |
| --- | --- | --- |
| Supply | 1,000,000,000, 6 decimals | Easy math; mint and freeze authority revoked at launch |
| Launch pool | 70% of supply, single-sided | The public gets most of the supply; no private sale |
| Starting value | 300 SOL fully diluted (3e-7 SOL per token) | Room to grow without giving supply away |
| Ladder | 25% from 1x to 2x, 30% from 2x to 5x, 25% from 5x to 10x, 20% from 10x to 25x | Deep at the start for a smooth open; thinner higher up so selling slows as price rises |
| Bin step / fee | 1% / 1% | Standard for new tokens; Meteora keeps 25% of each fee (measured on devnet), the Liquidity multisig 75% |
| Lock | 180 days | Long enough to be credible, short enough to rebalance later |
| Fair start | Pro-rata Alpha Vault buying up to 50 SOL; tokens unlock over 24 hours starting 1 hour after open | No speed race: deposits over the cap are refunded pro rata, so bots gain nothing by being first; the unlock stops an instant dump |
| Raydium + Orca | Opened from day 7, at least 25 SOL per side, within ±25% of market | Waits for price discovery; deep enough not to be drained |

If every bin filled, the ladder raises about 1,354 SOL (76 SOL by 2x, 283 by 5x, 663 by 10x). That is a ceiling, not a forecast.

## Wallets (do this first)

1. Create Squads multisigs (2-of-3 or 3-of-5, signers on separate devices): Liquidity, Development, Card prizes, Buyback, Treasury, and a team vesting contract.
2. Create an **operator** wallet. It only pays fees and holds the tokens while seeding. It never owns a position.
3. Put the addresses in the disclosure doc.

## Launch steps

Setup, once: `npm install` in this folder, then `cp .env.example .env` and fill it in. Make a devnet operator wallet with `solana-keygen new -o keys/operator.json` and fund it with `solana airdrop 5 <address> --url devnet`.

0. **Logo and metadata:** `npm run upload-metadata` uploads the logo and metadata to Arweave and prints `METADATA_URI` for `.env`.
1. **Token:** `DRY_RUN=1 npm run create-token`, then `npm run create-token`. It mints 1B $VDRAKE to the operator, sends the reserve, treasury and team buckets to their wallets, and revokes mint and freeze authority. Put the printed mint in `.env` as `TOKEN_MINT`.
2. **Launch pool:** `DRY_RUN=1 npm run launch`, then `npm run launch`. Check the pair on Meteora's devnet app: the bins, the owner (the multisig) and the lock date.
3. **Alpha Vault (fair start):** `npm run vault -- create` (before `LAUNCH_TIME`), then `npm run vault -- status`. On devnet, test it with `npm run vault -- deposit 0.5`. After deposits close (about 5 minutes before the vault's buying window, which ends at `LAUNCH_TIME`), run `npm run vault -- fill` so the vault buys from the pool before trading opens.
4. **Cost check:** `npm run cost` lists every transaction the operator paid for, with fees and rent. Run it before any test deposit, since a deposit moves SOL into the vault rather than spending it.
5. **Mainnet:** new operator wallet, `CLUSTER=mainnet-beta`, a paid RPC, then steps 1–3 again. Upload the logo and metadata to Arweave first and set `METADATA_URI`, so the token's image doesn't depend on our website.
6. **Publish** the mint, pair, position, lock and vault addresses in the disclosure.

Keep `keys/` private and backed up: the base keys create the positions but cannot withdraw them.

## After launch

- Fees: `npm run propose-fees` (weekly via the "Propose LP fees" GitHub Action) proposes two things to the Squads multisig: a sweep of SOL already in the Liquidity vault, split by `PROCEEDS` in `config.ts`, and a claim of the positions' new swap fees. Signers approve and execute claims first; the next run sweeps them. The proposer key (`PROPOSER_KEYPAIR`) must be a multisig member with the **Initiate** permission only, so even if it leaks it can't approve or move anything. Test on devnet with `DRY_RUN=1` first, then for real against a devnet multisig. The schedule only runs once the repository variable `PROPOSE_FEES_ENABLED` is `true`.
- From day 7: open one Raydium and one Orca pool with the 10% reserve plus SOL from the Secondary liquidity share, within ±25% of market.
- Alerts and the pool dashboard (planned): Helius webhooks will flag big swaps, sharp moves and positions out of range, and prepare a fix as a multisig proposal. Signers approve every move.

## Devnet rehearsal (Oct 10, 2026)

Full run on devnet, all steps passed:

| Item | Address / result |
| --- | --- |
| Token mint | `2wGCiwdgSi6emRJKn9huhw9xzjpu19wGh8j6DomKiD3U` (mint + freeze authority revoked) |
| Pool (DLMM pair) | `CdeppSSpzQF1w5PUiuDY2HuR3fhvdcdHzFdRRhrMWCoM` |
| Position owner | test Liquidity wallet `GYyLxGurE4UbWxXSkh4WCKurj7uce6vT4gHkXSgugUKG` |
| Ranges seeded | 1x–2x 175M, 2x–5x 210M, 5x–10x 175M, 10x–25x 140M |
| Trading opens | 2026-10-11 20:55 UTC; positions locked until 2027-04-09 20:55 UTC |

Lessons folded into the scripts: load the DLMM SDK's CommonJS build; create the operator's wrapped-SOL account first; oversized deposit batches are split automatically; re-runs skip finished positions.

Devnet fair-start vault: `4DLfYEmcV3FboufWnB7LXqM8TGy2oMSAsGzWHnrjZA91` (pro-rata, 50 SOL cap). Deposits close 1 hour 5 minutes before trading opens; the vault's buying window is the last hour before open, so run `npm run vault -- fill` inside it.

Measured cost of the full devnet run (token, pool, 4 ranges, vault, plus retries): **1.134 SOL** (10 → 8.866 SOL before the test deposit). Budget about 1.5–2 SOL in the mainnet operator wallet to cover priority fees and retries.

Second devnet run (fresh token `9vixyhwQwu84Pd2QvAVZeZr6LzJho3ocgXQWtnAwJYkY`, pool `4RwMsu8xgPxsa4M3qi14suXDakEHschkMbaqNLySGd2N`, vault `6N5eLf2pQuCeaHHJmUAGSRapZ6BGz1zhCrYSXRKQVedt`): vault deposit, vault fill and trading all worked. Measured swaps:

| Buy | Tokens out | Fee | Price move |
| --- | --- | --- | --- |
| 0.1 SOL | 322,784 | 0.0008 SOL (0.80%), protocol share 0.0002 | none (stayed in the opening bin) |
| 1 SOL | 3,165,498 | 0.0096 SOL (0.96%), protocol share 0.0024 | +3.0% (3.067e-7 to 3.160e-7) |

Range 4's second position on this pool stayed unfilled (a few token units short, from the ownership-proof dust; fixed in the script for fresh launches).

## Mainnet checklist

Things only you can do (each needs your own accounts or signature):

- [x] **Ticker:** Vaultdrake / $VDRAKE (checked on Jupiter, Birdeye and the web on Oct 10, 2026; re-check on launch day).
- [ ] **Squads multisig** at app.squads.so: one multisig (e.g. 2-of-3 signers on separate devices) with separate vaults for Liquidity, Treasury and Team. Put the vault addresses in `.env` as `LIQUIDITY_MULTISIG`, `SECONDARY_RESERVE_WALLET` (Liquidity vault), `GAME_TREASURY_WALLET` and `TEAM_VESTING_WALLET`. Move the team tokens into a vesting contract (e.g. Streamflow: 12-month cliff, 36 months linear) right after launch.
- [ ] **Operator wallet on your own computer:** `solana-keygen new -o keys/operator.json` (never on a cloud machine), funded with 1.5–2 SOL.
- [ ] **Paid RPC** (e.g. Helius) in `RPC_URL`; set `CLUSTER=mainnet-beta`.
- [ ] **Attorney** has reviewed the disclosure.

Then, in order, one clean run each (stop and ask if anything fails; don't improvise with real tokens):

```bash
npm run upload-metadata                  # put METADATA_URI in .env
DRY_RUN=1 npm run create-token && npm run create-token   # put TOKEN_MINT in .env
# set LAUNCH_TIME at least 2 hours ahead
DRY_RUN=1 npm run launch && npm run launch
npm run vault -- create && npm run vault -- status
npm run cost                             # record what it cost
# in the vault's buying window (the hour before LAUNCH_TIME):
npm run vault -- fill
```

Finally publish the mint, pool, vault, lock and multisig addresses in the disclosure.

Final rehearsal with the real scripts (Oct 11, 2026, ~01:55 UTC): Vaultdrake token `6yUdy69XceyHtQKSvo9fZcEnVpAdorQnY47KDA5Wgm7x` with Arweave metadata and the treasury multisig as metadata authority, pool `8WMn6ZUEcXtiJ1su1wuo9x5ASndZRWwsAFQjnSJU6HPb` with all four ranges at exactly the planned amounts, vault `78YQAFitGcSznRRQJV9Ye6YyQve8GApBXkEQ2NVKsifD`. No failed transactions.
