# $YOINK liquidity runbook

Draft settings live in `config.ts`. `npm run plan` prints the ladder and what it raises; no keys or network needed.

## Defaults and why

| Setting | Value | Why |
| --- | --- | --- |
| Supply | 1,000,000,000, 6 decimals | Easy math; mint and freeze authority revoked at launch |
| Launch pool | 70% of supply, single-sided | The public gets most of the supply; no private sale |
| Starting value | 300 SOL fully diluted (3e-7 SOL per token) | Room to grow without giving supply away |
| Ladder | 25% from 1x to 2x, 30% from 2x to 5x, 25% from 5x to 10x, 20% from 10x to 25x | Deep at the start for a smooth open; thinner higher up so selling slows as price rises |
| Bin step / fee | 1% / 1% | Standard for new tokens; we keep 80% of fees, Meteora 20% |
| Lock | 180 days | Long enough to be credible, short enough to rebalance later |
| Fair start | Alpha Vault, pro-rata, 50 SOL total, 1 SOL per wallet | Everyone in the vault pays the same price; blunts sniper bots |
| Raydium + Orca | Opened from day 7, at least 25 SOL per side, within ±25% of market | Waits for price discovery; deep enough not to be drained |

If every bin filled, the ladder raises about 1,354 SOL (76 SOL by 2x, 283 by 5x, 663 by 10x). That is a ceiling, not a forecast.

## Wallets (do this first)

1. Create Squads multisigs (2-of-3 or 3-of-5, signers on separate devices): Liquidity, Development, Card prizes, Buyback, Treasury, and a team vesting contract.
2. Create an **operator** wallet. It only pays fees and holds the tokens while seeding. It never owns a position.
3. Put the addresses in the disclosure doc.

## Launch steps

Setup, once: `npm install` in this folder, then `cp .env.example .env` and fill it in. Make a devnet operator wallet with `solana-keygen new -o keys/operator.json` and fund it with `solana airdrop 5 <address> --url devnet`.

1. **Token:** `DRY_RUN=1 npm run create-token`, then `npm run create-token`. It mints 1B $YOINK to the operator, sends the reserve, treasury and team buckets to their wallets, and revokes mint and freeze authority. Put the printed mint in `.env` as `TOKEN_MINT`.
2. **Launch pool:** `DRY_RUN=1 npm run launch`, then `npm run launch`. Check the pair on Meteora's devnet app: the bins, the owner (the multisig) and the lock date.
3. **Alpha Vault:** create it for the pair before `LAUNCH_TIME`, with Meteora's alpha-vault SDK or launch tool and the settings above. (Not scripted yet.)
4. **Mainnet:** new operator wallet, `CLUSTER=mainnet-beta`, a paid RPC, then steps 1–3 again. Upload the logo and metadata to Arweave first and set `METADATA_URI`, so the token's image doesn't depend on our website.
5. **Publish** the mint, pair, position, lock and vault addresses in the disclosure.

Keep `keys/` private and backed up: the base keys create the positions but cannot withdraw them.

## After launch

- Fees: the Liquidity multisig claims fees weekly and sweeps SOL to the vaults by the split in `config.ts`.
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
