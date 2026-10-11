// Uploads the token logo and metadata JSON to Arweave (through Irys), so the token's name and image
// don't depend on our website. Prints the METADATA_URI to put in .env before create-token.
//   npm run upload-metadata
// Paid in SOL by the operator wallet (a few cents). On devnet it uses Irys's devnet node (free, not permanent).
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

async function main() {
  const brand = path.resolve("../../public/brand");
  const png = fs.readFileSync(path.join(brand, "yoink-coin-512.png"));
  const base = JSON.parse(fs.readFileSync(path.join(brand, "yoink.json"), "utf8"));

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
