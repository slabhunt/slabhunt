import { useEffect, useState } from "react";
import { supabase, type Profile } from "../lib/supabase";
import { creatureImage, RARITY, SPECIES } from "../lib/species";
import { forgetName } from "../hooks/useNames";
import { findWallet, linkWallet, walletBrowseLinks } from "../lib/wallet";

const LINK_ERRORS: Record<string, string> = {
  taken: "That wallet is already linked to another player.",
  bad_signature: "The signature didn't check out. Try again.",
  expired: "That took too long. Try linking again.",
  no_key: "Your wallet didn't share an address. Try again.",
};

function WalletCard({ toast }: { toast: (m: string) => void }) {
  const [address, setAddress] = useState<string | null>(null);
  const [passes, setPasses] = useState<{ season_id: number; source: string; name?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [w, p, s] = await Promise.all([
      supabase.from("wallets").select("address").maybeSingle(),
      supabase.from("season_passes").select("season_id, source").order("season_id"),
      supabase.from("seasons").select("id, name"),
    ]);
    setAddress((w.data as { address?: string } | null)?.address ?? null);
    const names = new Map(((s.data ?? []) as { id: number; name: string }[]).map((x) => [x.id, x.name]));
    setPasses(((p.data ?? []) as { season_id: number; source: string }[]).map((x) => ({ ...x, name: names.get(x.season_id) })));
  };
  useEffect(() => { load(); }, []);

  async function link() {
    setBusy(true);
    try {
      const r = await linkWallet();
      if (r.error) toast(LINK_ERRORS[r.error] ?? "Couldn't link the wallet. Try again.");
      else { toast("Wallet linked."); load(); }
    } catch {
      toast("The wallet closed before signing. Nothing was sent.");
    } finally { setBusy(false); }
  }

  const hasWallet = !!findWallet();
  const links = walletBrowseLinks();
  return (
    <div className="card">
      <strong>Solana wallet</strong>
      {address
        ? <p className="sub">Linked: <span className="mono">{address}</span></p>
        : <p className="sub">Link a wallet to use your Season Pass NFT. You'll sign a message to prove it's yours. It doesn't move any funds.</p>}
      {hasWallet
        ? <div className="row"><button className="btn ghost" onClick={link} disabled={busy}>{busy ? "Waiting for your wallet..." : address ? "Link a different wallet" : "Link wallet"}</button></div>
        : <div className="row">
            <a className="btn ghost small" href={links.phantom}>Open in Phantom</a>
            <a className="btn ghost small" href={links.solflare}>Open in Solflare</a>
          </div>}
      {passes.length > 0 && (
        <>
          <strong>Season passes</strong>
          <div className="badges">{passes.map((p) => <span key={p.season_id} className="badge">{p.name ?? `Season ${p.season_id}`}{p.source === "nft" ? " · NFT" : ""}</span>)}</div>
        </>
      )}
    </div>
  );
}

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
    let w = wallet.trim();
    if (w && !SOLANA_ADDR.test(w)) {
      if (!/^[a-z0-9-_.]+(\.sol)?$/i.test(w)) { toast("Enter a Solana address or a .sol name."); return; }
      const { data, error } = await supabase.functions.invoke("wallet", { body: { action: "resolve", name: w } });
      const addr = (data as { address?: string } | null)?.address;
      if (error || !addr) { toast(`Couldn't find ${w.endsWith(".sol") ? w : w + ".sol"}. Check the spelling, or paste the wallet address.`); return; }
      toast(`${w.toLowerCase().endsWith(".sol") ? w : w + ".sol"} → ${addr.slice(0, 4)}…${addr.slice(-4)}`);
      w = addr;
      setWallet(addr);
    }
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
      <WalletCard toast={toast} />
      <div className="card">
        <strong>Profile</strong>
        <label className="field">Display name<input id="display-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Prize wallet (address or .sol name)<input id="wallet" value={wallet} maxLength={44} onChange={(e) => setWallet(e.target.value)} placeholder="Address or name.sol (only needed to claim a card)" spellCheck={false} autoComplete="off" /></label>
        <p className="sub">Your address is private. Only you and the game admins can see it.</p>
        <div className="row"><button className="btn" onClick={save}>Save</button><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </div>
    </>
  );
}
