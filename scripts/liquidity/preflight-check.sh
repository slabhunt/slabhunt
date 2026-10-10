#!/bin/bash
# Pre-flight check for $YOINK token launch
# Run this before executing create-token and launch scripts

echo "========================================="
echo "$YOINK Token Launch - Pre-flight Check"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((ERRORS++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

# Check 1: Solana CLI
echo "Checking Solana CLI..."
if command -v solana &> /dev/null; then
    SOLANA_VERSION=$(solana --version | cut -d' ' -f2)
    check_pass "Solana CLI installed (version $SOLANA_VERSION)"
else
    check_fail "Solana CLI not found in PATH"
fi
echo ""

# Check 2: Node.js and dependencies
echo "Checking Node.js environment..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    check_pass "Node.js installed ($NODE_VERSION)"
else
    check_fail "Node.js not found"
fi

if [ -f "package.json" ] && [ -d "node_modules" ]; then
    check_pass "Dependencies installed (node_modules exists)"
else
    check_fail "Dependencies not installed. Run 'npm install'"
fi
echo ""

# Check 3: Configuration files
echo "Checking configuration..."
if [ -f ".env" ]; then
    check_pass ".env file exists"
    
    # Check required env vars
    source .env
    [ -n "$CLUSTER" ] && check_pass "CLUSTER is set: $CLUSTER" || check_fail "CLUSTER not set in .env"
    [ -n "$RPC_URL" ] && check_pass "RPC_URL is set" || check_fail "RPC_URL not set in .env"
    [ -n "$OPERATOR_KEYPAIR" ] && check_pass "OPERATOR_KEYPAIR path set" || check_fail "OPERATOR_KEYPAIR not set in .env"
    [ -n "$LIQUIDITY_MULTISIG" ] && check_pass "LIQUIDITY_MULTISIG address set" || check_fail "LIQUIDITY_MULTISIG not set in .env"
    [ -n "$SECONDARY_RESERVE_WALLET" ] && check_pass "SECONDARY_RESERVE_WALLET set" || check_fail "SECONDARY_RESERVE_WALLET not set in .env"
    [ -n "$GAME_TREASURY_WALLET" ] && check_pass "GAME_TREASURY_WALLET set" || check_fail "GAME_TREASURY_WALLET not set in .env"
    [ -n "$TEAM_VESTING_WALLET" ] && check_pass "TEAM_VESTING_WALLET set" || check_fail "TEAM_VESTING_WALLET not set in .env"
    [ -n "$LAUNCH_TIME" ] && check_pass "LAUNCH_TIME set: $LAUNCH_TIME" || check_fail "LAUNCH_TIME not set in .env"
    
    # TOKEN_MINT check (warning only, as it's set after create-token)
    if [ -z "$TOKEN_MINT" ]; then
        check_warn "TOKEN_MINT not set (will be set after create-token)"
    else
        check_pass "TOKEN_MINT set: $TOKEN_MINT"
    fi
else
    check_fail ".env file not found. Copy from .env.example"
fi
echo ""

# Check 4: Keypair files
echo "Checking keypairs..."
if [ -d "keys" ]; then
    check_pass "keys/ directory exists"
    
    if [ -f "$OPERATOR_KEYPAIR" ]; then
        check_pass "Operator keypair found: $OPERATOR_KEYPAIR"
    else
        check_fail "Operator keypair not found at: $OPERATOR_KEYPAIR"
    fi
else
    check_fail "keys/ directory not found"
fi
echo ""

# Check 5: Network connectivity and funding
if [ -n "$OPERATOR_KEYPAIR" ] && [ -f "$OPERATOR_KEYPAIR" ]; then
    echo "Checking network and wallet balance..."
    
    # Get operator address
    OPERATOR_PUBKEY=$(solana-keygen pubkey "$OPERATOR_KEYPAIR" 2>/dev/null || echo "")
    
    if [ -n "$OPERATOR_PUBKEY" ]; then
        check_pass "Operator address: $OPERATOR_PUBKEY"
        
        # Try to get balance
        if [ "$CLUSTER" = "devnet" ]; then
            BALANCE=$(solana balance "$OPERATOR_PUBKEY" --url devnet 2>/dev/null | cut -d' ' -f1 || echo "0")
        elif [ "$CLUSTER" = "mainnet-beta" ]; then
            BALANCE=$(solana balance "$OPERATOR_PUBKEY" --url mainnet-beta 2>/dev/null | cut -d' ' -f1 || echo "0")
        else
            BALANCE=$(solana balance "$OPERATOR_PUBKEY" 2>/dev/null | cut -d' ' -f1 || echo "0")
        fi
        
        if (( $(echo "$BALANCE >= 5" | awk '{print ($1 >= 5)}') )); then
            check_pass "Operator wallet balance: $BALANCE SOL (sufficient)"
        elif (( $(echo "$BALANCE > 0" | awk '{print ($1 > 0)}') )); then
            check_warn "Operator wallet balance: $BALANCE SOL (may be insufficient, recommend 5+ SOL)"
        else
            check_fail "Operator wallet balance: $BALANCE SOL (needs funding)"
            if [ "$CLUSTER" = "devnet" ]; then
                echo "    Fund at: https://faucet.solana.com"
                echo "    Or run: solana airdrop 5 $OPERATOR_PUBKEY --url devnet"
            fi
        fi
    else
        check_fail "Cannot read operator keypair"
    fi
    echo ""
fi

# Check 6: Launch time validation
if [ -n "$LAUNCH_TIME" ]; then
    echo "Checking launch time..."
    LAUNCH_TS=$(date -d "$LAUNCH_TIME" +%s 2>/dev/null || echo "0")
    CURRENT_TS=$(date +%s)
    
    if [ "$LAUNCH_TS" -gt "$CURRENT_TS" ]; then
        HOURS_UNTIL=$((($LAUNCH_TS - $CURRENT_TS) / 3600))
        check_pass "Launch time is in the future ($HOURS_UNTIL hours from now)"
    else
        check_fail "Launch time is in the past! Update LAUNCH_TIME in .env"
    fi
    echo ""
fi

# Check 7: Metadata accessibility
if [ -n "$METADATA_URI" ]; then
    echo "Checking metadata URI..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$METADATA_URI" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        check_pass "Metadata URI accessible: $METADATA_URI"
    else
        check_warn "Metadata URI returned HTTP $HTTP_CODE: $METADATA_URI"
    fi
    echo ""
fi

# Summary
echo "========================================="
echo "Pre-flight Check Summary"
echo "========================================="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}All checks passed!${NC} Ready to launch."
    echo ""
    echo "Next steps:"
    echo "  1. DRY_RUN=1 npm run create-token"
    echo "  2. npm run create-token"
    echo "  3. Update TOKEN_MINT in .env"
    echo "  4. DRY_RUN=1 npm run launch"
    echo "  5. npm run launch"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}$WARNINGS warning(s) found.${NC} Review warnings before proceeding."
    echo ""
    echo "You can proceed if warnings are acceptable."
    exit 0
else
    echo -e "${RED}$ERRORS error(s) and $WARNINGS warning(s) found.${NC}"
    echo ""
    echo "Fix errors before launching. Run this script again after fixes."
    exit 1
fi
