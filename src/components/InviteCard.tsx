// Profile card: your referral code is your username. Shows your invite links and how many people used them.
import { useEffect, useState } from "react";
import { gameLink, myReferrals, signupLink, type MyReferrals } from "../lib/referral";
import { LINKS } from "../lib/links";

export default function InviteCard({ username, toast }: { username: string; toast: (m: string) => void }) {
  const [r, setR] = useState<MyReferrals | null>(null);
  useEffect(() => { myReferrals().then(setR); }, [username]);
  const link = gameLink(username);
  const text = `Come hunt creatures with me on @${LINKS.xHandle} and win real graded cards: ${link} #SLABHUNT`;

  async function copy(v: string) {
    try { await navigator.clipboard.writeText(v); toast("Link copied!"); } catch { toast(v); }
  }
  async function share() {
    if (navigator.share) { try { await navigator.share({ title: "Slab Hunt", text, url: link }); return; } catch { /* cancelled */ } }
    window.open(`https://x.com/intent/post?${new URLSearchParams({ text })}`, "_blank", "noopener");
  }

  return (
    <div className="card invite">
      <strong>Invite friends</strong>
      <p className="sub">Your referral code is your username: <b>{username}</b>. Friends who join with your link are counted as your invites.</p>
      <div className="invite-link"><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Your invite link" /><button className="btn small" onClick={() => copy(link)}>Copy</button></div>
      <div className="row">
        <button className="btn" onClick={share}>Share</button>
        <button className="btn ghost" onClick={() => copy(signupLink(username))}>Copy early-access link</button>
      </div>
      {r && (
        <p className="sub">
          Players invited: <b>{r.players}</b> · Early-access signups: <b>{r.signups}</b>
          {r.by ? <> · You were invited by <b>{r.by}</b></> : null}
        </p>
      )}
      <p className="sub small">Changed your username? Your link changes with it; people who already joined stay counted.</p>
    </div>
  );
}
