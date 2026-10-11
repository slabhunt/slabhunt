// Your data and privacy: download everything we hold, delete the account (7-day grace), and how to reach us.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Status = { deletion: { requested_at: string; due_at: string } | null; support_email: string | null };
type Req = { id: number; name: string; requested_at: string; due_at: string; status: string };

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export default function PrivacyCard({ username, isAdmin, toast }: { username: string; isAdmin: boolean; toast: (m: string) => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_account_status");
    if (data) setSt(data as Status);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function download() {
    setBusy(true);
    const { data, error } = await supabase.rpc("my_data_export");
    setBusy(false);
    if (error || !data) { toast("Couldn't prepare your data. Try again."); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `vault-hunt-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Your data file is downloading.");
  }

  async function requestDelete() {
    setBusy(true);
    const { data } = await supabase.rpc("request_account_deletion", { p_confirm: typed });
    setBusy(false);
    const res = data as (Status & { error?: string }) | null;
    if (!res || res.error) { toast(res?.error === "confirm" ? "Type your username exactly to confirm." : "Couldn't send the request."); return; }
    setSt(res); setConfirming(false); setTyped("");
    toast("Deletion scheduled. You can cancel any time in the next 7 days.");
  }

  async function cancelDelete() {
    const { data } = await supabase.rpc("cancel_account_deletion");
    if (data) { setSt(data as Status); toast("Deletion cancelled. Your account stays."); }
  }

  return (
    <div className="card stack privacy-card">
      <strong>Your data and privacy</strong>
      <p className="sub">Download a copy of everything Vault Hunt holds about you, or delete your account.
        {st?.support_email ? <> Questions or requests: <b className="select">{st.support_email}</b></> : " A support email is coming soon."}</p>
      <div className="row">
        <button className="btn ghost" onClick={download} disabled={busy}>Download my data</button>
        {!st?.deletion && !confirming && <button className="btn ghost danger" onClick={() => setConfirming(true)}>Delete my account</button>}
      </div>
      {st?.deletion && (
        <div className="notice warn">
          <p>Your account is scheduled for deletion on <b>{day(st.deletion.due_at)}</b>. Your username, wallet, location, chat messages and sign-in will be removed. Records the law requires us to keep (prize wins and token payments) stay without your name.</p>
          <button className="btn" onClick={cancelDelete}>Cancel deletion</button>
        </div>
      )}
      {confirming && !st?.deletion && (
        <div className="notice warn stack">
          <p>This can't be undone after 7 days. Coins, tickets, power-ups and progress are lost. NFTs and $VDRAKE stay in your own wallet.</p>
          <label className="field">Type your username (<b>{username}</b>) to confirm
            <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" spellCheck={false} />
          </label>
          <div className="row">
            <button className="btn danger" disabled={busy || typed.trim().toLowerCase() !== username.toLowerCase()} onClick={requestDelete}>Delete my account in 7 days</button>
            <button className="btn ghost" onClick={() => { setConfirming(false); setTyped(""); }}>Keep my account</button>
          </div>
        </div>
      )}
      {isAdmin && <PrivacyAdmin email={st?.support_email ?? ""} onSaved={load} toast={toast} />}
    </div>
  );
}

function PrivacyAdmin({ email, onSaved, toast }: { email: string; onSaved: () => void; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(email);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [working, setWorking] = useState(false);
  useEffect(() => { setVal(email); }, [email]);
  const loadReqs = useCallback(() => { supabase.rpc("admin_privacy_requests").then(({ data }) => setReqs((data as Req[]) ?? [])); }, []);
  useEffect(() => { if (open) loadReqs(); }, [open, loadReqs]);
  const dueNow = reqs.filter((r) => r.status === "pending" && new Date(r.due_at).getTime() <= Date.now()).length;

  async function processDue() {
    setWorking(true);
    const { data, error } = await supabase.functions.invoke("account", { body: { action: "process_due" } });
    setWorking(false);
    if (error) { toast("Couldn't process deletions. Try again."); return; }
    const res = data as { processed: number; failed: unknown[] };
    toast(`Deleted ${res.processed} account${res.processed === 1 ? "" : "s"}${res.failed.length ? `; ${res.failed.length} failed, try again` : ""}.`);
    loadReqs();
  }

  async function save() {
    const { error } = await supabase.rpc("admin_set_support_email", { p_email: val.trim() });
    if (error) { toast(error.message); return; }
    toast("Support email saved."); onSaved();
  }

  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Admin: support email and privacy requests</button>;
  return (
    <div className="stack">
      <div className="row">
        <label className="field grow">Support email (shown to players)<input id="support-email" type="email" value={val} onChange={(e) => setVal(e.target.value)} placeholder="support@yourdomain.com" /></label>
        <button className="btn" onClick={save}>Save</button>
      </div>
      <strong>Deletion requests (last 90 days)</strong>
      {reqs.length === 0 ? <span className="sub">None.</span> : (
        <div className="hist">{reqs.map((r) => <div key={r.id}><span>{r.name} · asked {day(r.requested_at)}</span><span className="tag">{r.status === "pending" ? `due ${day(r.due_at)}` : r.status}</span></div>)}</div>
      )}
      <button className="btn" disabled={working || dueNow === 0} onClick={processDue}>{working ? "Processing..." : `Process due requests (${dueNow})`}</button>
      <p className="sub small">Requests become due 7 days after the player asks. Processing removes their personal data and locks their login.</p>
      <button className="btn ghost small" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}
