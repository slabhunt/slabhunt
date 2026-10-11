// Fix the Slab Hunt multisig's settings without the Squads Pro plan: proposes ONE config change on-chain that
//   1. makes the proposer key "Initiate only" (it can create proposals but never vote or execute), and
//   2. sets the approval threshold (default 2).
// It's a normal Squads proposal: signers approve it (in the Squads app or here), then it's executed.
//
//   npm run squads-fix                     show members, permissions and threshold, and what would change
//   npm run squads-fix -- propose          create the proposal (and approve it with the proposer key, which can still vote today)
//   npm run squads-fix -- execute <index>  execute it once enough signers approved (the proposer key can still execute today)
//
// Env (.env): RPC_URL, SQUADS_MULTISIG (the multisig account address from Squads > Settings, NOT the vault),
// PROPOSER_KEYPAIR (path to keys/proposer.json), optional THRESHOLD (default 2).
import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Set ${k} in .env`); return v; };
const connection = new Connection(env("RPC_URL"), "confirmed");
const rawKey = env("PROPOSER_KEYPAIR");
const keyText = rawKey.trim().startsWith("[") ? rawKey : fs.existsSync(rawKey) ? fs.readFileSync(rawKey, "utf8") : rawKey;
const proposer = Keypair.fromSecretKey(keyText.trim().startsWith("[") ? Uint8Array.from(JSON.parse(keyText)) : bs58.decode(keyText.trim()));
const multisigPda = new PublicKey(env("SQUADS_MULTISIG"));
const THRESHOLD = Number(process.env.THRESHOLD ?? 2);
const { Permission, Permissions } = multisig.types;
const INITIATE = 1, VOTE = 2, EXECUTE = 4;
const describe = (mask: number) => [mask & INITIATE && "Initiate", mask & VOTE && "Vote", mask & EXECUTE && "Execute"].filter(Boolean).join(", ") || "none";

async function load() {
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  return { ms, members: ms.members.map((m) => ({ key: m.key.toBase58(), mask: m.permissions.mask })) };
}

async function plan() {
  const { ms, members } = await load();
  console.log(`Multisig ${multisigPda.toBase58()}`);
  console.log(`  vault #0 (send funds here): ${multisig.getVaultPda({ multisigPda, index: 0 })[0].toBase58()}`);
  console.log(`  threshold ${ms.threshold}, next transaction #${Number(ms.transactionIndex) + 1}`);
  for (const m of members) console.log(`  ${m.key}${m.key === proposer.publicKey.toBase58() ? "  <- proposer" : ""}: ${describe(m.mask)}`);
  const me = members.find((m) => m.key === proposer.publicKey.toBase58());
  if (!me) throw new Error(`The proposer key ${proposer.publicKey.toBase58()} isn't a member of this multisig. Check SQUADS_MULTISIG and PROPOSER_KEYPAIR.`);
  const actions: multisig.types.ConfigAction[] = [];
  if (me.mask !== INITIATE) {
    actions.push({ __kind: "RemoveMember", oldMember: proposer.publicKey });
    actions.push({ __kind: "AddMember", newMember: { key: proposer.publicKey, permissions: Permissions.fromPermissions([Permission.Initiate]) } });
  }
  if (ms.threshold !== THRESHOLD) actions.push({ __kind: "ChangeThreshold", newThreshold: THRESHOLD });
  const voters = members.filter((m) => m.key !== proposer.publicKey.toBase58() && m.mask & VOTE).length;
  const executors = members.filter((m) => m.key !== proposer.publicKey.toBase58() && m.mask & EXECUTE).length;
  if (THRESHOLD < 1 || THRESHOLD > voters) throw new Error(`Threshold ${THRESHOLD} doesn't fit: ${voters} members would be able to vote.`);
  if (executors < 1) throw new Error("No member except the proposer can execute; give a signer Execute first.");
  console.log(actions.length
    ? `\nWill propose: proposer -> Initiate only; threshold ${ms.threshold} -> ${THRESHOLD} (${voters} voting signers).`
    : "\nNothing to change: the proposer is Initiate-only and the threshold is already set.");
  return { ms, actions };
}

async function propose() {
  const { ms, actions } = await plan();
  if (!actions.length) return;
  const transactionIndex = BigInt(Number(ms.transactionIndex) + 1);
  const a = await multisig.rpc.configTransactionCreate({
    connection, feePayer: proposer, multisigPda, transactionIndex, creator: proposer.publicKey, actions,
    memo: "Proposer: Initiate only; set threshold",
  });
  const b = await multisig.rpc.proposalCreate({ connection, feePayer: proposer, multisigPda, transactionIndex, creator: proposer });
  const c = await multisig.rpc.proposalApprove({ connection, feePayer: proposer, multisigPda, transactionIndex, member: proposer });
  console.log(`\nProposed #${transactionIndex} and approved it with the proposer key.\n  create ${a}\n  proposal ${b}\n  approve ${c}`);
  console.log(`Now approve #${transactionIndex} in the Squads app with signer wallets until it shows Ready, then run:\n  npm run squads-fix -- execute ${transactionIndex}`);
}

async function execute(index: string) {
  if (!/^\d+$/.test(index ?? "")) throw new Error("Usage: npm run squads-fix -- execute <transaction number>");
  const sig = await multisig.rpc.configTransactionExecute({
    connection, feePayer: proposer, multisigPda, transactionIndex: BigInt(index), member: proposer, rentPayer: proposer,
  });
  console.log(`Executed #${index}: ${sig}\n`);
  await plan();
}

const [cmd, arg] = process.argv.slice(2);
(cmd === "propose" ? propose() : cmd === "execute" ? execute(arg) : plan().then(() => console.log("\nRun with `-- propose` to create the proposal.")))
  .catch((e) => { console.error(e?.message ?? e); process.exit(1); });
