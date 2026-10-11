import { useState } from "react";
import { configured, supabase } from "../lib/supabase";
import { creatureImage } from "../lib/species";

type Mode = "password" | "signup" | "link" | "forgot";

/** New-password rules, shown as a live checklist. */
const RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: "At least 8 characters", ok: (p) => p.length >= 8 },
  { label: "An uppercase letter", ok: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", ok: (p) => /[a-z]/.test(p) },
  { label: "A number", ok: (p) => /[0-9]/.test(p) },
  { label: "A symbol, like ! @ # $ %", ok: (p) => /[^A-Za-z0-9]/.test(p) },
];
const strongEnough = (p: string, confirm: string) => RULES.every((r) => r.ok(p)) && p === confirm;

/** Password + confirm fields with a checklist that ticks off as you type. */
function NewPassword({ password, confirm, setPassword, setConfirm, label = "Password" }: {
  password: string; confirm: string; setPassword: (v: string) => void; setConfirm: (v: string) => void; label?: string;
}) {
  const [show, setShow] = useState(false);
  const match = confirm.length > 0 && confirm === password;
  return (
    <>
      <label className="field">{label}
        <input type={show ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-describedby="pw-rules" />
      </label>
      <label className="field">Confirm password
        <input type={show ? "text" : "password"} required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="toggle"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
      <ul className="pw-rules" id="pw-rules" aria-live="polite">
        {RULES.map((r) => { const ok = r.ok(password); return <li key={r.label} className={ok ? "ok" : ""}><span aria-hidden="true">{ok ? "✓" : "○"}</span> {r.label}<span className="sr-only">{ok ? " (done)" : " (needed)"}</span></li>; })}
        <li className={match ? "ok" : ""}><span aria-hidden="true">{match ? "✓" : "○"}</span> Both passwords match<span className="sr-only">{match ? " (done)" : " (needed)"}</span></li>
      </ul>
    </>
  );
}

/** Plain-language versions of the email service's errors. */
function friendly(msg: string) {
  if (/rate limit|too many|seconds/i.test(msg)) return "Too many emails were sent to this address recently. Wait about an hour and try again, and check your spam folder for an earlier link.";
  return msg;
}

export default function SignIn() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  // Set when the email already has an account (sign-up) or the password was wrong: offer sign-in and a reset.
  const [helpReset, setHelpReset] = useState<"" | "exists" | "wrong">("");
  const redirect = { emailRedirectTo: window.location.origin };

  function go(m: Mode) { setMode(m); setError(""); setSent(""); setHelpReset(""); }

  async function sendReset() {
    const addr = email.trim();
    if (!addr.includes("@")) { go("forgot"); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: window.location.origin });
    setBusy(false);
    setHelpReset("");
    if (error) setError(friendly(error.message));
    else { setError(""); setSent(`We sent a reset link to ${addr}. Open it on this phone, then choose a new password. Check spam if it's not there in a minute.`); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !strongEnough(password, confirm)) { setError("Your password needs everything on the checklist."); return; }
    setError(""); setHelpReset(""); setBusy(true);
    const addr = email.trim();
    try {
      if (mode === "password" && !addr.includes("@")) {
        // Username: the server finds the email behind it and signs in, so emails stay private.
        const { data, error } = await supabase.functions.invoke("login", { body: { username: addr, password } });
        let code = (data as { error?: string } | null)?.error;
        if (error) {
          try { code = (await (error as { context?: Response }).context?.json())?.error; } catch { code = "network"; }
        }
        const tokens = data as { access_token?: string; refresh_token?: string } | null;
        if (!error && tokens?.access_token && tokens.refresh_token) {
          const { error: e2 } = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
          if (e2) setError(e2.message);
        } else setError(
          code === "slow_down" ? "Too many tries. Wait 15 minutes, or use \"Forgot password?\" with your email."
            : code === "unconfirmed" ? "Confirm your email first: open the link we sent you."
            : code === "invalid" ? "Wrong username or password. Use your email below to reset it."
            : "Couldn't sign in right now. Try again, or use your email.");
      } else if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (error && /invalid login/i.test(error.message)) {
          setError("Wrong email or password.");
          setHelpReset("wrong");
        } else if (error) setError(/not confirmed/i.test(error.message) ? "Confirm your email first: open the link we sent you." : error.message);
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: addr, password, options: redirect });
        if (error) setError(/already registered|already exists/i.test(error.message) ? "This email already has an account." : error.message);
        // An existing email comes back with no identities (and no email is sent): send them to sign in or reset instead.
        if (error && /already/i.test(error.message)) setHelpReset("exists");
        else if (!error && data.user && (data.user.identities?.length ?? 0) === 0) { setError("This email already has an account."); setHelpReset("exists"); }
        else if (!error && !data.session) setSent("Check your email and tap the link to confirm your account. Then sign in here. (Check spam if it's not there in a minute.)");
      } else if (mode === "link") {
        const { error } = await supabase.auth.signInWithOtp({ email: addr, options: redirect });
        if (error) setError(friendly(error.message)); else setSent("Check your email for a sign-in link. Open it on this phone to start hunting.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: window.location.origin });
        if (error) setError(friendly(error.message)); else setSent("Check your email for a link to set a new password. Check spam if it's not there in a minute.");
      }
    } finally {
      setBusy(false);
    }
  }

  const button = { password: "Sign in", signup: "Create account", link: "Email me a sign-in link", forgot: "Email me a reset link" }[mode];

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="creatures">{[0, 3, 6].map((i) => <img key={i} src={creatureImage(i, 48)} alt="" width={64} height={64} />)}</div>
        <h1 className="logo big">Slab <span>Hunt</span></h1>
        <p className="sub">Find creatures around your city. Every catch is a free entry in the draw for a real graded card. <a className="tut-link" href="/guide">How to play</a></p>
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
            {mode === "password"
              ? <label className="field">Email or username<input id="email" type="text" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com or hunter_name" autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
              : <label className="field">Email<input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>}
            {mode === "signup" && <NewPassword password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />}
            {mode === "password" && (
              <label className="field">Password
                <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
            )}
            <button className="btn" disabled={busy || !configured || (mode === "signup" && !strongEnough(password, confirm))}>{busy ? "One moment..." : button}</button>
            {error && <p className="err">{error}</p>}
            {helpReset && (
              <div className="help-reset">
                <p className="sub">{helpReset === "exists" ? "Sign in with your password, or reset it if you forgot it." : "Forgot it? We'll email you a link to choose a new one."}</p>
                <div className="row">
                  {helpReset === "exists" && <button type="button" className="btn ghost" onClick={() => { const e = email; go("password"); setEmail(e); }}>Sign in</button>}
                  <button type="button" className="btn" disabled={busy} onClick={sendReset}>Reset my password</button>
                </div>
              </div>
            )}
            <div className="signin-links">
              {mode === "password" && <button type="button" className="link-btn" onClick={() => go("forgot")}>Forgot password?</button>}
              {mode !== "link" && <button type="button" className="link-btn" onClick={() => go("link")}>Email me a sign-in link instead</button>}
              {(mode === "link" || mode === "forgot") && <button type="button" className="link-btn" onClick={() => go("password")}>Sign in with a password</button>}
            </div>
          </form>
        )}
        <p className="sub small">No wallet needed to play. You'll add a Solana address only if you win. After signing in, you'll be asked to sign our Terms of Use, Official Rules and Privacy Policy (18+).</p>
      </div>
    </div>
  );
}

/** Shown after a password-reset link (or from Profile): pick a new password. */
export function SetPassword({ title, onDone }: { title: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!strongEnough(password, confirm)) { setError("Your password needs everything on the checklist."); return; }
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
      <NewPassword label="New password" password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />
      <div className="row">
        <button className="btn" disabled={busy || !strongEnough(password, confirm)}>{busy ? "Saving..." : "Save password"}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Not now</button>
      </div>
      {error && <p className="err">{error}</p>}
    </form>
  );
}
