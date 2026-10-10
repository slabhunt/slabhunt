import { useEffect, useState } from "react";

export type Fix = { lat: number; lng: number; accuracy: number; at: number };
export type LocationState = { fix: Fix | null; error: string | null; status: "off" | "asking" | "ok" | "denied" | "unavailable" };

/** Live GPS position, only while `enabled` (used for the walking bonus). */
export function useLocation(enabled: boolean): LocationState {
  const [state, setState] = useState<LocationState>({ fix: null, error: null, status: "off" });

  useEffect(() => {
    if (!enabled) { setState({ fix: null, error: null, status: "off" }); return; }
    if (!("geolocation" in navigator)) {
      setState({ fix: null, error: "This browser can't share your location.", status: "unavailable" });
      return;
    }
    setState((s) => ({ ...s, status: "asking" }));
    const id = navigator.geolocation.watchPosition(
      (p) => setState({ fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }, error: null, status: "ok" }),
      (e) => setState((s) => ({
        fix: s.fix,
        error: e.code === e.PERMISSION_DENIED
          ? "Location is blocked for this site. Allow it in your browser settings to earn the walking bonus."
          : "Can't get a GPS fix yet.",
        status: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable",
      })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return state;
}

/** One quick, low-accuracy location read for placing a new explorer near the player. */
export function roughLocation(timeoutMs = 6000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    const t = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: false, maximumAge: 600000, timeout: timeoutMs },
    );
  });
}
