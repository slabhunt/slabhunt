// Profile card: report a bug for the bug bounty. Rewards are paid in $SLAB, decided case by case by the team.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

type Mine = { id: number; title: string; status: string; severity: string | null; reward_slab: number | null; payout_tx: string | null; reply: string | null; created_at: string };
const STATUS: Record<string, string> = {
  new: "Received", triaged: "Looking into it", accepted: "Confirmed", duplicate: "Already reported", not_a_bug: "Not a bug",
  fixed: "Fixed", paid: "Reward paid",
};
const ERR: Record<string, string> = {
  too_short: "Add a title (5+ characters) and describe what happened (20+ characters).",
  slow_down: "You've sent 5 reports today. Send more tomorrow.",
  wallet: "That isn't a Solana wallet address.",
};

export default function BugReport({ toast }: { toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Mine[]>([]);
  const [f, setF] = useState({ title: "", details: "", steps: "", severity: "low", area: "game", contact: "", wallet: "" });
  const load = useCallback(async () => { const { data } = await supabase.rpc("my_bug_reports"); setMine((data as Mine[] | null) ?? []); }, []);
  useEffect(() => { load(); }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_bug_report", {
      p_title: f.title, p_details: f.details, p_steps: f.steps, p_severity: f.severity, p_area: f.area, p_contact: f.contact, p_wallet: f.wallet,
    });
    setBusy(false);
    const r = data as { ok?: boolean; error?: string } | null;
    if (error || !r?.ok) { toast(ERR[r?.error ?? ""] ?? "Couldn't send the report. Try again."); return; }
    toast("Thanks! Your report is in. We'll reply here.");
    setF({ ...f, title: "", details: "", steps: "" }); setOpen(false); load();
  }

  return (
    <div className="card bug">
      <h2 className="sec">Bug bounty</h2>
      <p className="sub">Found a bug or a security problem? Report it here. Rewards are paid in $SLAB and decided case by case,
        bigger for serious issues (anything that lets someone cheat, steal or see private data). Please don't test exploits on other players or share them publicly. <a href="/guide#bounty">Rules</a></p>
      {!open ? <button className="btn" onClick={() => setOpen(true)}>Report a bug</button> : (
        <form className="stack" onSubmit={submit}>
          <label className="field">What went wrong?<input value={f.title} maxLength={140} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Short title" /></label>
          <label className="field">Details<textarea value={f.details} maxLength={5000} rows={4} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="What happened, and what did you expect?" /></label>
          <label className="field">Steps to reproduce (optional)<textarea value={f.steps} maxLength={5000} rows={3} onChange={(e) => setF({ ...f, steps: e.target.value })} placeholder="1. Open... 2. Tap... 3. See..." /></label>
          <div className="row">
            <label className="field grow">How serious?<select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
              <option value="low">Low: looks wrong, small annoyance</option><option value="medium">Medium: something doesn't work</option>
              <option value="high">High: lose coins/items, or cheat</option><option value="critical">Critical: steal funds or private data</option></select></label>
            <label className="field grow">Where?<select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>
              <option value="game">Game</option><option value="website">Website</option><option value="wallet">Wallet / NFTs</option>
              <option value="token">$SLAB token</option><option value="other">Other</option></select></label>
          </div>
          <label className="field">How can we reach you? (optional)<input value={f.contact} maxLength={120} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="X handle or email" /></label>
          <label className="field">Wallet for a reward (optional)<input value={f.wallet} maxLength={44} spellCheck={false} onChange={(e) => setF({ ...f, wallet: e.target.value })} placeholder="Leave empty to use your linked wallet" /></label>
          <div className="row"><button className="btn" disabled={busy}>{busy ? "Sending..." : "Send report"}</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {mine.length > 0 && (
        <ul className="bug-list">
          {mine.map((m) => (
            <li key={m.id}><b>#{m.id} {m.title}</b><span className="tag">{STATUS[m.status] ?? m.status}</span>
              {m.reward_slab ? <span className="tag ok">{Number(m.reward_slab).toLocaleString()} $SLAB</span> : null}
              {m.payout_tx && <a href={`https://solscan.io/tx/${m.payout_tx}`} target="_blank" rel="noopener noreferrer">payout</a>}
              {m.reply && <p className="sub small">{m.reply}</p>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
