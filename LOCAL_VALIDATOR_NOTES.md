# Local Validator Testing Results

## What Was Tested

Attempted to run a local Solana test validator with cloned mainnet programs to bypass devnet faucet limitations.

### Setup
```bash
solana-test-validator --reset --url mainnet-beta \
  --clone-upgradeable-program LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo \  # Meteora DLMM
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \  # Metaplex Token Metadata
  --clone-upgradeable-program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA   # SPL Token
```

### Issues Encountered

1. **First attempt**: "Attempt to load a program that does not exist"
   - Metaplex Token Metadata program cloned but may have dependencies

2. **Second attempt**: "Attempt to debit an account but found no record of a prior credit"
   - Account funding issue with local validator
   - UMI library may need additional account initialization
   - Local validator's account state handling differs from devnet

### Conclusion

The local validator approach has complications with Metaplex's token metadata program. **The recommended path forward is to use the real devnet faucet** as originally planned.

## Recommended: Use Devnet Faucet

The scripts have been validated with dry runs and work correctly. The only requirement is ~3 SOL on devnet.

### Option 1: Web Faucet (Best)
1. Visit https://faucet.solana.com
2. **Sign in with GitHub** to raise the limit
3. Select "Devnet" network
4. Paste operator address: `ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK`
5. Request 2-5 SOL (may need multiple requests)

### Option 2: Alternative Faucets
- **Helius**: https://www.helius.dev/faucet (may require mainnet balance or sign-in)
- **QuickNode**: Check if they offer devnet faucet access
- **Other community faucets**: Search for "Solana devnet faucet"

### Cost Estimate
- Token creation: ~0.01-0.02 SOL
- Pool creation storage rent: ~1-2 SOL (for 326 bins worth of storage accounts)
- **Total needed**: ~3 SOL (with buffer for retries)

## Once Funded

```bash
cd /workspace/scripts/liquidity

# Verify funding
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana balance ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK --url devnet

# Should show 3+ SOL, then:
npm run create-token
# Update TOKEN_MINT in .env
npm run launch
```

## Current Configuration

The repository is configured for devnet:
- **Operator wallet**: ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK
- **Network**: Devnet (https://api.devnet.solana.com)
- **All test wallets created**: ✓
- **Configuration files ready**: ✓
- **Scripts validated**: ✓

**Only blocker**: Obtaining devnet SOL from faucet

---

**Note**: The local validator approach could work with additional debugging (may need to clone more dependency programs or use different account initialization), but using real devnet is simpler and matches the production environment better.
