import { useEffect, useState } from "react";
import { supabase, type PublicProfile } from "../lib/supabase";

export default function RanksPanel({ userId, visible }: { userId: string; visible: boolean }) {
  const [rows, setRows] = useState<PublicProfile[] | null>(null);
  useEffect(() => {
    if (!visible) return;
    const load = () => supabase.from("public_profiles").select("id, display_name, xp, catches")
      .order("xp", { ascending: false }).limit(25).then(({ data }) => setRows((data as PublicProfile[]) ?? []));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [visible]);

  return (
    <>
      <h2 className="sec">Top hunters</h2>
      {rows === null && <div className="empty">Loading rankings...</div>}
      {rows?.length === 0 && <div className="empty">No hunters yet. Catch a creature to get on the board.</div>}
      {rows && rows.length > 0 && (
        <table className="ranks">
          <thead><tr><th>#</th><th>Hunter</th><th className="n">Catches</th><th className="n">XP</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={r.id === userId ? "me" : ""}>
                <td>{i + 1}</td><td>{r.display_name}{r.id === userId ? " (you)" : ""}</td>
                <td className="n">{r.catches}</td><td className="n">{r.xp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
