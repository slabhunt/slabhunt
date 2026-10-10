// Prints SQL rows for species 12-150 from src/lib/roster.ts.
// Run: node --experimental-strip-types scripts/gen-species.mjs
const { SEASON_ROSTER, SEASON_THEMES } = await import("../src/lib/roster.ts");
const STATS = { c: [1, 12, 0.82, 0.12, 18], u: [2, 30, 0.65, 0.25, 8], r: [5, 80, 0.45, 0.45, 3], l: [10, 200, 0.25, 0.6, 1] };
let id = 12;
const rows = [];
for (const [season, list] of Object.entries(SEASON_ROSTER)) {
  for (const [name, rar] of list) {
    const [e, xp, cc, fc, w] = STATS[rar];
    rows.push(`  (${id++}, '${name}', '${rar}', ${e}, ${xp}, ${cc}, ${fc}, ${w}, ${season})`);
  }
}
console.log(`insert into public.species (id, name, rarity, entries, xp, catch_chance, flee_chance, spawn_weight, season_id) values\n${rows.join(",\n")}\non conflict (id) do nothing;`);
console.log(Object.entries(SEASON_THEMES).map(([s, t]) => `update public.seasons set name = 'Season ${s}: ${t}' where id = ${s};`).join("\n"));
