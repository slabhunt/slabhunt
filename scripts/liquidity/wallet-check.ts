// Safety check for multisig addresses. Squads shows two addresses: the multisig account itself and its vault(s).
// Only a VAULT can receive tokens and own positions; anything sent to the multisig account address is lost.
// The multisig account is owned by the Squads program; a vault is a plain system account (or doesn't exist yet).
import { Connection, PublicKey } from "@solana/web3.js";

const SQUADS_V4 = "SQDS4ep65T869zMMBKyuUq6SqQUqpjbpZXHBNjcobvn";
const SQUADS_V3 = "SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu";

export async function assertVaultAddress(connection: Connection, address: PublicKey, label: string) {
  const info = await connection.getAccountInfo(address);
  const owner = info?.owner.toBase58();
  if (owner === SQUADS_V4 || owner === SQUADS_V3) {
    throw new Error(`${label} (${address.toBase58()}) is a Squads MULTISIG account, not a vault. ` +
      `In Squads, copy the vault address (shown under the multisig's name / in Accounts) and use that instead.`);
  }
  if (info && info.data.length > 0 && owner !== "11111111111111111111111111111111") {
    throw new Error(`${label} (${address.toBase58()}) is a program-owned account (${owner}), not a wallet or Squads vault. Check the address.`);
  }
}
