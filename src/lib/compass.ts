// Phone compass and tilt, for the 3D map (turn with me) and hunt mode.
// Readings arrive ~60 times a second, so they live in a ref instead of React state.
import { useEffect, useRef, useState } from "react";

export type CompassReading = { heading: number | null; beta: number | null };
export type Compass = { ref: React.MutableRefObject<CompassReading>; available: boolean };

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** iPhones only share motion after the player taps something, so call this from a tap handler. */
export async function askMotion(): Promise<boolean> {
  const DOE = (window as unknown as { DeviceOrientationEvent?: OrientationPermission }).DeviceOrientationEvent;
  if (!DOE) return false;
  if (!DOE.requestPermission) return true;
  try { return (await DOE.requestPermission()) === "granted"; } catch { return false; }
}

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return typeof a === "number" ? a : 0;
}

export function useCompass(enabled: boolean): Compass {
  const ref = useRef<CompassReading>({ heading: null, beta: null });
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let gotAbsolute = false, seen = false;
    const handle = (e: DeviceOrientationEvent, absolute: boolean) => {
      const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      let h: number | null = null;
      if (typeof ios === "number" && !Number.isNaN(ios)) h = ios;                 // iPhone: already true heading
      else if ((absolute || e.absolute) && e.alpha != null) h = 360 - e.alpha;   // Android: alpha counts the other way
      const prev = ref.current.heading;
      if (h != null) {
        h = (h + screenAngle() + 360) % 360;
        if (prev != null) {
          // Smooth out sensor jitter, taking the short way round past north.
          let d = h - prev; if (d > 180) d -= 360; if (d < -180) d += 360;
          h = (prev + d * 0.2 + 360) % 360;
        }
        if (!seen) { seen = true; setAvailable(true); }
      }
      ref.current = { heading: h ?? prev, beta: e.beta };
    };
    const onAbsolute = (e: Event) => { gotAbsolute = true; handle(e as DeviceOrientationEvent, true); };
    const onRelative = (e: DeviceOrientationEvent) => { if (!gotAbsolute) handle(e, false); };
    addEventListener("deviceorientationabsolute", onAbsolute);
    addEventListener("deviceorientation", onRelative);
    return () => {
      removeEventListener("deviceorientationabsolute", onAbsolute);
      removeEventListener("deviceorientation", onRelative);
    };
  }, [enabled]);

  return { ref, available };
}
