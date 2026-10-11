// Admin: the early-access list. Set the pinned gameplay post, see totals and top cities, spot-check quote posts,
// and download everything as CSV.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  email: string; x_handle: string | null; wallet: string | null; quote_url: string | null; tasks: Record<string, boolean>;
  checked: "ok" | "bad" | null; city: string | null; kind: string | null; created_at: string; referrals: number;
};
type Data = { total: number; today: number; unchecked: number; post_url: string | null; cities: { city: string; n: number }[]; latest: Row[] };

function csv(rows: Row[]) {
  const cols = ["created_at", "x_handle", "wallet", "email", "quote_url", "checked", "referrals", "city", "kind", "like", "comment", "follow"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(c in r ? (r as Record<string, unknown>)[c] : r.tasks?.[c])).join(","))].join("\n");
}

export default function SignupAdmin({ toast }: { toast: (m: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [post, setPost] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_waitlist_v2", { p_limit: 1000 });
    if (error) return;
    setD(data as Data); setPost((data as Data).post_url ?? "");
  }, []);
  useEffect(() => { load(); }, [load]);

  async function savePost() {
    const { data, error } = await supabase.rpc("admin_set_signup_post", { p_url: post.trim() });
    if (error || (data as { error?: string })?.error) { toast("Paste a link like https://x.com/yourbrand/status/123..."); return; }
    toast(post.trim() ? "Pinned post saved. The signup page uses it now." : "Pinned post cleared."); load();
  }
  async function mark(x: string, result: "ok" | "bad") {
    await supabase.rpc("admin_waitlist_check", { p_x: x, p_result: result }); load();
  }
  function download() {
    if (!d) return;
    const url = URL.createObjectURL(new Blob([csv(d.latest)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `slabhunt-signups-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); URL.revokeObjectURL(url);
  }

  if (!d) return null;
  return (
    <details className="card">
      <summary><strong>Early-access list (admin)</strong> <span className="tag">{d.total} signed up · {d.today} today</span></summary>
      <label className="field">Pinned gameplay post on X
        <input value={post} onChange={(e) => setPost(e.target.value)} placeholder="https://x.com/slabhunt/status/..." spellCheck={false} />
      </label>
      <div className="row"><button className="btn small" onClick={savePost}>Save post</button><button className="btn ghost small" onClick={download}>Download CSV</button></div>
      {d.cities.length > 0 && <p className="sub">Top cities: {d.cities.map((c) => `${c.city} (${c.n})`).join(", ")}</p>}
      <p className="sub">{d.unchecked} not spot-checked yet. Open a quote post, then mark it.</p>
      <div className="su-admin-list">
        {d.latest.slice(0, 100).map((r) => (
          <div key={r.x_handle ?? r.email} className={"su-admin-row " + (r.checked ?? "")}>
            <span><b>@{r.x_handle}</b> · {r.referrals} ref · {new Date(r.created_at).toLocaleDateString()}</span>
            {r.quote_url && <a href={r.quote_url} target="_blank" rel="noopener noreferrer">quote</a>}
            {r.x_handle && <>
              <button className="btn ghost small" onClick={() => mark(r.x_handle!, "ok")} aria-label={`Mark @${r.x_handle} checked`}>✓</button>
              <button className="btn ghost small" onClick={() => mark(r.x_handle!, "bad")} aria-label={`Mark @${r.x_handle} failed`}>✗</button>
            </>}
          </div>
        ))}
      </div>
    </details>
  );
}
