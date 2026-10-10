import { useCallback, useEffect, useState } from "react";

export type Fix = { lat: number; lng: number; accuracy: number; at: number; simulated?: boolean };
export type LocationState = { fix: Fix | null; error: string | null; status: "asking" | "ok" | "denied" | "unavailable" };

/** Live GPS position. `simulate` lets testers move by tapping the map (dev only). */
export function useLocation() {
  const [state, setState] = useState<LocationState>({ fix: null, error: null, status: "asking" });
  const [sim, setSim] = useState<Fix | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState({ fix: null, error: "This browser can't share your location.", status: "unavailable" });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setState({ fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }, error: null, status: "ok" }),
      (e) => setState((s) => ({
        fix: s.fix,
        error: e.code === e.PERMISSION_DENIED
          ? "Location is blocked. Allow location for this site in your browser settings to play."
          : "Can't get a GPS fix yet. Step outside or wait a moment.",
        status: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable",
      })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const simulate = useCallback((lat: number, lng: number) => setSim({ lat, lng, accuracy: 5, at: Date.now(), simulated: true }), []);
  return { ...state, fix: sim ?? state.fix, simulate };
}
