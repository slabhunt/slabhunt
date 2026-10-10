import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, type Drop, type Profile, type Round } from "./lib/supabase";
import { useSession } from "./hooks/useSession";
import { roughLocation, useLocation } from "./hooks/useLocation";
import { CATCH_RADIUS_M, distanceM } from "./lib/geo";
import { clockTrip, DEFAULT_START, tripPosition, type Trip, type TripClock } from "./lib/explorer";
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

function fmtWait(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function Game({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>("map");
  const [panel, setPanel] = useState<PanelTab>("chat");
  const [drops, setDrops] = useState<Map<string, Drop>>(new Map());
  const [round, setRound] = useState<Round | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [catchesVersion, setCatchesVersion] = useState(0);
  const [catching, setCatching] = useState<Drop | null>(null);
  const [follow, setFollow] = useState(true);
  const [trip, setTrip] = useState<TripClock | null>(null);
  const [placing, setPlacing] = useState(true);
  const [walkBonus, setWalkBonus] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number>();
  const pendingCatch = useRef<string | null>(null);
  const handledArrival = useRef<string>("");
  const lastLoad = useRef<{ lat: number; lng: number } | null>(null);
  const gps = useLocation(walkBonus);
  const dropsRef = useRef(drops);
  dropsRef.current = drops;

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
  const loadDrops = useCallback(async (lat: number, lng: number) => {
    const dLat = 0.012, dLng = 0.012 / Math.cos((lat * Math.PI) / 180);
    const { data } = await supabase.from("drops").select("id, species_id, lat, lng, expires_at, caught_by")
      .is("caught_by", null).gt("expires_at", new Date().toISOString())
      .gte("lat", lat - dLat).lte("lat", lat + dLat).gte("lng", lng - dLng).lte("lng", lng + dLng).limit(200);
    lastLoad.current = { lat, lng };
    setDrops(new Map((data as Drop[] ?? []).map((d) => [d.id, d])));
  }, []);

  /* ---------- realtime + first placement ---------- */
  useEffect(() => {
    loadProfile(); loadRound(); loadStats();
    const ch = supabase.channel("game")
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => { loadRound(); loadStats(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "drops" }, (p) => {
        const d = p.new as Drop;
        if (!d?.id) return;
        setDrops((m) => {
          const here = lastLoad.current;
          if (!m.has(d.id) && (!here || distanceM(here.lat, here.lng, d.lat, d.lng) > 2000)) return m;
          const n = new Map(m); n.set(d.id, d); return n;
        });
      })
      .subscribe();

    (async () => {
      const { data } = await supabase.rpc("my_explorer");
      let t = data as Trip | null;
      if (!t) {
        const here = (await roughLocation()) ?? DEFAULT_START;
        const res = await supabase.rpc("travel_to", { p_lat: here.lat, p_lng: here.lng });
        t = res.data as Trip | null;
      }
      if (t) setTrip(clockTrip(t));
      setPlacing(false);
    })();
    return () => { supabase.removeChannel(ch); };
  }, [loadProfile, loadRound, loadStats]);

  /* ---------- animation clock: fast while traveling, slow otherwise ---------- */
  const traveling = !!trip && now < trip.arriveMs;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), traveling ? 150 : 5000);
    return () => clearInterval(t);
  }, [traveling]);

  const pos = useMemo(() => (trip ? tripPosition(trip, now) : null), [trip, now]);

  /* ---------- on arrival: spawn creatures, load them, finish a queued catch ---------- */
  useEffect(() => {
    if (!trip || !pos?.arrived) return;
    const key = trip.arrive_at;
    if (handledArrival.current === key) return;
    handledArrival.current = key;
    (async () => {
      await supabase.rpc("spawn_here");
      await loadDrops(trip.to_lat, trip.to_lng);
      const want = pendingCatch.current;
      pendingCatch.current = null;
      if (want) {
        const d = dropsRef.current.get(want);
        if (d && !d.caught_by && distanceM(trip.to_lat, trip.to_lng, d.lat, d.lng) <= CATCH_RADIUS_M) setCatching(d);
        else toast("That creature has wandered off.");
      }
    })();
  }, [trip, pos?.arrived, loadDrops, toast]);

  /* ---------- travel ---------- */
  const travelTo = useCallback(async (lat: number, lng: number, catchId?: string) => {
    const { data, error } = await supabase.rpc("travel_to", { p_lat: lat, p_lng: lng });
    if (error || !data) { toast("Couldn't move there. Try again."); return; }
    pendingCatch.current = catchId ?? null;
    setFollow(true);
    setTrip(clockTrip(data as Trip));
  }, [toast]);

  function tapDrop(d: Drop) {
    if (!pos) return;
    const dist = distanceM(pos.lat, pos.lng, d.lat, d.lng);
    if (pos.arrived && dist <= CATCH_RADIUS_M) { setCatching(d); return; }
    // Stop just short of the creature, then open the catch when we arrive.
    travelTo(d.lat, d.lng, d.id);
  }

  async function doThrow(quality: number): Promise<CatchResult> {
    if (!catching) return { result: "error", message: "Nothing to catch." };
    const g = walkBonus ? gps.fix : null;
    const { data, error } = await supabase.rpc("catch_drop", {
      p_drop: catching.id, p_quality: quality,
      p_gps_lat: g?.lat ?? null, p_gps_lng: g?.lng ?? null, p_gps_accuracy: g?.accuracy ?? null,
    });
    if (error) return { result: "error", message: "Couldn't reach the game server. Try again." };
    const res = data as CatchResult;
    if (res.result === "caught" || res.result === "fled" || res.result === "gone") {
      const id = catching.id;
      setDrops((m) => { const n = new Map(m); n.delete(id); return n; });
    }
    if (res.result === "caught") { loadProfile(); loadStats(); setCatchesVersion((v) => v + 1); }
    return res;
  }

  /* ---------- derived ---------- */
  const live = useMemo(() => Array.from(drops.values()).filter((d) => !d.caught_by && new Date(d.expires_at).getTime() > now), [drops, now]);
  const nearest = useMemo(() => {
    if (!pos?.arrived) return null;
    let best: Drop | null = null, bd = Infinity;
    for (const d of live) { const dd = distanceM(pos.lat, pos.lng, d.lat, d.lng); if (dd < bd) { bd = dd; best = d; } }
    return best && bd <= CATCH_RADIUS_M ? best : null;
  }, [live, pos]);

  function openTab(t: Tab) { setTab(t); if (t !== "map") setPanel(t); }
  const showPanel: PanelTab = tab === "map" ? panel : tab;
  const nearRar = nearest ? RARITY[SPECIES[nearest.species_id]?.rar ?? "c"] : null;

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
          {pos ? (
            <MapView
              pos={pos}
              dest={trip ? { lat: trip.to_lat, lng: trip.to_lng } : null}
              arrived={pos.arrived}
              gps={walkBonus ? gps.fix : null}
              drops={live}
              follow={follow}
              onFollowChange={setFollow}
              onDropTap={tapDrop}
              onMapTap={(lat, lng) => travelTo(lat, lng)}
            />
          ) : (
            <div className="locating">
              <h2 className="sec">{placing ? "Placing your explorer..." : "Couldn't load the map"}</h2>
              <p className="sub">{placing ? "Starting you near where you are. You can travel anywhere from there." : "Check your connection and reload."}</p>
            </div>
          )}
          {pos && (
            <div className="hud">
              <div className="pill">Entries <b>{stats?.mine ?? 0}</b></div>
              <div className="pill">Catches <b>{profile?.catches ?? 0}</b></div>
              {traveling
                ? <div className="pill">Arriving in <b>{fmtWait(pos.secondsLeft)}</b></div>
                : <div className="pill">Nearby <b>{live.length}</b></div>}
              <button className={"pill" + (walkBonus ? " on" : "")} aria-pressed={walkBonus} onClick={() => setWalkBonus((v) => !v)}>
                Walking bonus <b>{walkBonus ? "on" : "off"}</b>
              </button>
              {!follow && <button className="pill" onClick={() => setFollow(true)}>Re-center</button>}
              {walkBonus && gps.fix && (
                <button className="pill" onClick={() => travelTo(gps.fix!.lat, gps.fix!.lng)}>Go to my location</button>
              )}
            </div>
          )}
          {walkBonus && gps.error && <div className="hint warn">{gps.error}</div>}
          {pos && !catching && !(walkBonus && gps.error) && (
            nearest && nearRar ? (
              <div className="near">
                <div><span className="nm">{SPECIES[nearest.species_id]?.name}</span>
                  <small>{nearRar.label} · worth {nearRar.entries} {nearRar.entries > 1 ? "entries" : "entry"}</small></div>
                <button className="btn" onClick={() => setCatching(nearest)}>Catch</button>
              </div>
            ) : traveling ? (
              <div className="hint">Traveling... creatures appear when your explorer arrives.</div>
            ) : (
              <div className="hint">Tap a creature to go catch it, or tap anywhere on the map to explore. Zoom out to travel the world.</div>
            )
          )}
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
