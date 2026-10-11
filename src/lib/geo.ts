export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Must match game_config.catch_radius_m in the database. */
export const CATCH_RADIUS_M = 60;

/** Compass bearing from point 1 to point 2, in degrees clockwise from north (0-360). */
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** Signed difference a - b in degrees, folded into -180..180. */
export function angleDiff(a: number, b: number) {
  return ((a - b + 540) % 360) - 180;
}
