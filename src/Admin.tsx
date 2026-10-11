// slabhunt.fun/admin: live stats for admins. Everything comes from admin-only server functions (admin_dashboard,
// admin_player_map); the map shows general areas (~50 km cells), never where a player actually is.
import { useCallback, useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./lib/supabase";
import BugAdmin from "./components/BugAdmin";

type Day = { day: string; players: number; catches: number; signups: number };
type Dash = {
  players: { total: number; online: number; active_24h: number; active_7d: number; new_24h: number; new_7d: number; with_wallet: number; pass_holders: number };
  play: { catches_24h: number; catches_total: number; creatures_live: number; chat_24h: number; gacha_pulls_24h: number; mapped_areas: number };
  economy: { coins_held: number; earned_24h: number; spent_24h: number; pot_remaining: number; pot_total: number };
  draws: { round: { id: number; prize: string; status: string } | null; vault_open: number; cards_in_pool: number };
  signups: { total: number; today: number; unchecked: number };
  daily: Day[];
  top: { name: string; catches: number; coins: number; active_at: string | null }[];
  recent: { name: string; species: string; at: string }[];
};
type Area = { lat: number; lng: number; players: number; online: number };

const n = (v: number | undefined) => (v ?? 0).toLocaleString();
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? "now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

function Tile({ label, value, sub, live }: { label: string; value: string; sub?: string; live?: boolean }) {
  return (
    <div className="ad-tile">
      <span className="ad-label">{live && <i className="ad-dot" aria-hidden="true" />}{label}</span>
      <b className="ad-value">{value}</b>
      {sub && <span className="ad-sub">{sub}</span>}
    </div>
  );
}

/** 14 days as thin bars; hover a bar for its value. One series per chart, so the title names it. */
function Bars({ title, days, k }: { title: string; days: Day[]; k: keyof Omit<Day, "day"> }) {
  const max = Math.max(1, ...days.map((d) => d[k]));
  const total = days.reduce((a, d) => a + d[k], 0);
  return (
    <figure className="ad-chart">
      <figcaption><b>{title}</b><span>{total.toLocaleString()} in 14 days</span></figcaption>
      <div className="ad-bars" role="img" aria-label={`${title} per day for the last 14 days`}>
        {days.map((d) => (
          <div key={d.day} className="ad-bar" tabIndex={0}>
            <i style={{ height: `${Math.max(d[k] ? 6 : 2, (d[k] / max) * 100)}%` }} className={d[k] ? "" : "zero"} />
            <span className="ad-tip">{new Date(d.day + "T12:00:00Z").toLocaleDateString([], { month: "short", day: "numeric" })}: <b>{d[k].toLocaleString()}</b></span>
          </div>
        ))}
      </div>
      <div className="ad-axis"><span>{days[0]?.day.slice(5)}</span><span>today</span></div>
    </figure>
  );
}

export default function Admin() {
  const [state, setState] = useState<"loading" | "signed_out" | "denied" | "ok" | "error">("loading");
  const [dash, setDash] = useState<Dash | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { setState("signed_out"); return; }
    const [d, m] = await Promise.all([supabase.rpc("admin_dashboard"), supabase.rpc("admin_player_map")]);
    if (d.error) { setState(/admins only/i.test(d.error.message) ? "denied" : "error"); return; }
    setDash(d.data as Dash); setAreas((m.data as Area[] | null) ?? []); setUpdated(new Date()); setState("ok");
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (state !== "ok" || !dash) {
    return (
      <main className="ad"><div className="ad-head"><a href="/" className="logo">Slab <span>Hunt</span></a><h1>Admin</h1></div>
        <p className="sub">{state === "loading" ? "Loading..." : state === "signed_out" ? <>Sign in to the game first, then come back. <a href="/">Open the game</a></>
          : state === "denied" ? "This page is for Slab Hunt admins only." : "Couldn't load the stats. Refresh to try again."}</p>
      </main>
    );
  }
  const p = dash.players, e = dash.economy;
  const maxArea = Math.max(1, ...areas.map((a) => a.players));
  return (
    <main className="ad">
      <div className="ad-head">
        <a href="/" className="logo">Slab <span>Hunt</span></a><h1>Admin</h1>
        <span className="ad-live"><i className="ad-dot" aria-hidden="true" />{n(p.online)} playing now</span>
        <span className="ad-upd">Updated {updated?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · refreshes every 30 s</span>
        <button className="btn ghost small" onClick={load}>Refresh</button>
      </div>

      <section className="ad-tiles" aria-label="Players">
        <Tile label="Playing now" value={n(p.online)} sub="active in the last 3 min" live />
        <Tile label="Players" value={n(p.total)} sub={`+${n(p.new_24h)} today · +${n(p.new_7d)} this week`} />
        <Tile label="Active" value={n(p.active_24h)} sub={`last 24 h · ${n(p.active_7d)} this week`} />
        <Tile label="Catches" value={n(dash.play.catches_24h)} sub={`last 24 h · ${n(dash.play.catches_total)} all time`} />
        <Tile label="Creatures out" value={n(dash.play.creatures_live)} sub={`${n(dash.play.mapped_areas)} areas street-mapped`} />
        <Tile label="Early-access list" value={n(dash.signups.total)} sub={`+${n(dash.signups.today)} today · ${n(dash.signups.unchecked)} to check`} />
      </section>

      <section className="ad-grid">
        <div className="card ad-map-card">
          <h2 className="sec">Where people play</h2>
          <p className="sub small">General areas only (about 50 km squares). Bigger circle, more players; a cyan ring means someone there is playing now.</p>
          <div className="ad-map">
            <MapContainer center={[25, 0]} zoom={2} minZoom={1} worldCopyJump scrollWheelZoom style={{ height: "100%", width: "100%" }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
              {areas.map((a) => (
                <CircleMarker key={`${a.lat},${a.lng}`} center={[a.lat, a.lng]} radius={6 + 16 * Math.sqrt(a.players / maxArea)}
                  pathOptions={{ color: a.online ? "#00E5FF" : "#0F1828", weight: a.online ? 3 : 2, fillColor: "#E8B33A", fillOpacity: 0.85 }}>
                  <Tooltip>{a.players} player{a.players === 1 ? "" : "s"}{a.online ? ` · ${a.online} playing now` : ""}</Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          {!areas.length && <p className="sub small">No player locations yet.</p>}
        </div>

        <div className="card">
          <h2 className="sec">Last 14 days</h2>
          <Bars title="New players" days={dash.daily} k="players" />
          <Bars title="Catches" days={dash.daily} k="catches" />
          <Bars title="Early-access signups" days={dash.daily} k="signups" />
        </div>

        <div className="card">
          <h2 className="sec">Economy</h2>
          <dl className="ad-dl">
            <dt>Coins held by players</dt><dd>{n(e.coins_held)}</dd>
            <dt>Earned (24 h)</dt><dd>{n(e.earned_24h)}</dd>
            <dt>Spent (24 h)</dt><dd>{n(e.spent_24h)}</dd>
            <dt>Season bounty pot</dt><dd>{n(e.pot_remaining)} of {n(e.pot_total)} left</dd>
            <dt>Gacha pulls (24 h)</dt><dd>{n(dash.play.gacha_pulls_24h)}</dd>
            <dt>Chat messages (24 h)</dt><dd>{n(dash.play.chat_24h)}</dd>
            <dt>Linked wallets</dt><dd>{n(p.with_wallet)}</dd>
            <dt>Season Pass holders</dt><dd>{n(p.pass_holders)}</dd>
          </dl>
          <h2 className="sec">Draws</h2>
          <dl className="ad-dl">
            <dt>Raffle</dt><dd>{dash.draws.round ? `Round ${dash.draws.round.id}: ${dash.draws.round.prize} (${dash.draws.round.status})` : "none"}</dd>
            <dt>Vault Draws open</dt><dd>{n(dash.draws.vault_open)}</dd>
            <dt>Prize cards available</dt><dd>{n(dash.draws.cards_in_pool)}</dd>
          </dl>
        </div>

        <div className="card">
          <h2 className="sec">Top hunters</h2>
          <table className="ad-table">
            <thead><tr><th>Player</th><th>Catches</th><th>Coins</th><th>Last seen</th></tr></thead>
            <tbody>{dash.top.map((t) => <tr key={t.name}><td>{t.name}</td><td>{n(t.catches)}</td><td>{n(t.coins)}</td><td>{ago(t.active_at)}</td></tr>)}</tbody>
          </table>
          <h2 className="sec">Latest catches</h2>
          {dash.recent.length ? (
            <ul className="ad-feed">{dash.recent.map((r, i) => <li key={i}><b>{r.name}</b> caught {r.species}<span>{ago(r.at)}</span></li>)}</ul>
          ) : <p className="sub small">No catches yet.</p>}
        </div>
      </section>
      <BugAdmin />
    </main>
  );
}
