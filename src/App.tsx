import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, timeLeft, tripCost, type Drop, type Profile, type Round, type Season, type Status } from "./lib/supabase";
import { useSession } from "./hooks/useSession";
import { roughLocation, useLocation } from "./hooks/useLocation";
import { CATCH_RADIUS_M, distanceM } from "./lib/geo";
import { clockTrip, DEFAULT_START, tripPosition, type Trip, type TripClock } from "./lib/explorer";
import { RARITY, SPECIES } from "./lib/species";
import SignIn, { SetPassword } from "./components/SignIn";
import TermsGate from "./components/TermsGate";
import { TERMS_VERSION } from "./lib/terms";
import MapView from "./components/MapView";
import HuntCam from "./components/HuntCam";
import { askMotion, useCompass } from "./lib/compass";
import CatchModal, { type CatchResult } from "./components/CatchModal";
import ChatPanel from "./components/ChatPanel";
import DrawPanel, { type Stats } from "./components/DrawPanel";
import RanksPanel from "./components/RanksPanel";
import ProfilePanel from "./components/ProfilePanel";
import GachaPanel from "./components/GachaPanel";
import MintPanel from "./components/MintPanel";
import Tutorial, { tutorialSeen } from "./components/Tutorial";
import { RetroFilterDefs, useRetro } from "./lib/retro";
import { captureRef, claimStoredRef } from "./lib/referral";

captureRef();

// The 3D map pulls in MapLibre (large), so it loads only when a player turns 3D on.
const Map3D = lazy(() => import("./components/Map3D"));

type Tab = "map" | "gacha" | "mint" | "chat" | "draw" | "profile";
type PanelTab = Exclude<Tab, "map">;
const PANEL_TABS: PanelTab[] = ["gacha", "mint", "chat", "draw", "profile"];
const LABEL: Record<Tab, string> = { map: "Map", gacha: "Gacha", mint: "Mint", chat: "Chat", draw: "Draw", profile: "Profile" };

export default function App() {
  const { session, ready, recovery, endRecovery } = useSession();
  // Every player signs the current Terms of Use and Official Rules before playing.
  const [terms, setTerms] = useState<"loading" | "ok" | "needed" | "updated">("loading");
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) { setTerms("loading"); return; }
    supabase.rpc("my_terms").then(({ data, error }) => {
      const list = (data as { version: string }[] | null) ?? [];
      setTerms(error ? "needed" : list.some((t) => t.version === TERMS_VERSION) ? "ok" : list.length ? "updated" : "needed");
    });
  }, [uid]);
  // Credit whoever invited this player (?ref=username), once they have an account and accepted the terms.
  useEffect(() => { if (uid && terms === "ok") claimStoredRef(); }, [uid, terms]);
  if (!ready) return <div className="splash">Loading...</div>;
  if (!session) return <SignIn />;
  if (recovery) return <div className="signin"><div className="signin-card"><SetPassword title="Set a new password" onDone={endRecovery} /></div></div>;
  if (terms === "loading") return <div className="splash">Loading...</div>;
  if (terms !== "ok") return <TermsGate updated={terms === "updated"} onAccepted={() => setTerms("ok")} />;
  return <Game userId={session.user.id} />;
}

function fmtWait(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

type PendingTrip = { lat: number; lng: number; cost: number; dist: number; catchId?: string };

function Game({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>("map");
  const [showTut, setShowTut] = useState(() => !tutorialSeen());
  const [panel, setPanel] = useState<PanelTab>("gacha");
  const [drops, setDrops] = useState<Map<string, Drop>>(new Map());
  const [round, setRound] = useState<Round | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [catchesVersion, setCatchesVersion] = useState(0);
  const [catching, setCatching] = useState<Drop | null>(null);
  const [follow, setFollow] = useState(true);
  const [trip, setTrip] = useState<TripClock | null>(null);
  const [placing, setPlacing] = useState(true);
  const [walkBonus, setWalkBonus] = useState(false);
  const [confirmTrip, setConfirmTrip] = useState<PendingTrip | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number>();
  const pendingCatch = useRef<string | null>(null);
  const handledArrival = useRef<string>("");
  const [upsell, setUpsell] = useState(false);
  const [retro, setRetro] = useRetro();
  const [threeD, setThreeD] = useState(() => { try { return localStorage.getItem("vh.3d") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("vh.3d", threeD ? "1" : "0"); } catch { /* private mode */ } }, [threeD]);
  const [hunting, setHunting] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => { try { return localStorage.getItem("vh.hintSeen") === "1"; } catch { return false; } });
  const dismissHint = () => { setHintSeen(true); try { localStorage.setItem("vh.hintSeen", "1"); } catch { /* private mode */ } };
  // Free players hunt by walking: their explorer follows their real GPS position.
  const isWalker = !!status && !status.has_pass;
  const gps = useLocation(walkBonus || isWalker);
  const lastSync = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const compass = useCompass((threeD && follow) || hunting);
  const dropsRef = useRef(drops);
  dropsRef.current = drops;

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 3200);
  }, []);

  /* ---------- loaders ---------- */
  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, display_name, xp, catches, wallet, is_admin, avatar").eq("id", userId).maybeSingle();
    if (data) setProfile(data as Profile);
  }, [userId]);
  const loadStatus = useCallback(async () => {
    const { data } = await supabase.rpc("my_status");
    if (data) setStatus(data as Status);
  }, []);
  const loadSeason = useCallback(async () => {
    const { data } = await supabase.rpc("season_info");
    setSeason((data as Season | null) ?? null);
  }, []);
  const loadRound = useCallback(async () => {
    const { data } = await supabase.from("rounds").select("*").eq("status", "open").maybeSingle();
    if (data) setRound(data as Round);
  }, []);
  const loadStats = useCallback(async () => {
    const { data } = await supabase.rpc("round_stats");
    if (data) setStats(data as Stats);
  }, []);
  // Fog of war: the server only returns creatures inside your sight range.
  const loadDrops = useCallback(async () => {
    const { data } = await supabase.rpc("visible_drops");
    setDrops(new Map((data as Drop[] ?? []).map((d) => [d.id, d])));
  }, []);

  /* ---------- realtime + first placement ---------- */
  useEffect(() => {
    loadProfile(); loadRound(); loadStats(); loadStatus(); loadSeason();
    const ch = supabase.channel("game")
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => { loadRound(); loadStats(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "pots" }, () => { loadStatus(); })
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
  }, [loadProfile, loadRound, loadStats, loadStatus, loadSeason]);

  /* ---------- clock: fast while traveling ---------- */
  const traveling = !!trip && now < trip.arriveMs;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), traveling ? 150 : 5000);
    return () => clearInterval(t);
  }, [traveling]);
  const pos = useMemo(() => (trip ? tripPosition(trip, now) : null), [trip, now]);

  // Refresh what's in sight every few seconds while standing still (other hunters catch things too).
  useEffect(() => {
    if (!pos?.arrived) return;
    const t = setInterval(loadDrops, 10000);
    return () => clearInterval(t);
  }, [pos?.arrived, loadDrops]);

  /* ---------- on arrival ---------- */
  useEffect(() => {
    if (!trip || !pos?.arrived) return;
    const key = trip.arrive_at;
    if (handledArrival.current === key) return;
    handledArrival.current = key;
    (async () => {
      await supabase.rpc("spawn_here");
      await loadDrops();
      const want = pendingCatch.current;
      pendingCatch.current = null;
      if (want) {
        const d = dropsRef.current.get(want);
        if (d && !d.caught_by && distanceM(trip.to_lat, trip.to_lng, d.lat, d.lng) <= CATCH_RADIUS_M) setCatching(d);
        else toast("That creature has wandered off.");
      }
    })();
  }, [trip, pos?.arrived, loadDrops, toast]);

  /* ---------- walking mode: follow real GPS ---------- */
  useEffect(() => {
    if (!isWalker || !gps.fix) return;
    const f = gps.fix, last = lastSync.current;
    if (last && distanceM(last.lat, last.lng, f.lat, f.lng) < 8 && Date.now() - last.at < 15000) return;
    lastSync.current = { lat: f.lat, lng: f.lng, at: Date.now() };
    (async () => {
      const { data } = await supabase.rpc("sync_walker", { p_lat: f.lat, p_lng: f.lng, p_accuracy: f.accuracy });
      const res = data as (Trip & { error?: string }) | null;
      if (!res) return;
      if (res.error === "gps") { toast(f.accuracy > 50 ? "GPS is fuzzy right now. Step outside for a better signal." : "Your location jumped. Keep walking and it will catch up."); return; }
      setFollow(true);
      setTrip(clockTrip(res));
    })();
  }, [isWalker, gps.fix, toast]);

  /* ---------- travel ---------- */
  const doTravel = useCallback(async (p: PendingTrip) => {
    setConfirmTrip(null);
    const { data, error } = await supabase.rpc("travel_to", { p_lat: p.lat, p_lng: p.lng });
    const res = data as (Trip & { cost?: number; coins?: number; error?: string }) | null;
    if (error || !res) { toast("Couldn't move there. Try again."); return; }
    if (res.error === "coins") { toast(`That trip costs ${res.cost} coins and you have ${res.coins}. Catch creatures or rip Turbo pulls to earn more.`); return; }
    if (res.error === "pass") { setUpsell(true); loadStatus(); return; }
    pendingCatch.current = p.catchId ?? null;
    setFollow(true);
    setDrops(new Map()); // the fog closes in while you travel
    setTrip(clockTrip(res));
    if (res.cost) toast(`Trip paid: ${res.cost} coins`);
    loadStatus();
  }, [toast, loadStatus]);

  const requestTravel = useCallback((lat: number, lng: number, catchId?: string) => {
    if (!pos || !status) return;
    if (!status.has_pass) { setUpsell(true); return; }
    const dist = distanceM(pos.lat, pos.lng, lat, lng);
    const cost = tripCost(status, dist);
    const p = { lat, lng, cost, dist, catchId };
    if (cost > 0) setConfirmTrip(p); else doTravel(p);
  }, [pos, status, doTravel]);

  function tapDrop(d: Drop) {
    if (!pos) return;
    const dist = distanceM(pos.lat, pos.lng, d.lat, d.lng);
    if (pos.arrived && dist <= CATCH_RADIUS_M) { setCatching(d); return; }
    if (isWalker) { toast(`${SPECIES[d.species_id]?.name ?? "It"} is ${Math.round(dist)} m away. Walk closer to catch it.`); return; }
    requestTravel(d.lat, d.lng, d.id);
  }

  async function toggle3D() {
    if (!threeD) { await askMotion(); setFollow(true); }
    setThreeD(!threeD);
  }

  // Hunt mode shows creatures around where you really are, so your explorer has to be with you.
  async function startHunt() {
    if (!gps.fix) { toast("Waiting for your location. Step outside for a better signal."); return; }
    if (!pos || distanceM(gps.fix.lat, gps.fix.lng, pos.lat, pos.lng) > 150) {
      toast("Hunt mode works where you're standing. Tap \"Go to my location\" first.");
      return;
    }
    await askMotion();
    setHunting(true);
  }

  async function buyThrows(): Promise<boolean> {
    const { data } = await supabase.rpc("buy_throws", { p_packs: 1 });
    const res = data as { error?: string; cost?: number } | null;
    if (!res || res.error) {
      toast(res?.error === "coins" ? `${status?.throw_pack_size ?? 10} throws cost ${res.cost} coins. Catch creatures to earn more.` : "Couldn't buy throws right now.");
      return false;
    }
    toast(`+${status?.throw_pack_size ?? 10} throws`);
    await loadStatus();
    return true;
  }

  async function buyBoost() {
    const { data } = await supabase.rpc("buy_sight_boost");
    const res = data as { error?: string; cost?: number } | null;
    if (!res || res.error) { toast(res?.error === "coins" ? `A sight boost costs ${res.cost} coins.` : "Couldn't boost right now."); return; }
    toast(`Sight boosted for ${status?.boost_minutes ?? 30} minutes.`);
    await loadStatus(); loadDrops();
  }

  async function doThrow(quality: number): Promise<CatchResult> {
    if (!catching) return { result: "error", message: "Nothing to catch." };
    const g = walkBonus || isWalker ? gps.fix : null;
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
    loadStatus(); // throws left
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
  const throwsLeft = status?.throws_free == null ? null
    : Math.max(0, status.throws_free - (status.throws_used ?? 0)) + (status.bonus_throws ?? 0);
  const [throwShop, setThrowShop] = useState(false);
  const boosted = !!status?.boost_until && new Date(status.boost_until).getTime() > now;

  function openTab(t: Tab) { setTab(t); if (t !== "map") { setPanel(t); setHunting(false); } }
  const showPanel: PanelTab = tab === "map" ? panel : tab;
  const nearRar = nearest ? RARITY[SPECIES[nearest.species_id]?.rar ?? "c"] : null;
  const bountyFor = (sp: number) => {
    const r = SPECIES[sp]?.rar ?? "c";
    return status?.pot && status.pot.remaining > 0 ? (status.bounty[r] ?? status.bounty.r) : 0;
  };

  return (
    <div className="app" data-tab={tab}>
      <RetroFilterDefs />
      <header>
        <div className="logo">Slab <span>Hunt</span></div>
        <button className="coin-chip" onClick={() => openTab("gacha")} aria-label="Your coins. Open the gacha.">
          <span className="coin" aria-hidden="true" /> <b>{status ? status.coins.toLocaleString() : "–"}</b>
        </button>
        <button className="help-chip" onClick={() => setShowTut(true)} aria-label="How to play">?</button>
        <button className="prize-chip" onClick={() => { setPanel("draw"); if (!matchMedia("(min-width:960px)").matches) setTab("draw"); }}>
          <b>Round {round?.id ?? "–"}</b><span className="t">{round ? `${round.prize_name} ${round.prize_grade}` : ""}</span>
        </button>
      </header>

      <main>
        <section className="stage" aria-label="Map">
          {pos && threeD ? (
            <Suspense fallback={<div className="locating"><h2 className="sec">Loading 3D view...</h2></div>}>
              <Map3D
                key={`${retro ? "retro" : "normal"}-${profile?.avatar ?? 0}`}
                pos={pos}
                dest={trip ? { lat: trip.to_lat, lng: trip.to_lng } : null}
                arrived={pos.arrived}
                sightM={status?.sight_m ?? 300}
                hotspots={season?.hotspots ?? []}
                retro={retro}
                avatar={profile?.avatar ?? 0}
                gps={walkBonus ? gps.fix : null}
                drops={live}
                follow={follow}
                compass={compass.ref}
                turnWithMe={compass.available}
                onFollowChange={setFollow}
                onDropTap={tapDrop}
                onMapTap={(lat, lng) => requestTravel(lat, lng)}
                onFail={() => { setThreeD(false); toast("3D view isn't available on this device right now. Back to the flat map."); }}
              />
            </Suspense>
          ) : pos ? (
            <MapView
              pos={pos}
              dest={trip ? { lat: trip.to_lat, lng: trip.to_lng } : null}
              arrived={pos.arrived}
              sightM={status?.sight_m ?? 300}
              hotspots={season?.hotspots ?? []}
              retro={retro}
              avatar={profile?.avatar ?? 0}
              gps={walkBonus ? gps.fix : null}
              drops={live}
              follow={follow}
              onFollowChange={setFollow}
              onDropTap={tapDrop}
              onMapTap={(lat, lng) => requestTravel(lat, lng)}
            />
          ) : (
            <div className="locating">
              <h2 className="sec">{placing ? "Placing your explorer..." : "Couldn't load the map"}</h2>
              <p className="sub">{placing ? "Starting you near where you are. You can travel anywhere from there." : "Check your connection and reload."}</p>
            </div>
          )}
          {pos && (
            <div className="hud">
              <div className="pill" title="Raffle entries earned in the last 24 hours">Today <b>{status?.entries_today ?? 0}/{status?.daily_cap ?? 20}</b></div>
              {throwsLeft != null && (
                <button className={"pill" + (throwsLeft === 0 ? " warn" : "")} onClick={() => setThrowShop(true)} title="Throws left today. Tap to get more with coins.">
                  🎯 Throws <b>{throwsLeft}</b>
                </button>
              )}
              {isWalker && <button className="pill" onClick={() => setUpsell(true)}>🚶 Walking</button>}
              {traveling
                ? <div className="pill">Arriving in <b>{fmtWait(pos.secondsLeft)}</b></div>
                : <div className="pill">In sight <b>{live.length}</b></div>}
              {season && (
                <button className="pill season" onClick={() => openTab("gacha")} title={`${season.name}: seasonal creatures spawn 4x in ★ hotspots`}>
                  ★ S{season.id} <b>{timeLeft(season.ends_at, now)}</b>
                </button>
              )}
              <button className={"pill" + (boosted ? " on" : "")} onClick={buyBoost} title="See farther for a while">
                Sight <b>{fmtDist(status?.sight_m ?? 300)}</b>{!boosted && <> · Boost {status?.boost_cost ?? 25}</>}
              </button>
              {!isWalker && (
                <button className={"pill" + (walkBonus ? " on" : "")} aria-pressed={walkBonus} onClick={() => setWalkBonus((v) => !v)}>
                  Walk bonus <b>{walkBonus ? "on" : "off"}</b>
                </button>
              )}
              <button className={"pill" + (retro ? " on" : "")} aria-pressed={retro} onClick={() => setRetro(!retro)}>👾 Retro</button>
              <button className={"pill" + (threeD ? " on" : "")} aria-pressed={threeD} onClick={toggle3D}>🏙️ 3D</button>
              {(isWalker || walkBonus) && <button className="pill" onClick={startHunt}>📷 Hunt</button>}
              {!follow && <button className="pill" onClick={() => setFollow(true)}>Re-center</button>}
              {!isWalker && walkBonus && gps.fix && (
                <button className="pill" onClick={() => requestTravel(gps.fix!.lat, gps.fix!.lng)}>Go to my location</button>
              )}
            </div>
          )}
          {(walkBonus || isWalker) && gps.error && pos && <div className="hint warn">{gps.error}</div>}
          {isWalker && !gps.fix && (
            <div className="walk-gate">
              <h2 className="sec">{gps.status === "denied" ? "Location needed to hunt" : "Finding you..."}</h2>
              <p className="sub">{gps.status === "denied"
                ? "Free players hunt by walking around for real, so the game needs your location. Allow it in your browser settings, or get a Season Pass to explore the whole map from anywhere."
                : "Free players hunt by walking. Allow location access when your browser asks."}</p>
              <button className="btn" onClick={() => openTab("gacha")}>See the Season Pass</button>
            </div>
          )}
          {throwShop && (
            <div className="near confirm">
              <div><span className="nm">{status?.throw_pack_size ?? 10} more throws</span>
                <small>{status?.throw_pack_price ?? 50} coins · you have {(status?.coins ?? 0).toLocaleString()}. {status?.throws_free ?? 30} free throws every day{status?.throws_reset_at ? `, next refill in ${timeLeft(status.throws_reset_at, now)}` : ""}.</small></div>
              <button className="btn" disabled={(status?.coins ?? 0) < (status?.throw_pack_price ?? 50)} onClick={async () => { if (await buyThrows()) setThrowShop(false); }}>Buy</button>
              <button className="btn ghost" onClick={() => setThrowShop(false)}>Close</button>
            </div>
          )}
          {upsell && (
            <div className="near confirm">
              <div><span className="nm">Explore from anywhere</span>
                <small>Tap-to-travel needs a Season Pass ({(status?.pass_price ?? 5000).toLocaleString()} coins). Free players hunt by walking.</small></div>
              <button className="btn" onClick={() => { setUpsell(false); openTab("gacha"); }}>See pass</button>
              <button className="btn ghost" onClick={() => setUpsell(false)}>Close</button>
            </div>
          )}
          {pos && !catching && !confirmTrip && !upsell && !throwShop && !((walkBonus || isWalker) && gps.error) && (
            nearest && nearRar ? (
              <div className="near">
                <div><span className="nm">{SPECIES[nearest.species_id]?.name}</span>
                  <small>{nearRar.label} · {nearRar.entries} {nearRar.entries > 1 ? "entries" : "entry"}{bountyFor(nearest.species_id) ? ` · ${bountyFor(nearest.species_id)} coins` : ""}</small></div>
                <button className="btn" onClick={() => setCatching(nearest)}>Catch</button>
              </div>
            ) : traveling ? (
              <div className="hint">Traveling...</div>
            ) : !hintSeen ? (
              <button className="hint" onClick={dismissHint}>
                {isWalker
                  ? "You can only see inside the blue circle. Walk toward a creature to catch it."
                  : `You can only see inside the blue circle. Tap the map to explore (under ${fmtDist(status?.free_hop_m ?? 2000)} is free).`}
                <span className="hint-x"> Got it ✕</span>
              </button>
            ) : null
          )}
          {confirmTrip && (
            <div className="near confirm">
              <div><span className="nm">Trip of {fmtDist(confirmTrip.dist)}</span>
                <small>Costs {confirmTrip.cost} coins · you have {status?.coins ?? 0}</small></div>
              <button className="btn" onClick={() => doTravel(confirmTrip)} disabled={(status?.coins ?? 0) < confirmTrip.cost}>Go</button>
              <button className="btn ghost" onClick={() => setConfirmTrip(null)}>Cancel</button>
            </div>
          )}
          {hunting && gps.fix && (
            <HuntCam
              at={gps.fix}
              drops={live}
              sightM={status?.sight_m ?? 300}
              retro={retro}
              compass={compass}
              canCatch={(d) => !!pos?.arrived && distanceM(pos.lat, pos.lng, d.lat, d.lng) <= CATCH_RADIUS_M}
              onTap={tapDrop}
              onClose={() => setHunting(false)}
            />
          )}
          {catching && <CatchModal drop={catching} retro={retro} throwsLeft={throwsLeft} onBuyThrows={buyThrows} onClose={() => setCatching(null)} onThrow={doThrow} />}
        </section>

        <aside className="panel">
          <div className="panel-tabs" role="tablist">
            {PANEL_TABS.map((p) => (
              <button key={p} role="tab" aria-selected={showPanel === p} onClick={() => setPanel(p)}>{LABEL[p]}</button>
            ))}
          </div>
          <div className={"view" + (showPanel === "gacha" ? " on" : "")}>
            <GachaPanel userId={userId} status={status} season={season} isAdmin={!!profile?.is_admin}
              onCoins={() => { loadStatus(); loadSeason(); }}
              onTravelHotspot={(lat, lng) => { openTab("map"); requestTravel(lat, lng); }}
              toast={toast} />
          </div>
          <div className={"view" + (showPanel === "mint" ? " on" : "")}>
            <MintPanel status={status} season={season} isAdmin={!!profile?.is_admin} visible={showPanel === "mint"}
              onCoins={loadStatus} toast={toast} />
          </div>
          <div className={"view" + (showPanel === "chat" ? " on" : "")}><ChatPanel userId={userId} visible={showPanel === "chat"} /></div>
          <div className={"view" + (showPanel === "draw" ? " on" : "")}>
            <DrawPanel round={round} stats={stats} isAdmin={!!profile?.is_admin} onChanged={() => { loadRound(); loadStats(); }} toast={toast} />
            <RanksPanel userId={userId} visible={showPanel === "draw"} />
          </div>
          <div className={"view" + (showPanel === "profile" ? " on" : "")}>
            <ProfilePanel profile={profile} catchesVersion={catchesVersion} onSaved={loadProfile} toast={toast} />
          </div>
        </aside>
      </main>

      <nav className="tabs" aria-label="Sections">
        {(["map", ...PANEL_TABS] as Tab[]).map((t) => (
          <button key={t} aria-selected={tab === t} onClick={() => openTab(t)}>{LABEL[t]}</button>
        ))}
      </nav>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {showTut && <Tutorial onDone={() => setShowTut(false)} />}
    </div>
  );
}
