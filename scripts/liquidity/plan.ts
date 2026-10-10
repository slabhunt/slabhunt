// Prints the launch ladder and what it raises if every bin fills. No network, no keys.
// Run: node --experimental-strip-types scripts/liquidity/plan.ts
import { ALLOCATION, LAUNCH, PROCEEDS, TOKEN, startPriceSol } from "./config.ts";

const p0 = startPriceSol();
const step = 1 + LAUNCH.binStep / 10_000;
const poolTokens = TOKEN.totalSupply * ALLOCATION.launchPool;
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

let totalSol = 0, totalBins = 0;
const rows = LAUNCH.ladder.map((r) => {
  // Bins in the range, tokens spread evenly per bin (curvature shifts this a little).
  const bins = Math.ceil(Math.log(r.to / r.from) / Math.log(step));
  const tokens = poolTokens * r.share;
  let sol = 0;
  for (let i = 0; i < bins; i++) sol += (tokens / bins) * p0 * r.from * step ** (i + 0.5);
  totalSol += sol; totalBins += bins;
  return { range: `${r.from}x-${r.to}x`, fdv: `${fmt(LAUNCH.startFdvSol * r.from)}-${fmt(LAUNCH.startFdvSol * r.to)} SOL`, bins, tokens, sol };
});

console.log(`$${TOKEN.symbol}: ${fmt(TOKEN.totalSupply)} supply, ${fmt(poolTokens)} in the launch pool`);
console.log(`Start price ${p0.toExponential(3)} SOL (FDV ${fmt(LAUNCH.startFdvSol)} SOL), bin step ${LAUNCH.binStep / 100}%, fee ${LAUNCH.feeBps / 100}%, lock ${LAUNCH.lockDays} days\n`);
console.log("Range      FDV range              Bins   Tokens           SOL if filled");
for (const r of rows) console.log(`${r.range.padEnd(10)} ${r.fdv.padEnd(22)} ${String(r.bins).padStart(4)}   ${fmt(r.tokens).padStart(14)}   ${fmt(r.sol, 1).padStart(10)}`);
console.log(`${"Total".padEnd(33)} ${String(totalBins).padStart(4)}   ${fmt(poolTokens).padStart(14)}   ${fmt(totalSol, 1).padStart(10)}\n`);

console.log("Cumulative SOL raised as the price climbs:");
let cum = 0;
for (const r of rows) { cum += r.sol; console.log(`  up to ${r.range.split("-")[1].padEnd(4)} ${fmt(cum, 1).padStart(10)} SOL`); }
console.log("\nSweep of SOL raised (if every bin fills):");
for (const [k, v] of Object.entries(PROCEEDS)) console.log(`  ${k.padEnd(20)} ${String(v * 100).padStart(3)}%  ${fmt(totalSol * v, 1).padStart(10)} SOL`);
