import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALLOW_SIM, supabase, type Drop, type Profile, type Round } from "./lib/supabase";
import { useSession } from "./hooks/useSession";
import { useLocation } from "./hooks/useLocation";
import { CATCH_RADIUS_M, distanceM } from "./lib/geo";
import { RARITY, SPECIES } from "./lib/species";
import SignIn from "./components/SignIn";
import MapView from "./components/MapView";
import CatchModal, { type CatchResult } from "./components/CatchModal";
import ChatPanel from "./components/ChatPanel";
import DrawPanel, { type Stats } from "./components/DrawPanel";
import RanksPanel from "./components/RanksPanel";
import ProfilePanel from "./components/ProfilePanel";

type Tab = "map" | "chat" | "draw" | "ranks" | "profile";
type PanelTab = Exclude<Tab, "map">;

export default function App() {
  const { session, ready } = useSession();
  if (!ready) return <div className="splash">Loading...</div>;
  if (!session) return <SignIn />;
  return <Game userId={session.user.id} />;
}

function Game({ userId }: { userId: string }) {
  const loc = useLocation();
  const fix = loc.fix;
  const [tab, setTab] = useState<Tab>("map");
  const [panel, setPanel] = useState<PanelTab>("chat");
  const [drops, setDrops] = useState<Map<string, Drop>>(new Map());
  const [round, setRound] = useState<Round | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [catchesVersion, setCatchesVersion] = useState(0);
  const [catching, setCatching] = useState<Drop | null>(null);
  const [follow, setFollow] = useState(true);
  const [toastMsg, setToastMsg] = useState("");
  const [, tick] = useState(0);
  const toastTimer = useRef<number>();

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 3000);
  }, []);

  /* ---------- loaders ---------- */
  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, display_name, xp, catches, wallet, is_admin").eq("id", userId).maybeSingle();
    if (data) setProfile(data as Profile);
  }, [userId]);
  const loadRound = useCallback(async () => {
    const { data } = await supabase.from("rounds").select("*").eq("status", "open").maybeSingle();
    if (data) setRound(data as Round);
  }, []);
  const loadStats = useCallback(async () => {
    const { data } = await supabase.rpc("round_stats");
    if (data) setStats(data as Stats);
  }, []);

  useEffect(() => {
    loadProfile(); loadRound(); loadStats();
    const ch = supabase.channel("game")
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => { loadRound(); loadStats(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "drops" }, (p) => {
        const d = p.new as Drop;
        if (!d?.id) return;
        setDrops((m) => {
          const here = lastLoad.current;
          if (!m.has(d.id) && here && distanceM(here.lat, here.lng, d.lat, d.lng) > 2000) return m;
          const n = new Map(m); n.set(d.id, d); return n;
        });
      })
      .subscribe();
    const t = setInterval(() => tick((n) => n + 1), 15000); // re-check expiries
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [loadProfile, loadRound, loadStats]);

  /* ---------- position: report, spawn, load nearby ---------- */
  const lastReport = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastSpawn = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastLoad = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const [locWarning, setLocWarning] = useState("");

  const loadDrops = useCallback(async (lat: number, lng: number) => {
    const dLat = 0.012, dLng = 0.012 / Math.cos((lat * Math.PI) / 180);
    const { data } = await supabase.from("drops").select("id, species_id, lat, lng, expires_at, caught_by")
      .is("caught_by", null).gt("expires_at", new Date().toISOString())
      .gte("lat", lat - dLat).lte("lat", lat + dLat).gte("lng", lng - dLng).lte("lng", lng + dLng).limit(200);
    lastLoad.current = { lat, lng, at: Date.now() };
    setDrops(new Map((data as Drop[] ?? []).map((d) => [d.id, d])));
  }, []);

  useEffect(() => {
    if (!fix) return;
    const now = Date.now();
    const moved = (r: { lat: number; lng: number } | null) => (r ? distanceM(r.lat, r.lng, fix.lat, fix.lng) : Infinity);
    (async () => {
      if (!lastReport.current || moved(lastReport.current) > 20 || now - lastReport.current.at > 15000) {
        lastReport.current = { lat: fix.lat, lng: fix.lng, at: now };
        const { data: ok } = await supabase.rpc("report_position", { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy });
        setLocWarning(ok === false ? (fix.accuracy > 50 ? "GPS is fuzzy right now. Catches unlock when it settles." : "Your location jumped too fast. Keep walking and it will catch up.") : "");
        if (ok && (!lastSpawn.current || now - lastSpawn.current.at > 25000 || moved(lastSpawn.current) > 150)) {
          lastSpawn.current = { lat: fix.lat, lng: fix.lng, at: now };
          await supabase.rpc("spawn_nearby", { p_lat: fix.lat, p_lng: fix.lng });
          await loadDrops(fix.lat, fix.lng);
          return;
        }
      }
      if (!lastLoad.current || moved(lastLoad.current) > 300) await loadDrops(fix.lat, fix.lng);
    })();
  }, [fix?.lat, fix?.lng, fix?.accuracy, loadDrops]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- catching ---------- */
  const live = useMemo(() => Array.from(drops.values()).filter((d) => !d.caught_by && new Date(d.expires_at).getTime() > Date.now()), [drops, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const nearest = useMemo(() => {
    if (!fix) return null;
    let best: Drop | null = null, bd = Infinity;
    for (const d of live) { const dd = distanceM(fix.lat, fix.lng, d.lat, d.lng); if (dd < bd) { bd = dd; best = d; } }
    return best && bd <= CATCH_RADIUS_M ? best : null;
  }, [live, fix]);

  function tapDrop(d: Drop) {
    if (!fix) return;
    const dist = distanceM(fix.lat, fix.lng, d.lat, d.lng);
    if (dist > CATCH_RADIUS_M) toast(`${SPECIES[d.species_id]?.name ?? "It"} is ${Math.round(dist)} m away. Walk closer to catch it.`);
    else setCatching(d);
  }

  async function doThrow(quality: number): Promise<CatchResult> {
    if (!fix || !catching) return { result: "error", message: "No location fix." };
    const { data, error } = await supabase.rpc("attempt_catch", {
      p_drop: catching.id, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_quality: quality,
    });
    if (error) return { result: "error", message: "Couldn't reach the game server. Try again." };
    const res = data as CatchResult;
    if (res.result === "caught" || res.result === "fled" || res.result === "gone") {
      setDrops((m) => { const n = new Map(m); n.delete(catching.id); return n; });
    }
    if (res.result === "caught") { loadProfile(); loadStats(); setCatchesVersion((v) => v + 1); }
    return res;
  }

  /* ---------- tabs ---------- */
  function openTab(t: Tab) { setTab(t); if (t !== "map") setPanel(t); }
  const showPanel: PanelTab = tab === "map" ? panel : tab;

  return (
    <div className="app" data-tab={tab}>
      <header>
        <div className="logo">Vault <span>Hunt</span></div>
        <button className="prize-chip" onClick={() => { setPanel("draw"); if (!matchMedia("(min-width:960px)").matches) setTab("draw"); }}>
          <b>Round {round?.id ?? "–"}</b><span className="t">{round ? `${round.prize_name} ${round.prize_grade}` : ""}</span>
        </button>
      </header>

      <main>
        <section className="stage" aria-label="Map">
          {fix ? (
            <MapView fix={fix} drops={live} follow={follow} onFollowChange={setFollow} onDropTap={tapDrop}
              onMapTap={ALLOW_SIM ? (lat, lng) => loc.simulate(lat, lng) : undefined} />
          ) : (
            <div className="locating">
              <h2 className="sec">{loc.status === "denied" ? "Location needed" : "Finding you..."}</h2>
              <p className="sub">{loc.error ?? "Allow location access when your browser asks. Vault Hunt uses it to show creatures near you."}</p>
              {ALLOW_SIM && <button className="btn ghost" onClick={() => loc.simulate(40.7812, -73.9665)}>Start at a test location</button>}
            </div>
          )}
          {fix && (
            <div className="hud">
              <div className="pill">Entries <b>{stats?.mine ?? 0}</b></div>
              <div className="pill">Catches <b>{profile?.catches ?? 0}</b></div>
              <div className="pill">Nearby <b>{live.length}</b></div>
              {!follow && <button className="pill" onClick={() => setFollow(true)}>Re-center</button>}
              {fix.simulated && <div className="pill warn">Test location</div>}
            </div>
          )}
          {fix && locWarning && <div className="hint warn">{locWarning}</div>}
          {fix && !locWarning && nearest && !catching && (
            <div className="near">
              <div><span className="nm">{SPECIES[nearest.species_id]?.name}</span>
                <small>{RARITY[SPECIES[nearest.species_id]?.rar ?? "c"].label} · worth {RARITY[SPECIES[nearest.species_id]?.rar ?? "c"].entries} {RARITY[SPECIES[nearest.species_id]?.rar ?? "c"].entries > 1 ? "entries" : "entry"}</small></div>
              <button className="btn" onClick={() => setCatching(nearest)}>Catch</button>
            </div>
          )}
          {fix && !locWarning && !nearest && live.length > 0 && <div className="hint">Walk toward a creature. Catch it when you're inside the gold circle.</div>}
          {catching && <CatchModal drop={catching} onClose={() => setCatching(null)} onThrow={doThrow} />}
        </section>

        <aside className="panel">
          <div className="panel-tabs" role="tablist">
            {(["chat", "draw", "ranks", "profile"] as PanelTab[]).map((p) => (
              <button key={p} role="tab" aria-selected={showPanel === p} onClick={() => setPanel(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
            ))}
          </div>
          <div className={"view" + (showPanel === "chat" ? " on" : "")}><ChatPanel userId={userId} visible={showPanel === "chat"} /></div>
          <div className={"view" + (showPanel === "draw" ? " on" : "")}>
            <DrawPanel round={round} stats={stats} isAdmin={!!profile?.is_admin} onChanged={() => { loadRound(); loadStats(); }} toast={toast} />
          </div>
          <div className={"view" + (showPanel === "ranks" ? " on" : "")}><RanksPanel userId={userId} visible={showPanel === "ranks"} /></div>
          <div className={"view" + (showPanel === "profile" ? " on" : "")}>
            <ProfilePanel profile={profile} catchesVersion={catchesVersion} onSaved={loadProfile} toast={toast} />
          </div>
        </aside>
      </main>

      <nav className="tabs" aria-label="Sections">
        {([["map", "Map"], ["chat", "Chat"], ["draw", "Draw"], ["ranks", "Ranks"], ["profile", "Profile"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} aria-selected={tab === t} onClick={() => openTab(t)}>{label}</button>
        ))}
      </nav>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
