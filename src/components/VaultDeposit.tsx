import { useEffect, useState } from "react";
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

const VAULT_ADDRESS = "4XHvRr8Zo3GhBYsR3SHat8PUL9W2WRFfu9Y2Yt4xc9i9";
const POOL_ADDRESS = "HpWdga7dnyaMKszeoow98reTqcyDyuipzdfyJSBMmaGR";
const RPC_URL = "https://api.mainnet-beta.solana.com";

interface VaultInfo {
  depositsClose: Date;
  buyingUntil: Date;
  unlockStart: Date;
  unlockEnd: Date;
}

export default function VaultDeposit() {
  const [wallet, setWallet] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [info] = useState<VaultInfo>({
    depositsClose: new Date("2026-10-11T22:55:00-04:00"), // 10:55 PM Haiti time
    buyingUntil: new Date("2026-10-11T23:59:59-04:00"),
    unlockStart: new Date("2026-10-12T01:00:00-04:00"),
    unlockEnd: new Date("2026-10-13T01:00:00-04:00"),
  });

  useEffect(() => {
    // Check if Phantom wallet is installed
    if (window.solana?.isPhantom) {
      setWallet(window.solana);
      window.solana.on("connect", () => setConnected(true));
      window.solana.on("disconnect", () => setConnected(false));
      if (window.solana.isConnected) setConnected(true);
    }
  }, []);

  async function connectWallet() {
    if (!wallet) {
      window.open("https://phantom.app/", "_blank");
      return;
    }
    try {
      await wallet.connect();
    } catch (e) {
      console.error("Failed to connect:", e);
    }
  }

  const now = new Date();
  const depositsOpen = now < info.depositsClose;
  const timeUntilClose = Math.max(0, Math.floor((info.depositsClose.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(timeUntilClose / 3600);
  const minutes = Math.floor((timeUntilClose % 3600) / 60);

  return (
    <div className="vault-deposit">
      <h2>🏦 Fair-Start Vault</h2>
      <p className="vault-desc">
        The vault buys $SLAB tokens right before trading opens at midnight, then distributes them to depositors pro-rata over 24 hours.
      </p>
      
      <div className="vault-stats">
        <div className="stat-row">
          <span className="stat-label">Max capacity:</span>
          <span className="stat-value">50 SOL</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Deposits close:</span>
          <span className="stat-value">
            {depositsOpen ? `${hours}h ${minutes}m` : "Closed"}
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Vault buys:</span>
          <span className="stat-value">{info.buyingUntil.toLocaleTimeString()}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Tokens unlock:</span>
          <span className="stat-value">{info.unlockStart.toLocaleTimeString()} - {info.unlockEnd.toLocaleTimeString()}</span>
        </div>
      </div>

      {!wallet ? (
        <div className="connect-section">
          <p className="info-text">Install Phantom wallet to deposit</p>
          <button className="btn" onClick={connectWallet}>
            Get Phantom
          </button>
        </div>
      ) : !connected ? (
        <div className="connect-section">
          <p className="info-text">Connect your wallet to deposit</p>
          <button className="btn" onClick={connectWallet}>
            Connect Wallet
          </button>
        </div>
      ) : depositsOpen ? (
        <div className="deposit-section">
          <p className="info-text highlight">
            ⚠️ Meteora's UI is temporarily unavailable. Deposits will open when their site is back online.
          </p>
          <p className="info-text">
            Pool address: <code className="addr">{POOL_ADDRESS}</code>
          </p>
          <p className="info-text">
            Vault address: <code className="addr">{VAULT_ADDRESS}</code>
          </p>
          <a 
            className="btn" 
            href={`https://app.meteora.ag/alpha-vault/${VAULT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Try Meteora →
          </a>
        </div>
      ) : (
        <p className="info-text">Deposits are closed. The vault is buying tokens now.</p>
      )}

      <div className="vault-info">
        <h3>How it works</h3>
        <ol>
          <li>Deposit SOL to the vault before 10:55 PM (about {hours}h {minutes}m remaining)</li>
          <li>The vault automatically buys $SLAB from the pool right before midnight</li>
          <li>Your $SLAB tokens unlock linearly over 24 hours starting at 1:00 AM</li>
          <li>Withdraw unlocked tokens anytime after they vest</li>
          <li>Pro-rata distribution: everyone gets tokens proportional to their deposit</li>
        </ol>
        
        <div className="vault-links">
          <p><strong>Token:</strong> $SLAB (Slab Hunt)</p>
          <p><strong>Mint:</strong> <code className="addr">B8FCj8MPSzLG21yxoBff3jdZmQSZDMt8WCVZTkFUMnEQ</code></p>
          <p><strong>Trading opens:</strong> 12:00 AM midnight (4:00 AM UTC)</p>
        </div>
      </div>
    </div>
  );
}

// TypeScript declarations
declare global {
  interface Window {
    solana?: any;
  }
}
