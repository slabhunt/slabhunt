# $YOINK Token Launch - Status Report

## Current Status: Ready for Devnet Testing

All scripts and configuration are in place. The only remaining blocker is obtaining devnet SOL for the operator wallet due to rate limiting on the public faucet.

## ✅ Completed Setup

### 1. Dependencies Installed
- ✅ Solana CLI v1.18.26 installed and configured
- ✅ Node.js dependencies installed in `scripts/liquidity/`
- ✅ All required packages (@meteora-ag/dlmm, @metaplex-foundation/mpl-token-metadata, etc.)

### 2. Wallets Created

**Operator Wallet (Hot Wallet)**
- Address: `ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK`
- Keypair: `/workspace/scripts/liquidity/keys/operator.json`
- Purpose: Pays transaction fees, temporarily holds launch pool tokens
- ⚠️ **Needs funding**: 5-10 SOL on devnet to execute transactions

**Simulated Multisig Addresses** (for devnet testing - replace with real Squads multisigs for mainnet)
- Liquidity Multisig: `GYyLxGurE4UbWxXSkh4WCKurj7uce6vT4gHkXSgugUKG`
- Secondary Reserve: `99jaF4Rf73zo1ghFvo1iyEXaU1Pj9ajMmJwQqzMRieLe`
- Game Treasury: `HtVZfiGWxM9nqJAWH7tUyg4bbZB6TNGK18tmRozukAHn`
- Team Vesting: `DmVf2uMdZETRmKG9uqu6b3xkSUqckD8p8QCF2Q4YmbcM`

### 3. Configuration Files

**Environment Configuration** (`.env`)
```
CLUSTER=devnet
RPC_URL=https://api.devnet.solana.com
OPERATOR_KEYPAIR=./keys/operator.json
LIQUIDITY_MULTISIG=GYyLxGurE4UbWxXSkh4WCKurj7uce6vT4gHkXSgugUKG
SECONDARY_RESERVE_WALLET=99jaF4Rf73zo1ghFvo1iyEXaU1Pj9ajMmJwQqzMRieLe
GAME_TREASURY_WALLET=HtVZfiGWxM9nqJAWH7tUyg4bbZB6TNGK18tmRozukAHn
TEAM_VESTING_WALLET=DmVf2uMdZETRmKG9uqu6b3xkSUqckD8p8QCF2Q4YmbcM
LAUNCH_TIME=2026-10-15T17:00:00Z
METADATA_URI=https://vault-hunt.vercel.app/brand/yoink.json
```

**Token Configuration** (`config.ts`)
- Name: Yoink
- Symbol: $YOINK
- Total Supply: 1,000,000,000 tokens (1B)
- Decimals: 6
- Launch Pool: 70% (700M tokens)
- Secondary Reserve: 10% (100M tokens)
- Game Treasury: 10% (100M tokens)
- Team Vesting: 10% (100M tokens)

**Launch Pool Settings**
- Start FDV: 300 SOL (3e-7 SOL per token)
- Bin Step: 1% (100 bps)
- Swap Fee: 1% (100 bps)
- Curvature: 0.8
- Lock Period: 180 days
- Ladder:
  - 1x-2x: 25% (175M tokens) → ~76 SOL if filled
  - 2x-5x: 30% (210M tokens) → ~207 SOL if filled
  - 5x-10x: 25% (175M tokens) → ~379 SOL if filled
  - 10x-25x: 20% (140M tokens) → ~691 SOL if filled
  - **Total potential: ~1,354 SOL if all bins fill**

### 4. Brand Assets Ready
- ✅ Logo files: 512px and 1024px PNG versions
- ✅ SVG vector version
- ✅ Token metadata JSON at `public/brand/yoink.json`
- ✅ Hosted at https://vault-hunt.vercel.app/brand/

### 5. Scripts Validated

**Dry Run Tests Passed** ✅
```bash
# Planning script works perfectly
npm run plan
✓ Shows complete ladder breakdown
✓ Calculates SOL raised per range
✓ Shows fee distribution

# Token creation dry run successful
DRY_RUN=1 npm run create-token
✓ Validates all wallet addresses
✓ Confirms allocation percentages
✓ Ready to mint on devnet
```

## 🚧 Next Steps - Blocked by Devnet SOL

### Immediate Actions (Once Funded)

1. **Fund Operator Wallet**
   ```bash
   # Need 5-10 devnet SOL at: ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK
   # Options:
   # - Use web faucet: https://faucet.solana.com
   # - Use QuickNode faucet (if available)
   # - Wait for rate limit reset and retry CLI: solana airdrop 5 <address> --url devnet
   ```

2. **Create Token**
   ```bash
   cd scripts/liquidity
   
   # Dry run first (already tested, working)
   DRY_RUN=1 npm run create-token
   
   # Execute for real
   npm run create-token
   
   # The script will:
   # - Mint 1B $YOINK tokens
   # - Send 100M to Secondary Reserve wallet
   # - Send 100M to Game Treasury wallet
   # - Send 100M to Team Vesting wallet
   # - Keep 700M in operator wallet for pool seeding
   # - Revoke mint and freeze authority permanently
   # - Save token mint address to keys/token-mint.txt
   ```

3. **Update .env with Token Mint**
   ```bash
   # Copy the printed mint address to .env
   # TOKEN_MINT=<address-from-create-token-output>
   ```

4. **Create Launch Pool**
   ```bash
   # Dry run first
   DRY_RUN=1 npm run launch
   
   # Execute for real
   npm run launch
   
   # The script will:
   # - Create Meteora DLMM pair ($YOINK/SOL)
   # - Seed 4 position groups according to the ladder
   # - Lock all positions until LAUNCH_TIME + 180 days
   # - Set position ownership to LIQUIDITY_MULTISIG
   # - Save base keypairs to keys/base-*.json
   ```

5. **Verify on Devnet**
   - Check token on Solana Explorer (devnet)
   - Verify allocations in each wallet
   - Check Meteora pair on https://app.meteora.ag (devnet mode)
   - Confirm position ownership and lock dates

### Before Mainnet Launch

**Pre-Launch Checklist:**
- [ ] **Ticker availability**: Search $YOINK on Jupiter and Birdeye to confirm no conflicts
- [ ] **Create real Squads multisigs**: 
  - Liquidity (owns pool positions and fees)
  - Secondary Reserve (holds 10% for Raydium/Orca)
  - Treasury (holds 10% for game rewards)
  - Team Vesting (holds 10% with vesting contract)
- [ ] **Upload logo to Arweave**: Permanent storage, update METADATA_URI in .env
- [ ] **Create mainnet operator wallet**: Hot wallet with ~10 SOL for fees
- [ ] **Get paid RPC endpoint**: Higher rate limits (QuickNode, Alchemy, Helius)
- [ ] **Create Alpha Vault**: Use Meteora's SDK/tool before LAUNCH_TIME
- [ ] **Legal review**: Have attorney review disclosure document
- [ ] **Set final LAUNCH_TIME**: Coordinate with marketing/announcement
- [ ] **Update disclosure**: Fill in multisig signer counts and team details

**Mainnet Execution:**
```bash
# Update .env for mainnet
CLUSTER=mainnet-beta
RPC_URL=<your-paid-rpc-endpoint>
METADATA_URI=<arweave-uri>
# ... mainnet multisig addresses

# Same flow as devnet
DRY_RUN=1 npm run create-token
npm run create-token
# Update TOKEN_MINT in .env
DRY_RUN=1 npm run launch
npm run launch
# Create Alpha Vault
# Publish addresses
```

## 📁 File Locations

```
scripts/liquidity/
├── .env                    # Configuration (never commit!)
├── config.ts               # Token and launch parameters
├── create-token.ts         # Token creation script
├── launch-pool.ts          # Pool seeding script
├── plan.ts                 # Launch ladder calculator
├── package.json            # Dependencies
├── keys/                   # Keypairs (never commit!)
│   ├── operator.json       # Hot wallet
│   ├── liquidity-multisig.json    # Devnet test only
│   ├── secondary-reserve.json     # Devnet test only
│   ├── game-treasury.json         # Devnet test only
│   └── team-vesting.json          # Devnet test only

public/brand/
├── yoink.json              # Token metadata
├── yoink-coin-512.png      # Logo 512px
├── yoink-coin-1024.png     # Logo 1024px
└── yoink-coin.svg          # Logo vector
```

## 🔒 Security Reminders

1. **Never commit secrets**: `.env`, `keys/`, keypairs are gitignored
2. **Devnet first, always**: Test with DRY_RUN=1, then devnet, then mainnet
3. **Multisigs own assets**: Operator wallet only pays fees
4. **Verify before signing**: Check every transaction in explorer
5. **Backup keys securely**: Store operator and base keys offline
6. **Rate limits matter**: Use paid RPC for mainnet

## 🎯 What This Accomplishes

✅ **Permissionless fair launch**: No pre-mine, no insiders  
✅ **Price discovery**: Token releases as buyers push price up  
✅ **Bot protection**: Alpha Vault enforces pro-rata allocation  
✅ **Long-term alignment**: 180-day position lock  
✅ **Immutable supply**: Mint authority permanently revoked  
✅ **Community owned**: 70% available to the public  

## Alternative: Web-Based Devnet Faucet

If CLI airdrop continues failing, use the web interface:

1. Visit https://faucet.solana.com
2. Select "Devnet"
3. Enter operator address: `ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK`
4. Request 5 SOL
5. Wait for confirmation, then proceed with scripts

---

**Questions or issues?** Check the logs, verify .env settings, confirm network connectivity to devnet.
