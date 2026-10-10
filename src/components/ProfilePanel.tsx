import { useEffect, useState } from "react";
import { supabase, type Profile } from "../lib/supabase";
import { creatureImage, RARITY, SPECIES } from "../lib/species";
import { forgetName } from "../hooks/useNames";

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default function ProfilePanel({ profile, catchesVersion, onSaved, toast }: {
  profile: Profile | null;
  catchesVersion: number;
  onSaved: () => void;
  toast: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [dex, setDex] = useState<Record<number, number>>({});

  useEffect(() => { if (profile) { setName(profile.display_name); setWallet(profile.wallet ?? ""); } }, [profile?.id, profile?.display_name, profile?.wallet]);

  useEffect(() => {
    if (!profile) return;
    supabase.from("catches").select("species_id").eq("user_id", profile.id).then(({ data }) => {
      const counts: Record<number, number> = {};
      for (const c of data ?? []) counts[c.species_id] = (counts[c.species_id] ?? 0) + 1;
      setDex(counts);
    });
  }, [profile?.id, catchesVersion]);

  if (!profile) return <div className="empty">Loading your profile...</div>;
  const level = 1 + Math.floor(profile.xp / 100), into = profile.xp % 100;
  const species = Object.keys(dex).length;

  async function save() {
    const w = wallet.trim();
    if (w && !SOLANA_ADDR.test(w)) { toast("That doesn't look like a Solana address (32–44 letters and numbers)."); return; }
    if (!name.trim()) { toast("Add a name other hunters will see."); return; }
    const { error } = await supabase.rpc("update_profile", { p_name: name.trim(), p_wallet: w });
    if (error) { toast("Couldn't save: " + error.message); return; }
    forgetName(profile!.id);
    toast("Profile saved.");
    onSaved();
  }

  return (
    <>
      <div className="prof">
        <img src={creatureImage(3, 56)} alt="" width={56} height={56} />
        <div><h3>{profile.display_name}</h3><p className="sub">Level {level} hunter · {100 - into} XP to next level</p></div>
      </div>
      <div className="lvl" aria-hidden="true"><i style={{ width: into + "%" }} /></div>
      <div className="stats">
        <div className="stat"><b>{profile.xp}</b><small>XP</small></div>
        <div className="stat"><b>{profile.catches}</b><small>Catches</small></div>
        <div className="stat"><b>{species}/{SPECIES.length}</b><small>Species</small></div>
      </div>
      <h2 className="sec">Creature log</h2>
      <div className="dex">
        {SPECIES.map((s, i) => (
          <div key={s.name}>
            <img src={creatureImage(i, 48, !dex[i])} alt={dex[i] ? s.name : "Not caught yet"} />
            <b>{dex[i] ? s.name : "???"}</b>
            <span>{dex[i] ? `Caught ×${dex[i]}` : RARITY[s.rar].label}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <strong>Profile</strong>
        <label className="field">Display name<input id="display-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Solana address for prizes<input id="wallet" value={wallet} maxLength={44} onChange={(e) => setWallet(e.target.value)} placeholder="Only needed to claim a card" spellCheck={false} autoComplete="off" /></label>
        <p className="sub">Your address is private. Only you and the game admins can see it.</p>
        <div className="row"><button className="btn" onClick={save}>Save</button><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </div>
    </>
  );
}
