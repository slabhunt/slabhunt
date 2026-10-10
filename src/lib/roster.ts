// Creatures that debut in Seasons 2-15 (ids 12-150). Original designs.
// Each row: [name, rarity, body color, feature, shape?]. The database `species` table is generated
// from this list (scripts/gen-species.mjs), so ids are the row order and must never be reordered.
// Rarity: c = Common, u = Uncommon, r = Rare, l = Legendary (1-of-1 NFT).

export type RosterRow = [name: string, rar: "c" | "u" | "r" | "l", body: string, feat: string, shape?: string];

export const SEASON_ROSTER: Record<number, RosterRow[]> = {
  // Season 2: Night Market
  2: [
    ["Dumplup", "c", "#E9D8B4", "steam", "wide"],
    ["Noodlet", "c", "#F0B85A", "whiskers"],
    ["Grillkit", "c", "#C8553D", "ears"],
    ["Tokenmouse", "c", "#B9A7D6", "ears", "tall"],
    ["Ricepuff", "c", "#F4F1EA", "cloud", "blob"],
    ["Neonpaw", "u", "#FF4FA3", "ears"],
    ["Sparkfry", "u", "#F2C14E", "antenna", "drop"],
    ["Duskmoth", "u", "#6A4C93", "wings"],
    ["Neonfang", "r", "#2DE1C2", "tusks"],
    ["Lampwyrm", "r", "#8C3B8F", "lantern", "tall"],
  ],
  // Season 3: Tidal Rush
  3: [
    ["Kelpip", "c", "#4F9D69", "leaf", "drop"],
    ["Clamlet", "c", "#E8A0A8", "shell", "wide"],
    ["Splashkin", "c", "#4DB6E8", "bubbles"],
    ["Brinebun", "c", "#A8C5D6", "ears"],
    ["Coralet", "c", "#FF7F6E", "antenna", "blob"],
    ["Tidecat", "u", "#2F86A6", "fin"],
    ["Pearlisk", "u", "#E6E1F5", "star", "tall"],
    ["Gullwhip", "u", "#D7DEE6", "wings", "wide"],
    ["Riptidal", "r", "#1C5D99", "sail"],
    ["Leviathorn", "l", "#123E5C", "drake", "wide"],
  ],
  // Season 4: Ember Peaks
  4: [
    ["Cindermole", "c", "#6B4E3D", "steam", "wide"],
    ["Ashkit", "c", "#9A9A9A", "ears"],
    ["Pumicub", "c", "#B98B6E", "pebble", "blob"],
    ["Smolderbug", "c", "#D9613B", "antenna"],
    ["Charpip", "c", "#3E3E46", "flame", "drop"],
    ["Lavalurk", "u", "#E4572E", "spikes", "wide"],
    ["Scorchling", "u", "#F29E4C", "flame"],
    ["Flintback", "u", "#5C5C70", "shell"],
    ["Calderox", "r", "#A23B2A", "tusks", "wide"],
    ["Pyrelynx", "r", "#F26B38", "mane"],
  ],
  // Season 5: Frostfall
  5: [
    ["Snowbun", "c", "#F3F8FC", "ears", "tall"],
    ["Iciclit", "c", "#BFE3F2", "horn", "drop"],
    ["Flurrfin", "c", "#9CC9E8", "fin"],
    ["Rimepup", "c", "#D6E4EE", "whiskers"],
    ["Sleetle", "c", "#7FA7C9", "shell", "wide"],
    ["Glaciowl", "u", "#C9E6F7", "wings"],
    ["Hailhorn", "u", "#8DB4D9", "horn", "tall"],
    ["Frostwhisk", "u", "#E3F3FB", "mane"],
    ["Borealyx", "r", "#5FD4B0", "rings"],
    ["Blizzarch", "r", "#A9C6F0", "crystal", "tall"],
  ],
  // Season 6: Neon Grid
  6: [
    ["Pixlet", "c", "#47E5BC", "antenna"],
    ["Bytebug", "c", "#7D5BA6", "antenna", "wide"],
    ["Glitchick", "c", "#FF6B9A", "mask", "drop"],
    ["Ampling", "c", "#F7D046", "coil"],
    ["Datadot", "c", "#4C7BE0", "star", "blob"],
    ["Circuitail", "u", "#2BB3A3", "tail"],
    ["Voltrix", "u", "#FFD23F", "coil", "tall"],
    ["Laserlark", "u", "#EE4266", "wings"],
    ["Synthwolf", "r", "#5B2A86", "ears", "tall"],
    ["Omnicore", "l", "#0F0F2D", "rings"],
  ],
  // Season 7: Bloom Vale
  7: [
    ["Budling", "c", "#7BC67E", "leaf"],
    ["Petalpuff", "c", "#F7A8C4", "petals", "blob"],
    ["Sproutle", "c", "#9BD770", "leaf", "drop"],
    ["Pollenip", "c", "#F6D55C", "antenna"],
    ["Fernkit", "c", "#4C9F70", "ears"],
    ["Thistleback", "u", "#9A7FC1", "spikes"],
    ["Blossomoth", "u", "#F4B6D2", "wings"],
    ["Vinelash", "u", "#3E8E41", "tail", "tall"],
    ["Gardenhart", "r", "#6BAA75", "crown"],
    ["Orchidra", "r", "#C86FC9", "petals", "tall"],
  ],
  // Season 8: Storm Coast
  8: [
    ["Raindot", "c", "#6FA8DC", "bubbles", "drop"],
    ["Gustling", "c", "#CFE0EA", "cloud"],
    ["Puddlepup", "c", "#5C8DB8", "ears", "wide"],
    ["Zappit", "c", "#F2D14C", "coil"],
    ["Fogsnail", "c", "#A3ABB5", "shell", "wide"],
    ["Thundertoad", "u", "#4E6E58", "coil", "wide"],
    ["Squallow", "u", "#3D5A80", "wings"],
    ["Stormfin", "u", "#2E4A62", "fin", "drop"],
    ["Tempestag", "r", "#3B4B78", "horn", "tall"],
    ["Voltgale", "r", "#E8C547", "batwings"],
  ],
  // Season 9: Dune Sea
  9: [
    ["Sandmite", "c", "#D9B98C", "antenna", "wide"],
    ["Dunehop", "c", "#E8C899", "ears", "tall"],
    ["Cactling", "c", "#6E9E5B", "spikes", "tall"],
    ["Scorpip", "c", "#C2864F", "tail"],
    ["Mirageling", "c", "#F1D9A8", "steam", "blob"],
    ["Sunscarab", "u", "#2F7F6D", "shell"],
    ["Whirldust", "u", "#C9A66B", "cloud", "drop"],
    ["Saguarox", "u", "#5E8C4A", "tusks", "wide"],
    ["Pharaowl", "r", "#D4A537", "mask"],
    ["Solarch", "l", "#F2B134", "crown"],
  ],
  // Season 10: Crystal Caves
  10: [
    ["Quartzlet", "c", "#E7DFF2", "crystal"],
    ["Lumigrub", "c", "#A2D96B", "antenna", "wide"],
    ["Gemmouse", "c", "#B58AD9", "ears"],
    ["Echobat", "c", "#5C4E7A", "batwings"],
    ["Stalagkit", "c", "#8E8A99", "horn"],
    ["Amethysk", "u", "#9B5DE5", "crystal", "tall"],
    ["Prismole", "u", "#7AD3D9", "star", "wide"],
    ["Opalope", "u", "#EADCF7", "horn", "tall"],
    ["Crystalisk", "r", "#4DC9E6", "spikes"],
    ["Shardwyrm", "r", "#6A3FA0", "crystal", "wide"],
  ],
  // Season 11: Sky Garden
  11: [
    ["Cloudlet", "c", "#F5F8FB", "cloud", "blob"],
    ["Featherpip", "c", "#F7C59F", "wings"],
    ["Breezel", "c", "#B5E2D8", "tail"],
    ["Kitekin", "c", "#EF6F6C", "sail", "drop"],
    ["Puffowl", "c", "#D9CBB8", "mask"],
    ["Zephyrkit", "u", "#9FD8CB", "ears"],
    ["Skyskipper", "u", "#7EB6E8", "wings", "wide"],
    ["Nimbusk", "u", "#C7D3E0", "cloud", "tall"],
    ["Stratosaur", "r", "#5D8AA8", "sail", "wide"],
    ["Cirrion", "r", "#E4ECF7", "moon"],
  ],
  // Season 12: Iron Works
  12: [
    ["Boltnut", "c", "#9AA3AD", "gear"],
    ["Cogpup", "c", "#B87333", "gear", "wide"],
    ["Rivetail", "c", "#7C8791", "tail"],
    ["Gearling", "c", "#C9A227", "gear", "blob"],
    ["Scrapling", "c", "#8B6F47", "antenna"],
    ["Steamhorn", "u", "#6D7B8D", "steam", "tall"],
    ["Pistonix", "u", "#A84A3B", "coil"],
    ["Anvilon", "u", "#4A4E57", "tusks", "wide"],
    ["Forgehound", "r", "#D0592E", "ears", "wide"],
    ["Titanvault", "l", "#3A4750", "crown", "wide"],
  ],
  // Season 13: Shadow Grove
  13: [
    ["Bleaklet", "c", "#4A4E69", "ears"],
    ["Hushling", "c", "#6C5B7B", "mask"],
    ["Shadeling", "c", "#35325A", "cloud", "blob"],
    ["Nightnib", "c", "#2E294E", "horn", "drop"],
    ["Mistmouse", "c", "#9A8C98", "whiskers"],
    ["Hexmoth", "u", "#7B2D8B", "wings"],
    ["Duskowl", "u", "#5E4B56", "moon"],
    ["Briarshade", "u", "#3D5941", "spikes", "tall"],
    ["Wraithorn", "r", "#2B2D42", "horn", "tall"],
    ["Umbralynx", "r", "#1F1B2E", "mane"],
  ],
  // Season 14: Star Reef
  14: [
    ["Starfry", "c", "#F4C95D", "star"],
    ["Cometpup", "c", "#7FB7E6", "tail"],
    ["Astrobit", "c", "#B8B5FF", "antenna", "drop"],
    ["Nebulite", "c", "#C77DFF", "cloud", "blob"],
    ["Twinkfish", "c", "#5EC2D6", "fin", "wide"],
    ["Orbitail", "u", "#6A7FDB", "rings"],
    ["Meteorb", "u", "#D95D39", "flame"],
    ["Galaxeel", "u", "#3C1A5B", "star", "tall"],
    ["Novaray", "r", "#FF9F1C", "rings", "wide"],
    ["Quasarix", "r", "#7400B8", "crown"],
  ],
  // Season 15: Vault Prime
  15: [
    ["Coinlet", "c", "#E8B33A", "star"],
    ["Keypip", "c", "#C0A062", "antenna", "tall"],
    ["Lockbug", "c", "#6B7A8F", "shell"],
    ["Ledgerling", "c", "#7E9C7A", "mask", "wide"],
    ["Gildfox", "u", "#D9A441", "ears"],
    ["Lockjaw", "u", "#5A6270", "tusks", "wide"],
    ["Tumblerat", "u", "#A3916B", "whiskers"],
    ["Treasurex", "r", "#B8860B", "crown", "wide"],
    ["Aurumax", "l", "#F5C542", "drake"],
  ],
};

export const SEASON_THEMES: Record<number, string> = {
  2: "Night Market", 3: "Tidal Rush", 4: "Ember Peaks", 5: "Frostfall", 6: "Neon Grid", 7: "Bloom Vale",
  8: "Storm Coast", 9: "Dune Sea", 10: "Crystal Caves", 11: "Sky Garden", 12: "Iron Works",
  13: "Shadow Grove", 14: "Star Reef", 15: "Vault Prime",
};
