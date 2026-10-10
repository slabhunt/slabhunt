# $YOINK Token Launch - Visual Workflow

```
┌──────────────────────────────────────────────────────────────────────┐
│                    $YOINK TOKEN LAUNCH WORKFLOW                       │
└──────────────────────────────────────────────────────────────────────┘

══════════════════════════════════════════════════════════════════════
 PHASE 1: SETUP (COMPLETED ✓)
══════════════════════════════════════════════════════════════════════

1. Install Dependencies
   [✓] Solana CLI v1.18.26
   [✓] Node.js packages
   [✓] Meteora DLMM SDK
   [✓] Metaplex Token Metadata SDK

2. Create Wallets
   [✓] Operator Wallet (hot wallet for fees)
       └─> ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK
   
   [✓] Multisig Addresses (devnet test wallets)
       ├─> Liquidity:    GYyLxGurE4UbWxXSkh4WCKurj7uce6vT4gHkXSgugUKG
       ├─> Sec Reserve:  99jaF4Rf73zo1ghFvo1iyEXaU1Pj9ajMmJwQqzMRieLe
       ├─> Treasury:     HtVZfiGWxM9nqJAWH7tUyg4bbZB6TNGK18tmRozukAHn
       └─> Team Vesting: DmVf2uMdZETRmKG9uqu6b3xkSUqckD8p8QCF2Q4YmbcM

3. Configuration
   [✓] .env file configured
   [✓] config.ts parameters set
   [✓] Metadata JSON ready

══════════════════════════════════════════════════════════════════════
 PHASE 2: FUNDING (BLOCKED ⚠️)
══════════════════════════════════════════════════════════════════════

4. Fund Operator Wallet
   [⚠️] Need 5-10 SOL on devnet
       
   Options:
   A) Web Faucet: https://faucet.solana.com
      └─> Enter: ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK
   
   B) CLI: solana airdrop 5 <address> --url devnet
      (currently rate limited)
   
   C) Alternative faucets (QuickNode, etc.)

══════════════════════════════════════════════════════════════════════
 PHASE 3: TOKEN CREATION (READY TO EXECUTE)
══════════════════════════════════════════════════════════════════════

5. Preflight Check
   $ bash preflight-check.sh
   └─> Validates configuration, funding, network

6. Dry Run
   $ DRY_RUN=1 npm run create-token
   └─> Preview without executing

7. Create Token
   $ npm run create-token
   
   ┌─────────────────────────────────────┐
   │  Creates 1,000,000,000 $YOINK      │
   │  Decimals: 6                       │
   │  Metadata: vault-hunt.vercel.app   │
   └─────────────────────────────────────┘
            │
            ├─> 700,000,000 → Operator (for pool)
            ├─> 100,000,000 → Secondary Reserve
            ├─> 100,000,000 → Treasury
            └─> 100,000,000 → Team Vesting
   
   Authorities Revoked:
   [✗] Mint Authority    (no more tokens ever)
   [✗] Freeze Authority  (no freezing accounts)
   
   Result:
   └─> Token Mint Address saved to keys/token-mint.txt

8. Update Configuration
   $ nano .env
   └─> Set TOKEN_MINT=<address-from-step-7>

══════════════════════════════════════════════════════════════════════
 PHASE 4: LAUNCH POOL CREATION (READY TO EXECUTE)
══════════════════════════════════════════════════════════════════════

9. Dry Run
   $ DRY_RUN=1 npm run launch
   └─> Preview pool creation

10. Create Launch Pool
    $ npm run launch
    
    ┌─────────────────────────────────────────┐
    │  Meteora DLMM Launch Pool              │
    │  Pair: $YOINK / SOL                    │
    │  Fee: 1% (80% to owner, 20% Meteora)  │
    └─────────────────────────────────────────┘
             │
             ├─> Bin Step: 1%
             ├─> Start Price: 3e-7 SOL
             ├─> Start FDV: 300 SOL
             └─> Lock: 180 days
    
    Position Groups (4 ranges):
    
    ┌────────────────────────────────────────┐
    │ Range 1: 1x-2x  (25% = 175M tokens)   │
    │ Price: 300-600 SOL FDV                 │
    │ Bins: 70 bins                          │
    │ Max Raise: ~76 SOL                     │
    └────────────────────────────────────────┘
             ↓
    ┌────────────────────────────────────────┐
    │ Range 2: 2x-5x  (30% = 210M tokens)   │
    │ Price: 600-1,500 SOL FDV               │
    │ Bins: 93 bins                          │
    │ Max Raise: ~207 SOL                    │
    └────────────────────────────────────────┘
             ↓
    ┌────────────────────────────────────────┐
    │ Range 3: 5x-10x (25% = 175M tokens)   │
    │ Price: 1,500-3,000 SOL FDV             │
    │ Bins: 70 bins                          │
    │ Max Raise: ~379 SOL                    │
    └────────────────────────────────────────┘
             ↓
    ┌────────────────────────────────────────┐
    │ Range 4: 10x-25x (20% = 140M tokens)  │
    │ Price: 3,000-7,500 SOL FDV             │
    │ Bins: 93 bins                          │
    │ Max Raise: ~691 SOL                    │
    └────────────────────────────────────────┘
    
    Total Potential: 1,354 SOL if all bins fill
    
    Position Ownership:
    └─> LIQUIDITY_MULTISIG (not operator!)

══════════════════════════════════════════════════════════════════════
 PHASE 5: VERIFICATION (AFTER EXECUTION)
══════════════════════════════════════════════════════════════════════

11. Verify Token
    $ solana-keygen pubkey keys/token-mint.txt
    $ spl-token display <TOKEN_MINT> --url devnet
    
    Check on Solana Explorer (devnet):
    [✓] Supply: 1,000,000,000
    [✓] Decimals: 6
    [✓] Mint Authority: None
    [✓] Freeze Authority: None
    
    Check Allocations:
    [✓] Operator: ~700M
    [✓] Secondary: 100M
    [✓] Treasury: 100M
    [✓] Team: 100M

12. Verify Pool
    Visit Meteora app (devnet mode)
    
    Check:
    [✓] Pair active
    [✓] All bins populated
    [✓] Position owner = multisig
    [✓] Lock date correct
    [✓] Fees configured (1%)

══════════════════════════════════════════════════════════════════════
 BEFORE MAINNET LAUNCH
══════════════════════════════════════════════════════════════════════

Pre-Launch Checklist:

Infrastructure:
[ ] Create real Squads multisigs (2-of-3 or 3-of-5)
[ ] Create mainnet operator wallet
[ ] Get paid RPC endpoint (QuickNode/Helius)
[ ] Upload logo to Arweave (permanent storage)
[ ] Update METADATA_URI to Arweave link

Market:
[ ] Verify $YOINK ticker available
[ ] Create Alpha Vault with Meteora
[ ] Set final LAUNCH_TIME
[ ] Coordinate marketing announcement

Legal:
[ ] Attorney review of disclosure
[ ] Complete official rules page
[ ] Document all participants
[ ] Finalize vesting schedule

Then:
1. Update .env for mainnet
2. Run preflight-check.sh
3. DRY_RUN test both scripts
4. Execute create-token
5. Execute launch pool
6. Publish all addresses
7. Create Alpha Vault
8. Monitor and prepare for launch

══════════════════════════════════════════════════════════════════════
 TIMELINE ESTIMATE
══════════════════════════════════════════════════════════════════════

Devnet Testing (once funded):
├─ Preflight check:    ~1 minute
├─ Token creation:     ~30 seconds
├─ Pool setup:         ~5-10 minutes
└─ Verification:       ~5 minutes
    
Total: ~15-20 minutes from funding to verified devnet deployment

Mainnet Preparation:
└─ Depends on multisig setup, legal review, and coordination

══════════════════════════════════════════════════════════════════════
 CURRENT STATUS
══════════════════════════════════════════════════════════════════════

✅ Phase 1: COMPLETE
⚠️  Phase 2: BLOCKED (waiting for devnet SOL)
🔄 Phase 3: READY (pending Phase 2)
🔄 Phase 4: READY (pending Phase 3)
⏳ Phase 5: PENDING

Next Immediate Action:
→ Fund operator wallet via https://faucet.solana.com
→ Address: ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK
→ Network: Devnet
→ Amount: 5-10 SOL

══════════════════════════════════════════════════════════════════════
```

## Key Files Reference

```
/workspace/
├── EXECUTION_SUMMARY.md          ← Comprehensive overview
├── LAUNCH_STATUS.md               ← Detailed status report
└── scripts/liquidity/
    ├── QUICKSTART.md              ← Step-by-step commands
    ├── preflight-check.sh         ← Pre-launch validator
    ├── .env                       ← Configuration (DO NOT COMMIT)
    ├── config.ts                  ← Token parameters
    ├── create-token.ts            ← Token creation script
    ├── launch-pool.ts             ← Pool setup script
    └── keys/                      ← Keypairs (DO NOT COMMIT)
        ├── operator.json
        ├── liquidity-multisig.json
        ├── secondary-reserve.json
        ├── game-treasury.json
        └── team-vesting.json
```

## Quick Command Reference

```bash
# Navigate to scripts
cd /workspace/scripts/liquidity

# Add Solana to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Check wallet balance
solana balance ErciqrHWEPz9HuvtcuoT9F2o2zc8bKv7v6s2kbHKcyVK --url devnet

# Run preflight check
bash preflight-check.sh

# View launch plan
npm run plan

# Execute scripts
DRY_RUN=1 npm run create-token  # Preview
npm run create-token             # Execute
DRY_RUN=1 npm run launch        # Preview
npm run launch                   # Execute
```
