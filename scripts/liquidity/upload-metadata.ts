// Uploads the token logo and metadata JSON so the token's name and image don't depend on our website.
// Prints the METADATA_URI to put in .env before create-token.
//   npm run upload-metadata
// With PINATA_JWT set in .env: pins both to IPFS through Pinata (stays up while the Pinata account pins them;
// optional PINATA_GATEWAY, e.g. https://yourname.mypinata.cloud/ipfs/).
// Without it: Arweave through Irys, paid in SOL by the operator (a few cents, permanent on mainnet;
// on devnet it uses Irys's free devnet node, which is not permanent).
import fs from "node:fs";
import path from "node:path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createGenericFile, keypairIdentity } from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { TOKEN } from "./config.ts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const mainnet = (process.env.CLUSTER ?? "devnet") === "mainnet-beta";
const umi = createUmi(env("RPC_URL")).use(irysUploader(mainnet ? {} : { address: "https://devnet.irys.xyz" }));
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(env("OPERATOR_KEYPAIR"), "utf8")));
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

async function pinata(png: Buffer, base: Record<string, unknown>) {
  const jwt = process.env.PINATA_JWT!;
  const gateway = (process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/").replace(/\/?$/, "/");
  const auth = { Authorization: `Bearer ${jwt}` };
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), `${TOKEN.symbol.toLowerCase()}-logo.png`);
  form.append("pinataMetadata", JSON.stringify({ name: `${TOKEN.symbol} logo` }));
  const img = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: auth, body: form });
  if (!img.ok) throw new Error(`Pinata image upload failed: ${img.status} ${await img.text()}`);
  const imageUri = gateway + ((await img.json()) as { IpfsHash: string }).IpfsHash;
  console.log(`Logo: ${imageUri}`);
  const metadata = { ...base, name: TOKEN.name, symbol: TOKEN.symbol, image: imageUri, properties: { files: [{ uri: imageUri, type: "image/png" }], category: "image" } };
  const json = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `${TOKEN.symbol} metadata` } }),
  });
  if (!json.ok) throw new Error(`Pinata metadata upload failed: ${json.status} ${await json.text()}`);
  const uri = gateway + ((await json.json()) as { IpfsHash: string }).IpfsHash;
  console.log(`Metadata: ${uri}`);
  console.log(`\nPut this in .env:\nMETADATA_URI=${uri}`);
}

async function main() {
  const brand = path.resolve("../../public/brand");
  const png = fs.readFileSync(path.join(brand, "yoink-coin-512.png"));
  const base = JSON.parse(fs.readFileSync(path.join(brand, "yoink.json"), "utf8"));
  if (process.env.PINATA_JWT) return pinata(png, base);

  const [imageUri] = await umi.uploader.upload([createGenericFile(png, "logo.png", { contentType: "image/png" })]);
  console.log(`Logo: ${imageUri}`);
  const metadata = {
    ...base,
    name: TOKEN.name,
    symbol: TOKEN.symbol,
    image: imageUri,
    properties: { files: [{ uri: imageUri, type: "image/png" }], category: "image" },
  };
  const uri = await umi.uploader.uploadJson(metadata);
  console.log(`Metadata: ${uri}`);
  console.log(`\nPut this in .env:\nMETADATA_URI=${uri}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
