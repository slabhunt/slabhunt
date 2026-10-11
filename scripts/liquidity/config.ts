// $SLAB (Slab) launch settings. Draft values chosen for long-term health; change them here and in the
// public disclosure together, and publish the final numbers before launch.

export const TOKEN = {
  name: "Slab Hunt",
  symbol: "SLAB",
  decimals: 6,
  totalSupply: 1_000_000_000,
};

/** Share of total supply in each bucket (must add to 1). */
export const ALLOCATION = {
  launchPool: 0.7,        // Meteora DLMM launch pool, single-sided, locked
  secondaryReserve: 0.1,  // paired with SOL on Raydium + Orca from week 2
  gameTreasury: 0.1,      // player rewards, prizes, partnerships
  team: 0.1,              // 12-month cliff, then 36 months linear
};

export const LAUNCH = {
  /** Starting fully diluted value in SOL. Low enough to leave room to grow, high enough not to be a giveaway. */
  startFdvSol: 300,
  /** Price step between bins in basis points (100 = 1%). */
  binStep: 100,
  /** Swap fee in basis points (100 = 1%). Meteora keeps 20% of fees on launch pools; 80% goes to the position owner. */
  feeBps: 100,
  /** How the bins are curved inside each range (Meteora's ILM curvature, 0-1). */
  curvature: 0.8,
  /** Days the launch positions are locked. */
  lockDays: 180,
  /**
   * The ladder: each range is a multiple of the starting price, and the share of launch-pool tokens in it.
   * Tokens only sell as buyers push the price up through a range.
   */
  ladder: [
    { from: 1, to: 2, share: 0.25 },
    { from: 2, to: 5, share: 0.3 },
    { from: 5, to: 10, share: 0.25 },
    { from: 10, to: 25, share: 0.2 },
  ],
  /**
   * Fair start: a pro-rata Alpha Vault. Anyone deposits SOL before trading opens; the vault buys up to
   * maxSol from the pool before anyone else, starting at the opening price, and refunds the rest pro rata, so speed and bots don't matter.
   * Vault buyers' tokens unlock gradually so the vault can't dump on the open.
   */
  alphaVault: { maxSol: 50, vestingStartsAfterMinutes: 60, vestingHours: 24 },
};

/** Where SOL raised by the launch pool (and its 80% fee share) is swept, weekly. */
export const PROCEEDS = {
  development: 0.35,
  secondaryLiquidity: 0.25,
  cardPrizes: 0.2,
  buyback: 0.15,
  opsReserve: 0.05,
};

/** Rules the pool checks follow. Nothing moves without multisig approval. */
export const RULES = {
  secondaryPoolsOpenAfterDays: 7,
  secondaryPoolMinSolPerSide: 25,
  secondaryRangePct: 25,        // keep Raydium/Orca concentrated positions within ±25% of market price
  pauseAddsIfHourlyMovePct: 20, // no new liquidity while price moves more than this in an hour
  sweepFeesEveryDays: 7,
};

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function startPriceSol() {
  return LAUNCH.startFdvSol / TOKEN.totalSupply;
}
