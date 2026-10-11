// Launch countdown for the signup / pre-launch page. Uses the server clock so a wrong phone clock doesn't matter.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Countdown() {
  const [target, setTarget] = useState<number | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    supabase.rpc("site_mode").then(({ data }) => {
      const d = data as { launch_at?: string | null; server_now?: string } | null;
      if (d?.launch_at) setTarget(new Date(d.launch_at).getTime());
      if (d?.server_now) setSkew(new Date(d.server_now).getTime() - Date.now());
    });
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return null;
  const left = Math.max(0, Math.floor((target - (now + skew)) / 1000));
  const parts: [number, string][] = [[Math.floor(left / 86400), "days"], [Math.floor((left % 86400) / 3600), "hrs"], [Math.floor((left % 3600) / 60), "min"], [left % 60, "sec"]];
  const shown = parts[0][0] > 0 ? parts : parts.slice(1);
  const when = new Date(target).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return (
    <div className="su-count" aria-live="off">
      <small>{left > 0 ? "$SLAB AND THE GAME LAUNCH IN" : "WE'RE LIVE"}</small>
      {left > 0 && (
        <div className="su-count-row" role="timer" aria-label={`Launch in ${shown.map(([v, l]) => `${v} ${l}`).join(" ")}`}>
          {shown.map(([v, l]) => <div key={l}><b>{String(v).padStart(2, "0")}</b><span>{l}</span></div>)}
        </div>
      )}
      <span className="su-count-when">{left > 0 ? when : "Refresh to start hunting."}</span>
    </div>
  );
}
