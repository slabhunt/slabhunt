// /admin: review bug bounty reports. Set status and severity, record the $SLAB reward, reply to the reporter, and paste
// the multisig payout transaction once it's sent. Nothing here moves tokens.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Bug = { id: number; reporter: string | null; title: string; details: string; steps: string | null; claimed_severity: string; area: string;
  contact: string | null; payout_wallet: string | null; status: string; severity: string | null; reward_slab: number | null;
  payout_tx: string | null; reply: string | null; admin_note: string | null; created_at: string };
const STATUSES = ["new", "triaged", "accepted", "duplicate", "not_a_bug", "fixed", "paid"];

function Row({ b, onSaved }: { b: Bug; onSaved: () => void }) {
  const [s, setS] = useState({ status: b.status, severity: b.severity ?? b.claimed_severity, reward: b.reward_slab?.toString() ?? "", tx: b.payout_tx ?? "", reply: b.reply ?? "", note: b.admin_note ?? "" });
  const [msg, setMsg] = useState("");
  async function save() {
    const { data, error } = await supabase.rpc("admin_update_bug", { p_id: b.id, p_status: s.status, p_severity: s.severity,
      p_reward: s.reward ? Number(s.reward) : null, p_payout_tx: s.tx, p_reply: s.reply, p_note: s.note });
    const r = data as { ok?: boolean; error?: string } | null;
    setMsg(error || !r?.ok ? (r?.error === "tx" ? "That isn't a Solana transaction signature." : "Couldn't save.") : "Saved.");
    if (r?.ok) onSaved();
  }
  return (
    <details className="bug-row">
      <summary><b>#{b.id}</b> {b.title}<span className="tag">{b.status}</span><span className="tag">{b.claimed_severity} · {b.area}</span><span className="sub small">{b.reporter ?? "deleted player"} · {new Date(b.created_at).toLocaleString()}</span></summary>
      <div className="stack">
        <p className="pre">{b.details}</p>
        {b.steps && <><b>Steps</b><p className="pre">{b.steps}</p></>}
        <p className="sub small">Contact: {b.contact ?? "none"} · Payout wallet: <span className="select">{b.payout_wallet ?? "none"}</span></p>
        <div className="row">
          <label className="field grow">Status<select value={s.status} onChange={(e) => setS({ ...s, status: e.target.value })}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field grow">Severity<select value={s.severity} onChange={(e) => setS({ ...s, severity: e.target.value })}>{["low", "medium", "high", "critical"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field grow">Reward ($SLAB)<input inputMode="numeric" value={s.reward} onChange={(e) => setS({ ...s, reward: e.target.value.replace(/[^\d.]/g, "") })} /></label>
        </div>
        <label className="field">Payout transaction (after the multisig sends it)<input value={s.tx} spellCheck={false} onChange={(e) => setS({ ...s, tx: e.target.value.trim() })} /></label>
        <label className="field">Reply to the reporter (they see this)<textarea rows={2} value={s.reply} onChange={(e) => setS({ ...s, reply: e.target.value })} /></label>
        <label className="field">Private note<textarea rows={2} value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} /></label>
        <div className="row"><button className="btn small" onClick={save}>Save</button><span className="sub small">{msg}</span></div>
      </div>
    </details>
  );
}

export default function BugAdmin() {
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [filter, setFilter] = useState<string>("open");
  const load = useCallback(async () => { const { data } = await supabase.rpc("admin_bug_reports", { p_status: null }); setBugs((data as Bug[] | null) ?? []); }, []);
  useEffect(() => { load(); }, [load]);
  const shown = bugs.filter((b) => filter === "all" || (filter === "open" ? !["duplicate", "not_a_bug", "paid"].includes(b.status) : b.status === filter));
  const owed = bugs.filter((b) => b.reward_slab && !b.payout_tx).reduce((a, b) => a + Number(b.reward_slab), 0);
  return (
    <div className="card">
      <h2 className="sec">Bug bounty</h2>
      <p className="sub small">{bugs.filter((b) => b.status === "new").length} new · {owed.toLocaleString()} $SLAB in rewards not yet paid. Pay from the treasury multisig, then paste the transaction.</p>
      <div className="chips">{["open", "new", "accepted", "fixed", "paid", "all"].map((x) => <button key={x} className="chip" aria-selected={filter === x} onClick={() => setFilter(x)}>{x}</button>)}</div>
      {shown.length ? shown.map((b) => <Row key={b.id} b={b} onSaved={load} />) : <p className="sub small">No reports here.</p>}
    </div>
  );
}
