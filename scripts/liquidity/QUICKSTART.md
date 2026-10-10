# Quick Start: Running $YOINK Launch Scripts

## Prerequisites Check
```bash
cd /workspace/scripts/liquidity

# Verify dependencies installed
npm list @meteora-ag/dlmm

# Check Solana CLI
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version

# Verify devnet connection
solana config get
# Should show: RPC URL: https://api.devnet.solana.com

# Check operator wallet balance (NEEDS 5+ SOL)
solana balance ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK --url devnet
```

## Step 1: Fund Operator Wallet

**Option A: Web Faucet (Recommended)**
1. Go to https://faucet.solana.com
2. Select "Devnet"
3. Paste: `ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK`
4. Request 5 SOL
5. Wait for confirmation

**Option B: CLI (if rate limit reset)**
```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana airdrop 5 ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK --url devnet
```

## Step 2: Create Token

```bash
cd /workspace/scripts/liquidity

# View the plan (no SOL needed)
npm run plan

# Dry run to verify everything
DRY_RUN=1 npm run create-token

# Review output, then execute for real
npm run create-token
```

**Expected output:**
```
Yoink ($YOINK), 1,000,000,000 supply, 6 decimals
Metadata: https://vault-hunt.vercel.app/brand/yoink.json
Launch pool (stays with operator ...): 700,000,000
Secondary liquidity reserve -> ...: 100,000,000
Game rewards and treasury -> ...: 100,000,000
Team (vesting) -> ...: 100,000,000
Mint and freeze authority will be revoked.

Mint: <TOKEN_ADDRESS>
Sent Secondary liquidity reserve
Sent Game rewards and treasury
Sent Team (vesting)
Mint and freeze authority revoked.
Done. Next: TOKEN_MINT=<TOKEN_ADDRESS> npm run launch
```

**Save the token mint address!** It's also saved to `keys/token-mint.txt`

## Step 3: Update .env

```bash
# Open .env and add the token mint address
cd /workspace/scripts/liquidity
nano .env

# Add this line (replace with your actual mint address):
# TOKEN_MINT=<paste-mint-address-here>
```

## Step 4: Create Launch Pool

```bash
cd /workspace/scripts/liquidity

# Dry run first
DRY_RUN=1 npm run launch

# Review output, then execute
npm run launch
```

**Expected output:**
```
Cluster devnet, pair <PAIR_ADDRESS>
Start price 3e-7 SOL (bin <ID>), bin step 100, fee 100 bps
Trading opens 2026-10-15T17:00:00.000Z, positions locked until 2027-04-13T17:00:00.000Z
Positions and fees owned by GYyLxGurE4UbWxXSkh4WCKurj7uce6vT4gHkXSgugUKG
  1x-2x: 175,000,000 tokens
  2x-5x: 210,000,000 tokens
  5x-10x: 175,000,000 tokens
  10x-25x: 140,000,000 tokens

Created pair: <SIGNATURE>
Range 1x-2x
  ownership proof: <SIGNATURE>
  positions 1/1: <SIGNATURE>
  deposit 1/N: <SIGNATURE>
  ...
Range 2x-5x
  ...
Done. Next: create the Alpha Vault for this pair before LAUNCH_TIME (see README)
```

## Step 5: Verify on Devnet

**Check Token:**
```bash
# View token info
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana-keygen pubkey keys/token-mint.txt | xargs -I {} spl-token display {}

# Check allocations
solana-keygen pubkey keys/operator.json  # Should have ~700M
spl-token accounts <TOKEN_MINT>
```

**Check on Explorer:**
1. Copy token mint address
2. Go to https://explorer.solana.com/?cluster=devnet
3. Paste address and verify:
   - Supply: 1,000,000,000
   - Decimals: 6
   - Mint Authority: None (revoked ✓)
   - Freeze Authority: None (revoked ✓)

**Check Pool on Meteora:**
1. Copy pair address from launch output
2. Go to https://app.meteora.ag/?cluster=devnet
3. Search for pair
4. Verify:
   - Bins are populated correctly
   - Position owner is your multisig address
   - Lock date is correct (LAUNCH_TIME + 180 days)

## Troubleshooting

**"Insufficient funds" error:**
- Check operator balance: `solana balance keys/operator.json --url devnet`
- Need at least 2-3 SOL remaining after token creation

**"Program not found" error:**
- Verify cluster is devnet: `solana config get`
- Check .env has `CLUSTER=devnet`

**"Token mint not found" error:**
- Make sure you ran `create-token` first
- Verify TOKEN_MINT is set in .env
- Check keys/token-mint.txt exists

**Transaction timeout:**
- Devnet can be slow, just retry
- Check transaction on explorer to see if it actually succeeded

## Next Steps After Devnet Success

1. **Test the pool**: Try swapping small amounts to verify it works
2. **Review all parameters**: Confirm ladder, fees, lock dates
3. **Prepare for mainnet**: Follow LAUNCH_STATUS.md checklist
4. **Create Alpha Vault**: Use Meteora SDK before launch time
5. **Deploy to mainnet**: Same steps with mainnet config

## Emergency Contacts

If something goes wrong:
- Operator wallet: ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK
- Keys location: /workspace/scripts/liquidity/keys/
- Scripts repo: /workspace/scripts/liquidity/

**Never share operator private keys!**

## Quick Commands Reference

```bash
# View plan without executing
npm run plan

# Dry run token creation
DRY_RUN=1 npm run create-token

# Dry run pool launch
DRY_RUN=1 npm run launch

# Check balance
solana balance <ADDRESS> --url devnet

# View token info
spl-token display <TOKEN_MINT> --url devnet

# View transaction
solana confirm <SIGNATURE> --url devnet
```

---

**Ready to go!** Once you have devnet SOL, run through Steps 2-5 above.
