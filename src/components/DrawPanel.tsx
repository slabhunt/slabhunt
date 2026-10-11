import { useEffect, useState } from "react";
import { supabase, type Round } from "../lib/supabase";
import { useNames } from "../hooks/useNames";

export type Stats = { round: number; mine: number; total: number; players: number };

export default function DrawPanel({ round, stats, isAdmin, onChanged, toast }: {
  round: Round | null;
  stats: Stats | null;
  isAdmin: boolean;
  onChanged: () => void;
  toast: (m: string) => void;
}) {
  const [history, setHistory] = useState<Round[]>([]);
  const [prizeName, setPrizeName] = useState("");
  const [grade, setGrade] = useState("");
  const [mint, setMint] = useState("");
  const [confirming, setConfirming] = useState(false);
  const name = useNames(history.map((h) => h.winner ?? "").filter(Boolean));

  useEffect(() => {
    supabase.from("rounds").select("*").eq("status", "drawn").order("id", { ascending: false }).limit(10)
      .then(({ data }) => setHistory((data as Round[]) ?? []));
  }, [round?.id]);

  useEffect(() => {
    if (round) { setPrizeName(round.prize_name); setGrade(round.prize_grade); setMint(round.prize_mint ?? ""); }
  }, [round?.id, round?.prize_name, round?.prize_grade, round?.prize_mint]);

  const mine = stats?.mine ?? 0, total = stats?.total ?? 0;
  const odds = total ? Math.round((mine / total) * 1000) / 10 : 0;

  async function savePrize() {
    const { error } = await supabase.rpc("set_prize", { p_name: prizeName.trim() || "Graded card", p_grade: grade.trim(), p_mint: mint.trim() });
    toast(error ? "Couldn't save the prize: " + error.message : "Prize saved.");
    onChanged();
  }
  async function runDraw() {
    setConfirming(false);
    const { data, error } = await supabase.rpc("run_draw");
    if (error) { toast("Draw failed: " + error.message); return; }
    const res = data as { round: number; total: number; pending: boolean; fair_id: number };
    toast(res.pending ? `Round ${res.round} entries are frozen (${res.total}). The winner is picked from public randomness in about a minute.` : `Round ${res.round} had no entries.`);
    onChanged();
  }

  return (
    <>
      <h2 className="sec">Round {round?.id ?? "–"} prize</h2>
      <div className="slab" aria-label="Graded card prize">
        <div className="slab-label"><span>{round?.prize_name ?? "Loading..."}</span><b>{round?.prize_grade}</b></div>
        <div className="slab-card"><span>Vaulted prize</span></div>
      </div>
      <p className="sub center">A real graded card held as a redeemable NFT. The winner can keep it, trade it or ship it home.</p>
      <div className="stats">
        <div className="stat"><b>{mine}</b><small>Your entries</small></div>
        <div className="stat"><b>{total}</b><small>All entries</small></div>
        <div className="stat"><b>{odds}%</b><small>Your odds</small></div>
      </div>
      <div className="card">
        <strong>How the draw works</strong>
        <ul className="rules">
          <li>Free to play. Entries come only from catches, never from buying or holding a token.</li>
          <li>Common creature = 1 entry, uncommon = 2, rare = 5, legendary = 10.</li>
          <li>One winner per round, picked by weighted draw. Entries reset each round.</li>
          <li>Provably fair: the entry list is locked on Solana first, then the winner comes from public drand randomness nobody can predict. <a href="/verify" target="_blank" rel="noopener">Check any draw</a>.</li>
          <li>To claim a prize, add your Solana address in your profile.</li>
        </ul>
      </div>
      {isAdmin && (
        <div className="card">
          <strong>Admin</strong>
          <label className="field">Prize name<input id="prize-name" value={prizeName} maxLength={60} onChange={(e) => setPrizeName(e.target.value)} /></label>
          <label className="field">Grade<input id="prize-grade" value={grade} maxLength={12} onChange={(e) => setGrade(e.target.value)} /></label>
          <label className="field">Card NFT mint address (optional)<input id="prize-mint" value={mint} maxLength={44} onChange={(e) => setMint(e.target.value)} spellCheck={false} /></label>
          <div className="row"><button className="btn ghost" onClick={savePrize}>Save prize</button></div>
          {!confirming
            ? <div className="row"><button className="btn" onClick={() => setConfirming(true)}>Run the draw</button></div>
            : <div className="row"><span className="sub">Lock this round's entries and open the next one? The winner is drawn about a minute later.</span><button className="btn danger" onClick={runDraw}>Yes, draw</button><button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button></div>}
        </div>
      )}
      <div className="card">
        <strong>Past winners</strong>
        {history.length === 0 && <span className="sub">No draws yet.</span>}
        <div className="hist">
          {history.map((h) => (
            <div key={h.id}>
              <strong>Round {h.id}: {h.winner ? name(h.winner) : h.fair_id && (h.total_entries ?? 0) > 0 ? "Drawing..." : "No entries"}</strong>
              <span>{h.prize_name} {h.prize_grade}{h.fair_id ? <> · <a href={`/verify?id=${h.fair_id}`} target="_blank" rel="noopener">Proof</a></> : null}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
