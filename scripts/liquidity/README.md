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

1. Mint the token with 6 decimals and the full supply, send 70% to the operator, then revoke mint and freeze authority.
2. Dry run on devnet: `DRY_RUN=1 CLUSTER=devnet RPC_URL=… OPERATOR_KEYPAIR=… TOKEN_MINT=… LIQUIDITY_MULTISIG=… LAUNCH_TIME=… npm run launch`.
3. Real devnet run (same, without `DRY_RUN`). Check the pair on Meteora's devnet app: the bins, the owner (the multisig) and the lock date.
4. Create the Alpha Vault for the pair before `LAUNCH_TIME`, using Meteora's alpha-vault SDK or launch tool, with the settings above. (Not scripted here yet.)
5. Repeat steps 2–4 on mainnet with `CLUSTER=mainnet-beta` and a paid RPC.
6. Publish the pair, position, lock and vault addresses.

Keep `keys/` private and backed up: the base keys create the positions but cannot withdraw them.

## After launch

- Fees: the Liquidity multisig claims fees weekly and sweeps SOL to the vaults by the split in `config.ts`.
- From day 7: open one Raydium and one Orca pool with the 10% reserve plus SOL from the Secondary liquidity share, within ±25% of market.
- Alerts and the pool dashboard (planned): Helius webhooks will flag big swaps, sharp moves and positions out of range, and prepare a fix as a multisig proposal. Signers approve every move.
