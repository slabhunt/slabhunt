import { useState } from "react";
import { configured, supabase } from "../lib/supabase";
import { creatureImage } from "../lib/species";

type Mode = "password" | "signup" | "link" | "forgot";

export default function SignIn() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const redirect = { emailRedirectTo: window.location.origin };

  function go(m: Mode) { setMode(m); setError(""); setSent(""); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    const addr = email.trim();
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (error) setError(/invalid login/i.test(error.message)
          ? "Wrong email or password. If you joined with an email link, tap \"Forgot password?\" to set one."
          : /not confirmed/i.test(error.message) ? "Confirm your email first: open the link we sent you." : error.message);
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: addr, password, options: redirect });
        if (error) setError(error.message);
        else if (!data.session) setSent("Check your email and tap the link to confirm your account. Then sign in here.");
      } else if (mode === "link") {
        const { error } = await supabase.auth.signInWithOtp({ email: addr, options: redirect });
        if (error) setError(error.message); else setSent("Check your email for a sign-in link. Open it on this phone to start hunting.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: window.location.origin });
        if (error) setError(error.message); else setSent("Check your email for a link to set a new password.");
      }
    } finally {
      setBusy(false);
    }
  }

  const needsPassword = mode === "password" || mode === "signup";
  const button = { password: "Sign in", signup: "Create account", link: "Email me a sign-in link", forgot: "Email me a reset link" }[mode];

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="creatures">{[0, 3, 6].map((i) => <img key={i} src={creatureImage(i, 48)} alt="" width={64} height={64} />)}</div>
        <h1 className="logo big">Vault <span>Hunt</span></h1>
        <p className="sub">Find creatures around your city. Every catch is a free entry in the draw for a real graded card.</p>
        {!configured && <p className="err">This build isn't connected to a game server yet. Add your Supabase keys to .env.local (see README).</p>}
        {mode !== "link" && mode !== "forgot" && (
          <div className="seg" role="tablist" aria-label="Sign in or create an account">
            <button role="tab" aria-selected={mode === "password"} onClick={() => go("password")}>Sign in</button>
            <button role="tab" aria-selected={mode === "signup"} onClick={() => go("signup")}>Create account</button>
          </div>
        )}
        {sent ? (
          <>
            <p className="ok">{sent}</p>
            <button className="link-btn" onClick={() => go("password")}>Back to sign in</button>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            {mode === "forgot" && <p className="sub">Enter your email and we'll send a link to set a new password.</p>}
            <label className="field">Email<input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
            {needsPassword && (
              <label className="field">Password
                <input id="password" type="password" required minLength={mode === "signup" ? 8 : undefined} value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "At least 8 characters" : ""}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"} />
              </label>
            )}
            <button className="btn" disabled={busy || !configured}>{busy ? "One moment..." : button}</button>
            {error && <p className="err">{error}</p>}
            <div className="signin-links">
              {mode === "password" && <button type="button" className="link-btn" onClick={() => go("forgot")}>Forgot password?</button>}
              {mode !== "link" && <button type="button" className="link-btn" onClick={() => go("link")}>Email me a sign-in link instead</button>}
              {(mode === "link" || mode === "forgot") && <button type="button" className="link-btn" onClick={() => go("password")}>Sign in with a password</button>}
            </div>
          </form>
        )}
        <p className="sub small">No wallet needed to play. You'll add a Solana address only if you win.</p>
      </div>
    </div>
  );
}

/** Shown after a password-reset link (or from Profile): pick a new password. */
export function SetPassword({ title, onDone }: { title: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message); else setOk(true);
  }
  return ok ? (
    <div className="stack">
      <p className="ok">Password saved. Next time, sign in with your email and this password.</p>
      <button className="btn" onClick={onDone}>Continue</button>
    </div>
  ) : (
    <form onSubmit={submit} className="stack">
      <h2 className="sec">{title}</h2>
      <label className="field">New password
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
      </label>
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? "Saving..." : "Save password"}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Not now</button>
      </div>
      {error && <p className="err">{error}</p>}
    </form>
  );
}
