import { useEffect, useState } from "react";
import { supabase, type Profile } from "../lib/supabase";
import { creatureImage, RARITY, SPECIES, unlockedBy } from "../lib/species";
import { forgetName } from "../hooks/useNames";
import { findWallet, linkWallet, walletBrowseLinks } from "../lib/wallet";
import { SetPassword } from "./SignIn";
import { TermsText } from "./TermsGate";
import PrivacyCard from "./PrivacyCard";

const LINK_ERRORS: Record<string, string> = {
  taken: "That wallet is already linked to another player.",
  bad_signature: "The signature didn't check out. Try again.",
  expired: "That took too long. Try linking again.",
  no_key: "Your wallet didn't share an address. Try again.",
};

/** Turn "name.sol" (or a bare name) into the wallet address it points to. */
async function resolveIfName(input: string): Promise<{ address?: string; error?: string }> {
  const v = input.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return { address: v };
  if (!/^[a-z0-9-_.]+(\.sol)?$/i.test(v)) return { error: "Enter a Solana address or a .sol name." };
  const { data, error } = await supabase.functions.invoke("wallet", { body: { action: "resolve", name: v } });
  const addr = (data as { address?: string } | null)?.address;
  const label = v.toLowerCase().endsWith(".sol") ? v : v + ".sol";
  if (addr) return { address: addr };
  let code = "";
  try { code = (await (error as { context?: Response } | null)?.context?.json())?.error ?? ""; } catch { /* ignore */ }
  return { error: code === "lookup_failed"
    ? "Name lookup isn't responding right now. Paste the wallet address instead, or try again in a minute."
    : `${label} isn't registered. Check the spelling, or paste the address.` };
}

function WalletCard({ toast }: { toast: (m: string) => void }) {
  const [address, setAddress] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [input, setInput] = useState("");
  const [passes, setPasses] = useState<{ season_id: number; source: string; name?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [w, p, s] = await Promise.all([
      supabase.from("wallets").select("address, verified").maybeSingle(),
      supabase.from("season_passes").select("season_id, source").order("season_id"),
      supabase.from("seasons").select("id, name"),
    ]);
    const row = w.data as { address?: string; verified?: boolean } | null;
    setAddress(row?.address ?? null);
    setVerified(!!row?.verified);
    const names = new Map(((s.data ?? []) as { id: number; name: string }[]).map((x) => [x.id, x.name]));
    setPasses(((p.data ?? []) as { season_id: number; source: string }[]).map((x) => ({ ...x, name: names.get(x.season_id) })));
  };
  useEffect(() => { load(); }, []);

  async function saveAddress() {
    if (!input.trim()) return;
    setBusy(true);
    try {
      const r = await resolveIfName(input);
      if (!r.address) { toast(r.error ?? "Couldn't save that wallet."); return; }
      const { data } = await supabase.rpc("link_wallet_address", { p_address: r.address });
      const res = data as { linked?: string; error?: string } | null;
      if (!res || res.error) {
        toast(res?.error === "taken" ? "That wallet is already linked to another player. If it's yours, use 'Prove it's mine' from your wallet app." : "Couldn't save that wallet.");
        return;
      }
      toast(`Wallet saved: ${r.address.slice(0, 4)}…${r.address.slice(-4)}`);
      setInput(""); load();
    } finally { setBusy(false); }
  }

  async function prove() {
    setBusy(true);
    try {
      const r = await linkWallet();
      if (r.error) toast(LINK_ERRORS[r.error] ?? "Couldn't verify the wallet. Try again.");
      else { toast("Wallet verified."); load(); }
    } catch {
      toast("The wallet closed before signing. Nothing was sent.");
    } finally { setBusy(false); }
  }

  const inWalletApp = !!findWallet();
  const links = walletBrowseLinks();
  return (
    <div className="card">
      <strong>Solana wallet</strong>
      {address
        ? <p className="sub">Linked: <span className="mono">{address}</span>{verified ? " · verified" : ""}</p>
        : <p className="sub">Add your wallet so the game can check it for Season Pass NFTs and perks,. Read-only: nothing is sent or signed.</p>}
      <div className="row">
        <input id="wallet-link" className="inp" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Address or name.sol" spellCheck={false} autoComplete="off" />
        <button className="btn ghost" onClick={saveAddress} disabled={busy || !input.trim()}>{busy ? "Saving..." : address ? "Change" : "Save"}</button>
      </div>
      {address && !verified && (
        inWalletApp
          ? <button className="btn ghost small" onClick={prove} disabled={busy}>Prove it's mine (optional)</button>
          : <p className="sub">Optional: open the game in <a href={links.phantom}>Phantom</a> or <a href={links.solflare}>Solflare</a> to prove the wallet is yours, so nobody else can claim it.</p>
      )}
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
  const [pwOpen, setPwOpen] = useState(false);
  const [wallet, setWallet] = useState("");
  const [dex, setDex] = useState<Record<number, number>>({});
  const [seasonNo, setSeasonNo] = useState(1);
  useEffect(() => { supabase.rpc("season_info").then(({ data }) => { const id = (data as { id?: number } | null)?.id; if (id) setSeasonNo(id); }); }, []);

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
  const unlocked = unlockedBy(seasonNo);

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
    if (error) {
      toast(/name_taken/.test(error.message) ? `"${name.trim()}" is taken. Try another username.`
        : /name_invalid/.test(error.message) ? "Usernames are 3-24 letters, numbers, dots, dashes or underscores."
        : "Couldn't save: " + error.message);
      return;
    }
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
        <div className="stat"><b>{species}/{unlocked.length}</b><small>Species</small></div>
      </div>
      <h2 className="sec">Creature log</h2>
      <div className="dex">
        {unlocked.map((i) => SPECIES[i]).map((s) => { const i = SPECIES.indexOf(s); return (
          <div key={s.name}>
            <img src={creatureImage(i, 48, !dex[i])} alt={dex[i] ? s.name : "Not caught yet"} />
            <b>{dex[i] ? s.name : "???"}</b>
            <span>{dex[i] ? `Caught ×${dex[i]}` : RARITY[s.rar].label}</span>
          </div>
        ); })}
      </div>
      {unlocked.length < SPECIES.length && <p className="sub">{SPECIES.length - unlocked.length} more creatures unlock in future seasons ({SPECIES.length} total).</p>}
      <WalletCard toast={toast} />
      <div className="card">
        <strong>Profile</strong>
        <label className="field">Username (also signs you in)<input id="display-name" value={name} maxLength={24} autoCapitalize="none" spellCheck={false} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Prize wallet (address or .sol name)<input id="wallet" value={wallet} maxLength={44} onChange={(e) => setWallet(e.target.value)} placeholder="Address or name.sol (only needed to claim a card)" spellCheck={false} autoComplete="off" /></label>
        <p className="sub">Your address is private. Only you and the game admins can see it.</p>
        <div className="row"><button className="btn" onClick={save}>Save</button><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </div>
      <a className="btn ghost" href="/guide" target="_blank" rel="noopener">How to play: full guide</a>
      <PrivacyCard username={profile.display_name} isAdmin={!!profile.is_admin} toast={toast} />
      <details className="card terms-view">
        <summary><strong>Terms, Official Rules and Privacy Policy</strong></summary>
        <TermsText />
      </details>
      <div className="card">
        {pwOpen
          ? <SetPassword title="Set or change your password" onDone={() => setPwOpen(false)} />
          : <><strong>Password</strong>
            <p className="sub">Set a password to sign in with your email and password instead of waiting for an email link.</p>
            <div className="row"><button className="btn ghost" onClick={() => setPwOpen(true)}>Set password</button></div></>}
      </div>
    </>
  );
}
