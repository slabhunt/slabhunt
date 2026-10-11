// Terms of Use and Official Rules: players read and sign (typed name + confirmations) before playing.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { PRIVACY, TERMS, TERMS_VERSION } from "../lib/terms";

export function TermsText() {
  return (
    <div className="terms-text">
      <h2 className="terms-h">Terms of Use and Official Rules</h2>
      {TERMS.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          <ul>{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </section>
      ))}
      <h2 className="terms-h" id="privacy">Privacy Policy</h2>
      {PRIVACY.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          <ul>{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </section>
      ))}
      <ContactLine />
      <p className="sub small">Version {TERMS_VERSION}</p>
    </div>
  );
}

/** Where to send questions, prize claims and privacy requests (set by an admin). */
function ContactLine() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => { supabase.rpc("support_info").then(({ data }) => setEmail((data as { email?: string | null } | null)?.email ?? null)); }, []);
  return <p className="sub">Contact for questions, prize claims and privacy requests: {email ? <b className="select">{email}</b> : "in-game chat until our support email is live"}. You can also download or delete your data in Profile.</p>;
}

export default function TermsGate({ onAccepted, updated }: { onAccepted: () => void; updated: boolean }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState(false);
  const [place, setPlace] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = name.trim().length >= 2 && age && place && agree;

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError("");
    const { data, error } = await supabase.rpc("accept_terms", { p_version: TERMS_VERSION, p_name: name.trim(), p_age: age, p_location: place });
    setBusy(false);
    if (error || (data as { error?: string } | null)?.error) { setError("Couldn't save your signature. Check your connection and try again."); return; }
    onAccepted();
  }

  return (
    <div className="signin">
      <div className="signin-card terms-card">
        <h1 className="logo big">Vault <span>Hunt</span></h1>
        <h2 className="sec">{updated ? "Our terms have changed" : "Terms, Official Rules and Privacy"}</h2>
        <p className="sub">Please read and sign before you play. The short version: playing and winning are free, coins have no cash value and can't become crypto, $VDRAKE is not an investment, play safely, and we never sell your data.</p>
        <div className="terms-scroll" tabIndex={0} aria-label="Terms of Use, Official Rules and Privacy Policy"><TermsText /></div>
        <form className="stack" onSubmit={sign}>
          <label className="toggle"><input id="t-age" type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} /> I am 18 or older (or the age of majority where I live).</label>
          <label className="toggle"><input id="t-place" type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} /> Prize draws and token features are legal where I live, and I won't use them where they aren't.</label>
          <label className="toggle"><input id="t-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read and agree to the Terms of Use, Official Rules and Privacy Policy above.</label>
          <label className="field">Type your full name to sign
            <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" placeholder="Full name" />
          </label>
          <button className="btn" disabled={!ready || busy}>{busy ? "Saving..." : "Sign and start playing"}</button>
          {error && <p className="err">{error}</p>}
          <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>Not now (sign out)</button>
        </form>
      </div>
    </div>
  );
}
