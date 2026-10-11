// How to play: the full breakdown, one section per feature, each with a picture, what it does, how, and why.
// Public page at /guide (no sign-in needed). Numbers are the launch settings; the game shows live values in-app.
import type { ReactNode } from "react";
import { ArtCatch, ArtFlywheel, ArtHud, ArtHuntCam, ArtMap, ArtMarket, ArtPowerUps, ArtPrize, ArtProof, ArtRarity } from "./components/GuideArt";

type Section = { id: string; title: string; art?: ReactNode; what: ReactNode; how: ReactNode[]; why?: ReactNode };

const SECTIONS: Section[] = [
  {
    id: "start", title: "Quick start",
    art: <ArtPrize label="Free raffle entries" />,
    what: <>Vault Hunt is a location game. Original creatures appear on a real map. Catching them earns free entries into raffles for real, professionally graded trading cards.</>,
    how: [
      <>Create an account, sign the rules, and allow location.</>,
      <>Walk toward a creature until it's inside 60 m, tap <b>Catch</b>, then <b>Throw</b>.</>,
      <>Check the <b>Draw</b> tab to see the current prize and your entries.</>,
    ],
    why: <>Playing is always free. Every way to win is open to someone who never spends anything.</>,
  },
  {
    id: "map", title: "The map and moving",
    art: <ArtMap mode="tap" />,
    what: <>You see creatures only inside the blue <b>sight circle</b> around your explorer (300 m to start). Anything outside it is hidden.</>,
    how: [
      <><b>Free players walk.</b> Your explorer follows your phone's GPS, so you move by moving for real.</>,
      <><b>Season Pass holders</b> can also <b>tap anywhere on the map</b> to send their explorer there. Hops under 2 km are free; longer trips cost a few coins and take time to arrive.</>,
      <><b>Re-center</b> brings the map back to you. <b>Go to my location</b> sends a pass holder's explorer back to where you really are.</>,
    ],
    why: <>Walking keeps the free game honest and healthy. Travel costs coins so nobody can teleport around the world for free and sweep every rare spawn.</>,
  },
  {
    id: "catch", title: "Catching",
    art: <ArtCatch />,
    what: <>The catch screen shows the creature inside a white ring with a gold ring shrinking toward it.</>,
    how: [
      <>Tap <b>Throw</b> (or the creature) when the gold ring lines up with the white ring. Better timing means a better chance.</>,
      <>If it breaks free, throw again. Some creatures run away after a few misses.</>,
      <><b>AR</b> shows the creature over your camera; turn your phone to find it. <b>Walk away</b> leaves it for later.</>,
    ],
    why: <>A little skill keeps catching fun. The server decides every result, so nobody can fake a catch.</>,
  },
  {
    id: "throws", title: "Throws",
    what: <>Every throw uses one throw. You get <b>30 free throws every day</b>; they refill at midnight UTC.</>,
    how: [
      <>The <b>🎯 Throws</b> button on the map shows how many you have left. Tap it to buy a pack of 10 for 50 coins.</>,
      <>The <b>More throws</b> power-up adds 10 free throws a day per level.</>,
    ],
    why: <>A daily limit stops bots and keeps rare creatures from being farmed nonstop. Coins (earned by playing) are the only way to buy extra throws.</>,
  },
  {
    id: "entries", title: "Entries and the daily raffle",
    art: <ArtRarity />,
    what: <>Each catch gives raffle entries. Rarer creatures give more: Common 1, Uncommon 2, Rare 5, Legendary 10.</>,
    how: [
      <>Entries go into the current round in the <b>Draw</b> tab. Each round has one graded card prize.</>,
      <>When the round closes, one winner is picked at random. Each entry is one ticket, so more entries means better odds. Every draw is provably fair: see <a href="/verify">the proof page</a>.</>,
      <>Everyone can earn up to <b>20 entries a day</b>. After that, catches still give XP and coins.</>,
      <>Walking players get a <b>walk bonus</b>: +1 entry per catch.</>,
    ],
    why: <>The daily limit is the same for every player, paying or not. You can't buy entries, so the raffle rewards playing, not spending.</>,
  },
  {
    id: "draws", title: "Weekly Vault Draws",
    art: <ArtPrize label="Vault Draw tickets" />,
    what: <>Bigger raffles for cards from the vault, open each week in the <b>Gacha</b> tab, in three sizes: common, rare and epic pulls.</>,
    how: [
      <><b>Free tickets</b>: 1 for every 100 XP you earn that week (up to 20), plus 1 for each daily check-in.</>,
      <>You can also buy tickets with coins: 1,000 coins per ticket for a common pull, 10,000 for rare, 100,000 for epic.</>,
      <>Each player can hold at most 27 tickets per draw, which is exactly what a free player can earn in a week.</>,
      <>When a draw closes, one ticket is picked at random and that player wins the card. New draws open automatically each week while the vault has cards.</>,
    ],
    why: <>The ticket cap means nobody can buy better odds than a dedicated free player. Holders who don't play much can still join: their Power Cells sell for coins, and coins buy tickets.</>,
  },
  {
    id: "coins", title: "Coins",
    what: <>Coins are the in-game currency. You start with 200 and earn more from catches while a coin pot is active.</>,
    how: [
      <>Earn: catch bounties (Common 5, Uncommon 15, Rare 50, Legendary 150; Season Pass holders get a multiplier) and selling Power Cells on the market.</>,
      <>Spend: extra throws, sight boosts, longer trips, Vault Draw tickets, power-ups, creature mint bids, and Power Cells on the market.</>,
    ],
    why: <>Coins can't be bought and can't be cashed out or turned into $VDRAKE. They exist only to play with, which keeps the game a game.</>,
  },
  {
    id: "powerups", title: "Power-ups",
    art: <ArtPowerUps />,
    what: <>Power-up points upgrade your explorer for the season. You choose where each point goes.</>,
    how: [
      <><b>🎯 More throws</b>: +10 free throws a day per level.</>,
      <><b>⚡ Faster explorer</b>: +25% travel speed per level.</>,
      <><b>👁️ Wider sight</b>: +50 m sight circle per level.</>,
      <>Each track goes up to level 5. Get points with coins (the Spark tier), by using Power Cells, or with $VDRAKE (Spark, Surge and Overdrive tiers, priced in dollars, paid from your own wallet).</>,
    ],
    why: <>Power-ups make playing smoother, never luckier: they don't add entries or raffle odds. Throws bought with $VDRAKE count for your log and XP but not raffle entries or coins.</>,
  },
  {
    id: "split", title: "Where $VDRAKE payments go",
    what: <>When you pay for a power-up with $VDRAKE, one transaction splits it four ways, on-chain where anyone can check it.</>,
    how: [
      <><b>40% burned</b>: removed from supply forever.</>,
      <><b>35% to the vault</b>: buys more graded cards for prizes.</>,
      <><b>15% to map drops</b>: funds surprise prize drops on the map.</>,
      <><b>10% to development</b>: servers, maps and the team, held by a multisig.</>,
    ],
    why: <>Spending should make the game better for everyone: more prizes, more drops, and less supply.</>,
  },
  {
    id: "cells", title: "Power Cells and the market",
    art: <ArtMarket />,
    what: <>A Power Cell is an item worth one power-up point. Use it yourself or sell it to another player for coins.</>,
    how: [
      <>Find them in the Gacha tab under <b>Power Cells</b>. <b>Use 1 cell</b> turns it into a point you can place.</>,
      <>To sell, pick how many cells and a total price in coins. Your cells are held until someone buys or you cancel.</>,
      <>A 5% fee is burned on every sale, and prices are capped per cell.</>,
    ],
    why: <>The market lets holders and players trade with each other without real money. Coins in, coins out; nothing leaves the game.</>,
  },
  {
    id: "holders", title: "Holder rewards",
    what: <>People who hold $VDRAKE or Vault Hunt NFTs can claim free Power Cells once a week, even if they rarely play.</>,
    how: [
      <>Link and verify your wallet in <b>Profile</b> (you sign a message; no funds move).</>,
      <>Hold 100,000+ $VDRAKE for 1 cell a week, 1,000,000+ for 2, or 10,000,000+ for 4. Each Vault Hunt NFT adds 1 more (up to 3).</>,
      <>Only what stayed in your wallet for the whole last 24 hours counts, so passing tokens between wallets doesn't earn extra.</>,
      <>Cells are credited automatically each week, or tap <b>Claim this week's cells</b> to get them right away. One claim per account and per wallet each week.</>,
      <><b>Hold longer, earn more</b>: when nothing leaves your wallet for a whole week, that week adds to your streak. 2 weeks in a row: 1.25x your token cells. 4 weeks: 1.5x. 8 weeks: 2x.</>,
    ],
    why: <>Rewards are in-game items only, never tokens or money. Supporters get a way to join the fun, and their cells flow to players through the market. Opens at token launch.</>,
  },
  {
    id: "pass", title: "Season Pass and seasons",
    what: <>Each season brings new creatures and ★ hotspot cities where they spawn four times as often. A Season Pass unlocks extra ways to play during that season.</>,
    how: [
      <>Pass perks: tap-to-travel anywhere, bigger coin bounties, and a 500 m sight circle. The bounty multiplier adjusts once a day (between 2x and 5x) so the season's coin pot doesn't run dry.</>,
      <>Before the NFT mint opens you can unlock the pass with coins. After launch it's a limited NFT you mint right in the game with $VDRAKE.</>,
      <><b>Mint this season, play it next season</b>: each season's NFT passes are sold during the season before, and their perks switch on when that season starts.</>,
      <><b>Every NFT pass gets a random tier</b>, hidden until its season starts and then dealt to all passes at once with public randomness (check it on the <a href="/verify">proof page</a>). The tier unlocks free power-up levels in throws, speed and sight for that season: Common +1, Uncommon +2, Rare +3, Epic +4, Legendary +5 (everything maxed). Odds: 70% / 20% / 7% / 2% / 0.7%.</>,
      <>Season creatures stay in the wild after the season ends.</>,
    ],
    why: <>The pass sells convenience, not odds: pass holders have the same 20-entry daily limit as everyone else.</>,
  },
  {
    id: "mint", title: "Creature mint auctions",
    what: <>Each season's creatures can be minted as limited collectibles. The Mint tab runs auctions for each one.</>,
    how: [
      <>Bid coins. The top bidders when the auction closes win a copy (Common 50 copies, Uncommon 20, Rare 5, Legendary 1).</>,
      <>Late bids extend the clock a few minutes so nobody gets sniped.</>,
      <>If you don't win, most of your bid comes back.</>,
    ],
  },
  {
    id: "buttons", title: "Map buttons",
    art: <ArtHud />,
    what: <>The row of buttons along the top of the map.</>,
    how: [
      <><b>Today</b>: entries you've earned in the last 24 hours, out of 20.</>,
      <><b>🎯 Throws</b>: throws left today. Tap to buy more.</>,
      <><b>Sight</b>: your sight range. Tap to boost it to 1 km for 30 minutes (25 coins).</>,
      <><b>🏙️ 3D</b>: a tilted, street-level map that turns with your phone.</>,
      <><b>📷 Hunt</b>: camera mode for walkers (see below).</>,
      <><b>👾 Retro</b>: a pixel-art look. <b>★ S1</b>: the current season and time left.</>,
    ],
  },
  {
    id: "hunt", title: "Hunt camera",
    art: <ArtHuntCam />,
    what: <>Look for creatures through your camera. They appear in the direction they really are, with their distance.</>,
    how: [
      <>Tap <b>📷 Hunt</b>, allow camera and motion, and turn around slowly.</>,
      <>The radar in the corner shows everything in sight. Walk toward one until you can catch it.</>,
    ],
  },
  {
    id: "flywheel", title: "How it all fits together",
    art: <ArtFlywheel />,
    what: <>Vault Hunt is built so that playing, holding and spending all feed the same prize vault.</>,
    how: [
      <><b>Play free</b>: catches, walking and check-ins earn entries, XP and coins.</>,
      <><b>Win</b>: entries and tickets go into raffles for real graded cards.</>,
      <><b>Upgrade</b>: coins and $VDRAKE buy power-ups; $VDRAKE payments burn supply and refill the vault.</>,
      <><b>Restock</b>: the vault buys more cards, so there's always something to win.</>,
    ],
    why: <>More players means more reasons to upgrade, more vault funding, and more prizes, which brings more players.</>,
  },
  {
    id: "proof", title: "Provably fair draws",
    art: <ArtProof />,
    what: <>You don't have to trust us to pick winners fairly. Every draw leaves a public trail you can check.</>,
    how: [
      <><b>Freeze</b>: when a draw closes, everyone's tickets are listed under anonymous codes, and the list gets a fingerprint (a SHA-256 hash).</>,
      <><b>Commit</b>: the fingerprint goes on Solana together with the number of a drand round about a minute in the future.</>,
      <><b>Reveal</b>: drand publishes that round's random number. Nobody, including us, could know it in advance.</>,
      <><b>Pick</b>: the random number and the fingerprint decide the winning ticket. Anyone can redo it on the <a href="/verify">proof page</a>, which checks each step in your own browser.</>,
    ],
    why: <>Locking the list before the randomness exists means nobody can add entries after seeing the result, and nobody can choose the randomness.</>,
  },
  {
    id: "fair", title: "Fair play",
    what: <>The rules that keep the game fair for free players.</>,
    how: [
      <>The server decides every catch, coin, entry and draw. Nothing in your browser can change a result.</>,
      <>Every raffle is provably fair: the entry list is locked on Solana before the randomness exists, the randomness comes from drand (a public beacon run by independent organisations), and anyone can redo the math on the <a href="/verify">proof page</a>.</>,
      <>No purchase is necessary. Buying never gives more raffle odds than a free player can earn.</>,
      <>Coins and items never turn into money or $VDRAKE.</>,
      <>You must be 18+ and in a place where these raffles are allowed. The full Terms and Privacy Policy are in Profile.</>,
    ],
  },
];

export default function Guide() {
  return (
    <div className="guide">
      <header className="guide-head">
        <a href="/" className="logo">Vault <span>Hunt</span></a>
        <a className="btn small" href="/">Play</a>
      </header>
      <div className="guide-body">
        <h1>How to play</h1>
        <p className="sub">Everything in Vault Hunt: what each part does, how to use it, and why it works the way it does.</p>
        <video className="guide-video" controls preload="metadata" playsInline poster="/media/how-it-works.jpg" src="/media/how-it-works.mp4">
          Your browser can't play this video. <a href="/media/how-it-works.mp4">Download it</a>.
        </video>
        <nav className="guide-toc" aria-label="Contents">
          {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}
        </nav>
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="guide-sec">
            <h2>{s.title}</h2>
            <div className={"guide-grid" + (s.art ? "" : " no-art")}>
              {s.art && <div className="guide-art">{s.art}</div>}
              <div className="guide-text">
                <p>{s.what}</p>
                <h3>How</h3>
                <ul>{s.how.map((h, i) => <li key={i}>{h}</li>)}</ul>
                {s.why && <><h3>Why</h3><p className="why">{s.why}</p></>}
              </div>
            </div>
          </section>
        ))}
        <p className="sub center guide-foot">Numbers shown are the launch settings; the game always shows the current ones. <a href="/">Back to the game</a></p>
      </div>
    </div>
  );
}
