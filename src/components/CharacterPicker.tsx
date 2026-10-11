// Profile card: pick your pixel character. It runs around the map in retro mode. The first six are free; a future
// character mint will add more.
import { useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabase";
import { CHARACTERS, hunterSheet } from "../lib/hunterSprite";

export default function CharacterPicker({ current, onSaved, toast }: { current: number; onSaved: () => void; toast: (m: string) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  async function pick(id: number) {
    if (id === current || busy != null) return;
    setBusy(id);
    const { data, error } = await supabase.rpc("set_avatar", { p_avatar: id });
    setBusy(null);
    if (error || (data as { error?: string } | null)?.error) { toast("Couldn't change your character. Try again."); return; }
    toast(`You're now playing as ${CHARACTERS.find((c) => c.id === id)?.name}. Turn on 👾 Retro to see them on the map.`);
    onSaved();
  }
  return (
    <div className="card chars">
      <h2 className="sec">Your character</h2>
      <p className="sub">Your hunter on the map in 👾 Retro mode. Switch anytime.</p>
      <div className="char-grid" role="radiogroup" aria-label="Choose your character">
        {CHARACTERS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={c.id === current} className={"char" + (c.id === current ? " on" : "")}
            onClick={() => pick(c.id)} disabled={busy != null} title={c.blurb}>
            <span className="hunter walking" style={{ "--hs": 3 } as CSSProperties}>
              <span className="hunter-sprite" style={{ backgroundImage: `url(${hunterSheet(c.id)})` }} />
            </span>
            <b>{c.name}</b>
          </button>
        ))}
      </div>
      <p className="sub small">More characters are coming as a collectible mint.</p>
    </div>
  );
}
