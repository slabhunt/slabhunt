import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import fs from "fs";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("keys/operator.json", "utf8"))));

const mint = await createMint(connection, operator, operator.publicKey, null, 6);
console.log("Mint:", mint.toBase58());

const operatorAta = await getOrCreateAssociatedTokenAccount(connection, operator, mint, operator.publicKey);
await mintTo(connection, operator, mint, operatorAta.address, operator, 1000_000000);

const userPk = new PublicKey("9xPBFTQqzxEMF6XGhSxXUJVvH1UX2QayRrU1c1DrBkXB");
const userAta = await getOrCreateAssociatedTokenAccount(connection, operator, mint, userPk, true);
await mintTo(connection, operator, mint, userAta.address, operator, 200_000000);

console.log("Sent 200 tokens to 9xPBFTQqzxEMF6XGhSxXUJVvH1UX2QayRrU1c1DrBkXB");
