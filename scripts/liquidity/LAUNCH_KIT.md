# $SLAB launch kit

Everything listing sites and wallets ask for, in one place. The on-chain metadata comes from
`public/brand/slab.json` via `npm run upload-metadata` (it carries the description, website and X link below).

## Identity

| Field | Value |
|---|---|
| Name | Slab |
| Ticker | SLAB |
| Decimals | 6 |
| Total supply | 1,000,000,000 (mint and freeze authority revoked at creation) |
| Website | https://slabhunt.fun |
| X | https://x.com/slabhuntfun (@slabhuntfun) |
| GitHub | add when the public repo exists (also add it to `src/lib/links.ts` and `slab.json`) |
| Hashtag | #SLABHUNT |

Before launch: search Jupiter, Birdeye, DexScreener and the web for other tokens called SLAB, and decide whether the name
still works.

## Descriptions

**Short (one line):** The in-game token of Slab Hunt: hunt creatures on a real map, win real graded cards.

**Standard (on-chain metadata, ~250 chars):** $SLAB is the in-game token of Slab Hunt, a free location game: catch
creatures on a real map for free raffle entries and win real graded cards. Use $SLAB for power-ups, Season Pass mints
and Vault Draw tickets. You never need it to play or win.

**Long (listing pages):** Slab Hunt is a free location game. Creatures appear around your city; catch them to earn free
raffle entries for real graded cards, drawn with public randomness anyone can verify. $SLAB is the game's token: use it
for power-ups, Season Pass mints and Vault Draw tickets, with each payment split on-chain between burn, the card vault,
map drops and development. Playing and winning are always free. $SLAB is not an investment and carries no promise of
value.

Keep listings free of price or earnings promises; the terms say $SLAB is not an investment.

## Images (all in `public/brand/`)

| Use | File | Size |
|---|---|---|
| Token logo (metadata, Jupiter, wallets) | `token-logo-512.png` (round, transparent corners) | 512×512 |
| Token logo, large (CoinGecko, CMC) | `token-logo-1024.png` | 1024×1024 |
| Banner / header (DexScreener header, X header) | `token-banner-1500x500.png` | 1500×500 (3:1) |
| Square avatar (X profile, Telegram) | `slab-hunt-avatar.png` | 1000×1000 |
| Link preview (Open Graph) | `og.png` | 1200×630 |

## Where to submit after the pool is live

1. **DexScreener:** "Enhanced token info" on the token page: logo, 3:1 header, description, website, X. Paid; check
   the current price on their site.
2. **Jupiter:** the token shows up once it trades. Apply for verification through Jupiter's current token
   verification process.
3. **Birdeye / Solscan:** update token info through their token pages (website, X, logo).
4. **CoinGecko / CoinMarketCap:** apply once there's steady volume; they ask for the long description, logo, links and
   the disclosure doc.

## Checklist

- [ ] Ticker search done (see above)
- [ ] Disclosure doc updated to Slab / $SLAB and matches `config.ts`
- [ ] `npm run upload-metadata` on mainnet, `METADATA_URI` saved in `.env`
- [ ] Metadata authority is the treasury multisig
- [ ] GitHub link added once the public repo exists
