# Getting Slab Hunt into app stores

Slab Hunt is a web app (PWA). Both stores take it as an Android app that wraps the website, so the game itself doesn't
change and updates ship the moment the website updates. Researched Oct 11, 2026; re-check the policies before submitting.

## 1. Solana dApp Store (do this first)

**Fit:** very good. The dApp Store's publisher policy drops Google's gambling, payments and financial-services rules
(only illegal content, child endangerment and parts of inappropriate content remain), and its users already have Solana
wallets.

**How:**
1. Wrap the site with Solana Mobile's `webshell` CLI (`webshell init`, then `webshell build`). It makes a signed release
   APK around a WebView that hands wallet requests straight to the phone's wallet. Solana Mobile advises against
   Bubblewrap/TWA wrappers here because browser rules can break wallet connections.
2. If the game uses Mobile Wallet Adapter, update `@solana-mobile/wallet-standard-mobile` to 0.5.1+ so it detects the
   shell. (Today the game connects through Phantom/Solflare's in-app browsers; adding Mobile Wallet Adapter is a small
   follow-up that makes wallet connect work in the shell and in mobile Chrome.)
3. Publish with the dApp Store publishing CLI: a publisher NFT, an app NFT and a release NFT, minted with a publisher
   wallet (a small amount of SOL). Listing details: name, short and long description, icon (`public/brand/icon-512.png`),
   banner, at least 4 screenshots, privacy policy URL (https://slabhunt.fun/legal), website, X.
4. Solana Mobile reviews and curates the catalog; questions go to publishersupport@dappstore.solanamobile.com.

**Keys:** the APK signing key and the publisher wallet are long-lived secrets. Make them yourself, store them like the
multisig keys (offline backup), never in this repo.

## 2. Google Play (harder; needs a "Play" version of the game)

**Wrapper:** Bubblewrap (Trusted Web Activity) works for Play, plus `/.well-known/assetlinks.json` on slabhunt.fun with the
app's signing-key fingerprint.

**Policy problems with today's game, and the fix for each:**

| Feature | Play rule | Fix in the Play version |
|---|---|---|
| Season Pass NFT minted with $SLAB, tier random and hidden | Apps without gambling approval can't take payment for a chance to win blockchain items of unclear value (randomized NFTs count) | Hide the in-app mint (or sell only a known, fixed tier) |
| Power-ups, Vault Draw tickets bought with $SLAB | Digital goods bought in the app generally have to go through Play Billing | Hide token purchases; coins (earned only) stay |
| Free raffles for real graded cards | Real-money games and contests now need Play's age-restricted-content tools (enforced from Jan 28, 2026) | Turn on Play Console age screening; keep the free-entry rules and terms |
| $SLAB and NFTs anywhere in the app | Declare tokenized assets in the Financial Features form; no promoting earnings | Fill in the declaration; keep the copy free of price talk (already true) |

The Play version would be the same website with a flag (for example when opened from the Play app) that hides token
purchases and the pass mint. Players can still link a wallet to see what they own.

**Also needed for Play:** a developer account, privacy policy URL and account-deletion URL (both
https://slabhunt.fun/legal), the Data safety form (email, approximate location, game activity, wallet address),
content rating, screenshots and a feature graphic (1024×500).

## Suggested order

1. Add Mobile Wallet Adapter (wallet connect inside the app wrapper).
2. Ship to the Solana dApp Store.
3. Build the Play version flag, then submit to Google Play after a legal look at the raffles and $SLAB features.

Sources: Solana Mobile docs ("Publishing a web app", publisher policy), Google Play policy updates on blockchain content
(July 2023) and age-restricted content (Oct 2025).
