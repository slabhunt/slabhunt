// slabhunt.fun/signup: the pre-launch early-access list. To join: X handle, Solana wallet, email, and the X tasks on the
// pinned gameplay post (like, comment, quote-repost with #SLABHUNT and your link). X doesn't let a website confirm likes
// or reposts, so we ask for the quote-post link as proof and spot-check. Your referral code is your X handle; a
// player's code is their game username. Saves through the `signup` edge function.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { LINKS } from "./lib/links";

type Place = { code: string; position: number; referrals: number; total: number };
type Task = "like" | "comment" | "quote" | "follow";
const KEY = "sh_signup_code";
const TAG = "#SLABHUNT";
const KINDS: [string, string][] = [["collector", "Card collector"], ["gamer", "Gamer"], ["crypto", "Crypto / NFTs"], ["explorer", "I just like exploring"]];
const ERR: Record<string, string> = {
  email: "That email doesn't look right.",
  x: "Enter your X handle (letters, numbers and _ only, 15 max).",
  wallet: "That isn't a Solana wallet address. Copy it from Phantom or Solflare.",
  quote: "Paste the link to your quote post. It has to be from the X handle you entered (x.com/yourhandle/status/...).",
  slow_down: "Lots of signups from your network. Try again in an hour.",
};

function load() { try { return localStorage.getItem(KEY); } catch { return null; } }
function save(code: string) { try { localStorage.setItem(KEY, code); } catch { /* fine */ } }
const intent = (path: string, params: Record<string, string>) => `https://x.com/intent/${path}?${new URLSearchParams(params)}`;

export default function Signup() {
  const ref = (new URLSearchParams(location.search).get("ref") ?? "").replace(/^@/, "").slice(0, 24);
  const [place, setPlace] = useState<Place | null>(null);
  const [post, setPost] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [inviter, setInviter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<Record<Task, boolean>>({ like: false, comment: false, quote: false, follow: false });
  const [f, setF] = useState({ x: "", wallet: "", email: "", quote_url: "", city: "", kind: "", updates: true, website: "" });

  useEffect(() => {
    supabase.functions.invoke("signup", { body: { action: "config" } }).then(({ data }) => {
      if (data && !data.error) { setPost(data.post_url ?? null); setTotal(data.total ?? 0); }
    });
    if (ref) supabase.functions.invoke("signup", { body: { action: "lookup", ref } }).then(({ data }) => { if (data?.name) setInviter(data.name); });
    const code = load();
    if (code) supabase.functions.invoke("signup", { body: { action: "status", code } }).then(({ data }) => { if (data && !data.error) setPlace(data as Place); });
  }, [ref]);

  const handle = f.x.trim().replace(/^@/, "");
  const postId = post?.match(/status\/(\d+)/)?.[1] ?? "";
  const account = post?.match(/x\.com\/([A-Za-z0-9_]+)\/status/i)?.[1] ?? LINKS.xHandle;
  const myLink = `https://slabhunt.fun/signup${handle ? `?ref=${handle}` : ""}`;
  const links = useMemo(() => ({
    like: postId ? intent("like", { tweet_id: postId }) : "",
    comment: postId ? intent("post", { in_reply_to: postId, text: `Ready to hunt 🃏 ${TAG}` }) : "",
    quote: intent("post", post
      ? { text: `Hunting creatures on a real map to win real graded cards with @${LINKS.xHandle}. Get on the list: ${myLink} ${TAG}`, url: post }
      : { text: `Hunting creatures on a real map to win real graded cards with @${LINKS.xHandle}. Get on the Slab Hunt list: ${myLink} ${TAG}` }),
    follow: account ? intent("follow", { screen_name: account }) : "",
  }), [post, postId, account, myLink]);

  const tasks: [Task, string, string][] = post
    ? [["like", "Like the post", "Like on X"], ["comment", `Comment on it with ${TAG}`, "Reply on X"], ["quote", `Quote-repost it with ${TAG} and your link`, "Quote on X"]]
    : [["quote", `Post about Slab Hunt with ${TAG} and your link`, "Post on X"]];
  if (account) tasks.push(["follow", `Follow @${account}`, "Follow"]);
  const required = tasks.filter(([t]) => t !== "follow").every(([t]) => done[t]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!required) { setErr("Do the X tasks first, then paste your quote-post link."); return; }
    setErr(""); setBusy(true);
    const { data, error } = await supabase.functions.invoke("signup", { body: { action: "join", ref, tasks: done, ...f } });
    setBusy(false);
    if (error || !data) { setErr("Couldn't reach the server. Try again in a minute."); return; }
    if (data.error) { setErr(ERR[data.error] ?? "Something went wrong. Try again."); return; }
    if (data.already) { setErr("That email, X handle or wallet is already on the list."); return; }
    save(data.code); setPlace(data as Place);
  }

  const shareLink = place ? `https://slabhunt.fun/signup?ref=${place.code}` : "";
  async function copy() {
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* select it manually */ }
  }

  return (
    <main className="su">
      <div className="su-sky" aria-hidden="true"><div className="su-rain" /><div className="su-scan" /></div>
      <section className="su-card">
        <a href="/" className="su-logo"><img src="/brand/icon-192.png" alt="" /><span>SLAB <b>HUNT</b></span></a>
        <h1 className="su-title">Hunt creatures.<br /><em>Win slabs.</em></h1>
        <p className="su-lead">A free location game on a real map. Catch creatures around your city for raffle entries, and win real graded cards. Get on the early-access list.</p>
        {total > 0 && !place && <p className="su-count">{total.toLocaleString()} hunters on the list</p>}
        {inviter && !place && <p className="su-note">Invited by <b>@{inviter}</b>. Joining with their link moves them up.</p>}
        {place ? (
          <div className="su-done" aria-live="polite">
            <p className="su-pos"><small>YOUR SPOT</small><b>#{place.position.toLocaleString()}</b><small>of {place.total.toLocaleString()}</small></p>
            <p>You're in! Your referral code is your X handle. Every friend who joins with your link moves you up.{place.referrals ? ` Friends so far: ${place.referrals}.` : ""}</p>
            <div className="su-link"><input readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} aria-label="Your referral link" /><button type="button" className="su-btn small" onClick={copy}>{copied ? "Copied!" : "Copy"}</button></div>
            <a className="su-btn x" href={intent("post", { text: `I'm on the list for Slab Hunt: hunt creatures on a real map, win real graded cards. Get in early: ${shareLink} ${TAG}` })} target="_blank" rel="noopener noreferrer">Share on X</a>
          </div>
        ) : (
          <form className="su-form" onSubmit={submit}>
            <label>Your X handle<input required maxLength={16} value={f.x} onChange={(e) => setF({ ...f, x: e.target.value })} placeholder="@yourname" autoCapitalize="off" spellCheck={false} /></label>

            <fieldset className="su-tasks"><legend><span className="su-step">1</span> Do these on X</legend>
              {post && <a className="su-post" href={post} target="_blank" rel="noopener noreferrer">▶ Watch the live gameplay post</a>}
              {tasks.map(([t, label, btn]) => (
                <div key={t} className={"su-task" + (done[t] ? " on" : "")}>
                  <span className="su-tick" aria-hidden="true">{done[t] ? "✓" : ""}</span>
                  <span className="su-task-l">{label}{t === "follow" && <i> (optional)</i>}</span>
                  <a className="su-btn small ghost" href={links[t]} target="_blank" rel="noopener noreferrer" onClick={() => setDone((d) => ({ ...d, [t]: true }))}>{btn}</a>
                </div>
              ))}
              <label>Link to your {post ? "quote post" : "post"}<input required inputMode="url" value={f.quote_url} onChange={(e) => setF({ ...f, quote_url: e.target.value })} placeholder={`https://x.com/${handle || "yourname"}/status/...`} autoCapitalize="off" spellCheck={false} /></label>
            </fieldset>

            <fieldset className="su-tasks"><legend><span className="su-step">2</span> Your details</legend>
              <label>Solana wallet address<input required maxLength={44} value={f.wallet} onChange={(e) => setF({ ...f, wallet: e.target.value.trim() })} placeholder="From Phantom or Solflare" autoCapitalize="off" spellCheck={false} /></label>
              <label>Email<input type="email" required autoComplete="email" maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@example.com" /></label>
              <label>Your city <i>(optional)</i><input maxLength={80} autoComplete="address-level2" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="So creatures show up near you" /></label>
              <div className="su-kinds" role="radiogroup" aria-label="I'm mostly a">{KINDS.map(([v, l]) => (
                <label key={v} className={"su-kind" + (f.kind === v ? " on" : "")}><input type="radio" name="kind" value={v} checked={f.kind === v} onChange={() => setF({ ...f, kind: v })} />{l}</label>
              ))}</div>
              <label className="su-check"><input type="checkbox" checked={f.updates} onChange={(e) => setF({ ...f, updates: e.target.checked })} />Email me launch news (a few emails, no spam)</label>
            </fieldset>
            <input className="su-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
            {err && <p className="su-err" role="alert">{err}</p>}
            <button className="su-btn" disabled={busy}>{busy ? "Joining..." : "Get early access"}</button>
            <p className="su-fine">Only paste your wallet's public address, never your recovery phrase. We use your wallet only to send prizes or allowlist spots, and your email only for Slab Hunt news; ask us to delete them anytime. <a href="/guide">How the game works</a> · <a href={LINKS.x} target="_blank" rel="noopener noreferrer">@{LINKS.xHandle} on X</a></p>
          </form>
        )}
      </section>
    </main>
  );
}
