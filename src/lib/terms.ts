// Terms of Use and Official Rules that every player signs before playing.
// Bump TERMS_VERSION whenever the text changes in a way players must re-accept.
// Have an attorney review before real prizes or token payments go live.
export const TERMS_VERSION = "2026-10-11.3"; // .2 added the Privacy Policy; .3 renamed the game to Slab Hunt

export type TermsSection = { title: string; points: string[] };

export const TERMS: TermsSection[] = [
  {
    title: "1. Who can play",
    points: [
      "You must be at least 18 years old (or the age of majority where you live, if higher).",
      "Prize draws, $VDRAKE features and NFT features are void where prohibited or restricted by law. You are responsible for knowing whether they are legal where you live, and you agree not to use them if they are not.",
      "One account per person. Accounts created with bots, scripts or false information can be closed and their entries and prizes forfeited.",
    ],
  },
  {
    title: "2. Playing safely and your location",
    points: [
      "Slab Hunt uses your device's location to place creatures and check catches. Location is used for gameplay and anti-cheat, not sold.",
      "Stay aware of your surroundings. Do not enter private property, trespass, play while driving, or put yourself or others at risk. You play at your own risk.",
      "Spoofing your location, using bots or exploiting bugs is not allowed and can lead to forfeiture of coins, entries, tickets and prizes.",
    ],
  },
  {
    title: "3. Coins and in-game items",
    points: [
      "Coins are earned only by playing. They cannot be bought with money or crypto, have no cash value, and are not property you own.",
      "Coins can be spent only inside the game (throws, sight boosts, travel, power-ups, creature bids and draw tickets). Coins can never be exchanged for $VDRAKE, other crypto, money or anything outside the game.",
      "Power-up items and other in-game items, including those earned by holding $VDRAKE or NFTs, can be traded only for coins in the in-game marketplace. Selling accounts, coins or items for money or crypto outside the game is not allowed.",
      "We may adjust coin prices, rewards, supply and game balance at any time, and may reset or remove coins and items obtained through bugs or rule-breaking.",
    ],
  },
  {
    title: "4. Official rules: raffles and Vault Draws",
    points: [
      "NO PURCHASE NECESSARY. Buying $VDRAKE, NFTs or anything else does not increase your maximum chance of winning.",
      "Free ways to enter: catching creatures (daily entry cap applies to everyone), weekly tickets earned from play, and a free daily check-in ticket. Draw tickets can also be bought with earned coins, and where enabled with $VDRAKE, but every player has the same ticket cap per draw, which a free player can reach through play and check-ins.",
      "Catches made with power-up throws bought with $VDRAKE do not add raffle entries.",
      "Winners are chosen at random, weighted by the number of valid entries or tickets. Odds depend on how many entries are received. Each draw lists its prize, end time and ticket cap in the game.",
      "Prizes are graded trading cards (or digital representations of them) from the Slab Hunt vault, with the description shown in the game. Prizes are not exchangeable for cash. We may substitute a prize of equal or greater value if a listed prize becomes unavailable.",
      "Winners may need to verify their identity, age, eligibility and wallet or shipping details before a prize is delivered. Unclaimed prizes after 30 days may be forfeited and re-drawn. Winners are responsible for any taxes.",
    ],
  },
  {
    title: "5. $VDRAKE token",
    points: [
      "$VDRAKE is a digital collectible and in-game payment token. You do not need it to play, catch creatures or win prizes.",
      "$VDRAKE is not an investment. It does not represent equity, debt, dividends, revenue share or any right to profits, and the Slab Hunt team makes no promise that its price will rise or that it can be sold.",
      "Buying $VDRAKE can lose you all the money you put in. Prices can be volatile and liquidity can disappear. In the launch pool, the team is the seller.",
      "Payments in $VDRAKE for power-ups, draw tickets, passes and mints are final. Each payment is split on-chain as shown in the game (for example part burned, part to the card vault, part to the map-drops treasury and part to development).",
      "How launch proceeds and fees are used is described in the public token disclosure. Nothing in the game or our posts is financial, legal or tax advice.",
    ],
  },
  {
    title: "6. NFTs: Season Passes and creatures",
    points: [
      "Season Passes and creature NFTs are digital collectibles. Season mints may assign creatures at random, with rarity revealed after the mint; the price you pay does not guarantee a particular rarity.",
      "Any $VDRAKE set aside to back NFTs is described in the token disclosure and is not a guarantee of the NFT's market value.",
      "Holding $VDRAKE or NFTs can earn in-game perks such as power-up items. These are in-game benefits only and are never paid in $VDRAKE, other crypto or money.",
    ],
  },
  {
    title: "7. Wallets and blockchain risks",
    points: [
      "Your wallet is yours. We never ask for your seed phrase or private keys, and we cannot reverse blockchain transactions or recover lost wallets.",
      "Blockchain networks can be slow, fail or charge fees outside our control. Smart contracts and third-party services (wallets, exchanges, pools) carry their own risks.",
    ],
  },
  {
    title: "8. Your account and content",
    points: [
      "Keep your login private. You are responsible for activity on your account.",
      "Be respectful in chat. We may remove messages and suspend accounts for abuse, spam, scams or impersonation.",
      "Slab Hunt's creatures, art and name are original works owned by the Slab Hunt team.",
    ],
  },
  {
    title: "9. Changes, liability and contact",
    points: [
      "The game is provided as is. To the extent the law allows, the Slab Hunt team is not liable for indirect losses, lost profits, token price changes, or injuries or damages from playing in the real world.",
      "We may update these terms; when we do, you'll be asked to accept the new version before continuing to play.",
      "Questions or prize claims: contact us through the in-game chat or our official channels listed in the game.",
    ],
  },
];

export const PRIVACY: TermsSection[] = [
  {
    title: "What we collect",
    points: [
      "Account: your email address, username and password (stored only as a secure hash by our login provider).",
      "Location: your device's location while the game is open, to show nearby creatures and check catches and travel. We keep your most recent position and the places where you caught creatures, not a continuous history of your movements.",
      "Gameplay: catches, coins, XP, entries, tickets, power-ups, purchases, draw results and chat messages.",
      "Device and network: your network address and browser type when you sign in, sign the terms or use features that guard against cheating.",
      "Wallets: any Solana wallet address or .sol name you add, and the public transactions you make with it.",
      "Camera and motion sensors (AR catch, hunt mode, 3D compass): processed only on your device. We do not record, upload or store camera images.",
    ],
  },
  {
    title: "How we use it",
    points: [
      "To run the game: spawning creatures, checking catches, preventing cheating and GPS spoofing, running draws and delivering prizes.",
      "To keep accounts secure, answer support requests and enforce these terms.",
      "To understand and improve the game in aggregate. We do not sell your personal information or use it for third-party advertising.",
    ],
  },
  {
    title: "What other players can see",
    points: [
      "Your username, level, catches, rankings, chat messages and any prizes you win (winners are announced in chat).",
      "Your exact location, email and wallet address are not shown to other players. Wallet transactions on the blockchain are public by nature and cannot be deleted.",
    ],
  },
  {
    title: "Who we share it with",
    points: [
      "Service providers that run the game for us: hosting and database (Supabase, Vercel), map tiles (OpenStreetMap-based map services), blockchain data (Solana RPC providers such as Helius), token prices (Jupiter) and email delivery. They only process data to provide their service.",
      "Prize delivery partners when you win (for example a shipping or vault service), and authorities when the law requires it or to prevent fraud.",
    ],
  },
  {
    title: "How long we keep it",
    points: [
      "Account and gameplay data while your account is open. Records of draws, prizes, purchases and signed terms are kept as long as needed for legal, tax and dispute purposes.",
      "Browser storage on your device only holds conveniences like your sign-in session and display settings (retro mode, 3D view).",
    ],
  },
  {
    title: "Your choices and rights",
    points: [
      "You can turn off location in your browser at any time; walking features stop working without it.",
      "You can ask to see, correct or delete your data, or close your account, by contacting us through our official channels. Depending on where you live (for example California or the EU/UK) you may have additional rights, and we will honor them.",
      "Slab Hunt is for adults 18+. We do not knowingly collect data from children; if we learn we have, we delete it.",
    ],
  },
  {
    title: "Security and changes",
    points: [
      "Data is encrypted in transit and access is limited by database rules. No system is perfectly secure; keep your password private and never share your wallet seed phrase.",
      "We will post changes to this policy in the game and ask you to accept major changes.",
    ],
  },
];
