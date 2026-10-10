// The explorer is the player's on-map character. The server owns its trip; the app animates it.
export type Trip = {
  from_lat: number; from_lng: number; to_lat: number; to_lng: number;
  depart_at: string; arrive_at: string; server_now: string;
};

export type TripClock = Trip & { departMs: number; arriveMs: number; offsetMs: number };

/** Attach timing in local-clock milliseconds (corrected for server clock drift). */
export function clockTrip(t: Trip): TripClock {
  const offsetMs = new Date(t.server_now).getTime() - Date.now();
  return { ...t, departMs: new Date(t.depart_at).getTime() - offsetMs, arriveMs: new Date(t.arrive_at).getTime() - offsetMs, offsetMs };
}

export function tripPosition(t: TripClock, now = Date.now()) {
  const span = Math.max(t.arriveMs - t.departMs, 1);
  const k = Math.min(Math.max((now - t.departMs) / span, 0), 1);
  return {
    lat: t.from_lat + (t.to_lat - t.from_lat) * k,
    lng: t.from_lng + (t.to_lng - t.from_lng) * k,
    arrived: now >= t.arriveMs,
    secondsLeft: Math.max(0, Math.ceil((t.arriveMs - now) / 1000)),
  };
}

/** Where new players start if their location isn't available. */
export const DEFAULT_START = { lat: 40.758, lng: -73.9855 }; // Times Square, New York
