// slabhunt.fun/legal: the public Terms of Use, Official Rules and Privacy Policy (the same text players sign in the
// game), plus how to delete your account. App stores and token listings link here.
import { TermsText } from "./components/TermsGate";
import { LINKS } from "./lib/links";

export default function Legal() {
  return (
    <div className="guide legal">
      <header className="guide-head">
        <a href="/" className="logo">Slab <span>Hunt</span></a>
        <nav className="row"><a href="#privacy">Privacy</a><a href="#delete">Delete your account</a><a href="/guide">How to play</a></nav>
      </header>
      <main className="stack">
        <TermsText />
        <section className="card" id="delete">
          <h2 className="sec">Delete your account and data</h2>
          <ol>
            <li>Open <a href="/">slabhunt.fun</a> and sign in.</li>
            <li>Go to <b>Profile → Your data and privacy</b>.</li>
            <li>Tap <b>Delete my account</b> and confirm. Your account and game data (profile, catches, coins, items, chat
              messages, linked wallet address) are deleted after a 7-day grace period, during which you can cancel.</li>
          </ol>
          <p className="sub">You can download a copy of your data from the same screen first. Records we must keep by law (for
            example prize-winner records) are kept only as long as required. NFTs and $SLAB in your own wallet are never
            affected. Can't sign in? DM <a href={LINKS.x} target="_blank" rel="noopener noreferrer">@{LINKS.xHandle}</a> on X.</p>
        </section>
      </main>
    </div>
  );
}
