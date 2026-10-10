import { useState } from "react";
import { configured, supabase } from "../lib/supabase";
import { creatureImage } from "../lib/species";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setState("sending");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    if (error) { setError(error.message); setState("idle"); } else setState("sent");
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="creatures">{[0, 3, 6].map((i) => <img key={i} src={creatureImage(i, 48)} alt="" width={64} height={64} />)}</div>
        <h1 className="logo big">Vault <span>Hunt</span></h1>
        <p className="sub">Find creatures around your city. Every catch is a free entry in the draw for a real graded card.</p>
        {!configured && <p className="err">This build isn't connected to a game server yet. Add your Supabase keys to .env.local (see README).</p>}
        {state === "sent" ? (
          <p className="ok">Check your email for a sign-in link. Open it on this phone to start hunting.</p>
        ) : (
          <form onSubmit={submit} className="stack">
            <label className="field">Email<input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
            <button className="btn" disabled={state === "sending" || !configured}>{state === "sending" ? "Sending..." : "Email me a sign-in link"}</button>
            {error && <p className="err">{error}</p>}
          </form>
        )}
        <p className="sub small">No wallet needed to play. You'll add a Solana address only if you win.</p>
      </div>
    </div>
  );
}
