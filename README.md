# Vault Hunt MVP

A mobile web game. Players walk around their real city, catch original creatures on a live map, and every catch is a free entry into a draw for a real graded card. It includes world chat, rankings, profiles and admin draw tools.

- **App:** React + Vite, installable on phones as a web app (PWA). Map by Leaflet + OpenStreetMap.
- **Server:** Supabase (Postgres, auth, realtime). All rules that matter run in the database, so a modified app can't award itself entries.

## What's in the box

| Area | How it works |
|---|---|
| Sign-in | Email magic link. No wallet needed to play. |
| Map | Real GPS (`watchPosition`). Your position is reported to the server every ~15 s or 20 m. |
| Spawning | `spawn_nearby()` keeps ~6 creatures within 500 m of each active player, placed 60–400 m away, lasting 10–25 min. |
| Catching | Walk within 60 m, tap **Catch**, time your throw. `attempt_catch()` checks distance, GPS accuracy, speed (anti-teleport) and cooldown, then rolls the odds on the server. |
| Entries | Common 1, uncommon 2, rare 5 entries in the open round. |
| Draw | Admin taps **Run the draw** → `run_draw()` picks a weighted winner, closes the round, opens the next, and posts the winner in chat. |
| Chat | Realtime world chat. Uncommon/rare catches and winners post automatically. |
| Profile | Level/XP, creature log, display name, and a private Solana address for prize delivery. |

I tested the database against Postgres 16: spawning, distance and teleport checks, catches, entries, weighted draws, admin-only access, and that players can't edit their own XP, fake catches, spawn creatures or post fake win messages.

## Set it up

1. **Create a Supabase project** at supabase.com.
2. **Run the schema:** open SQL Editor and run `supabase/migrations/20261010154821_init.sql`.
3. **Auth:** Authentication → Providers → Email (on). Authentication → URL Configuration → add your site URL (and `http://localhost:5173` for local testing) to Redirect URLs.
4. **Keys:** copy `.env.example` to `.env.local` and fill in the project URL and anon key (Project Settings → API).
5. **Run it:**
   ```bash
   npm install
   npm run dev        # open the printed Network URL on your phone (same Wi-Fi)
   ```
   Phones only share GPS over HTTPS (or localhost). For phone testing, deploy (step 7) or use a tunnel like `ngrok http 5173`.
6. **Make yourself admin** (after signing in once):
   ```sql
   update profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
7. **Deploy:** push to GitHub and import into Vercel or Netlify (build `npm run build`, output `dist`). Add the two `VITE_` env vars there.

### Testing without walking

Set `VITE_ALLOW_SIMULATED_LOCATION=true`, then tap the map to move. Raise the speed limit while testing, and put it back before launch:

```sql
update game_config set max_speed_mps = 100000;   -- testing
update game_config set max_speed_mps = 40;       -- launch
```

All tunables (catch radius, GPS accuracy, spawn density, cooldowns) live in the `game_config` row.

## Before real prizes go out

- **Fair draw:** `run_draw()` uses Postgres `random()`. Swap in on-chain verifiable randomness (e.g. Switchboard or ORAO VRF) and publish each draw's proof.
- **Prize claim:** winners currently just have their saved address. Add a "Claim" step where the winner signs a message with their wallet (Phantom/Solflare) to prove they own it, then transfer the card NFT from the treasury.
- **Official rules page:** free entry, eligibility, prize descriptions, odds. Have a lawyer review it.
- **Safe spawn spots:** creatures spawn at random points, which can land on private property or water. Next step: spawn only at public places (parks, plazas) from OpenStreetMap data.
- **Map tiles:** the public OpenStreetMap tile servers aren't for production traffic. Switch the `TileLayer` URL to a provider like MapTiler, Stadia or Mapbox.
- **Chat moderation:** add reporting, muting and a word filter.
- **Housekeeping:** enable `pg_cron` and uncomment the cleanup job at the end of the migration.

## Token and treasury

The Slab ($SLAB) token launch scripts and runbook are in [`scripts/liquidity/`](scripts/liquidity/README.md): settings, devnet rehearsal results, costs and the mainnet checklist.

The token launches via a Meteora DLMM launch pool with a single-sided liquidity ladder (70% of supply). Treasury SOL from the launch buys graded card NFTs which become prizes in the game draws. The token never affects draw entries or odds.

## Project layout

```
supabase/migrations/20261010154821_init.sql   database, rules, functions
src/App.tsx                         game shell, GPS loop, catching
src/components/                     map, catch mini-game, chat, draw, ranks, profile, sign-in
src/lib/species.ts                  creature names and art (ids match the database)
src/hooks/                          session, GPS, name lookup
```
