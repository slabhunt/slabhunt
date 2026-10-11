// Retro mode: chunky pixels, pixel fonts and a posterized (few-shades-per-color) look that keeps real colors.
import { useEffect, useState } from "react";


/**
 * SVG filter (id "gb" kept so existing styles still point at it): posterize every color channel to 5 levels and lift
 * saturation a little, so maps and sprites look like an old console's palette without losing their colors.
 */
export function RetroFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="gb" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="1.25" />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0.04 0.25 0.5 0.75 1" />
            <feFuncG type="discrete" tableValues="0.04 0.25 0.5 0.75 1" />
            <feFuncB type="discrete" tableValues="0.1 0.3 0.55 0.8 1" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

const KEY = "vh.retro";
export function useRetro(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle("retro", on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
  }, [on]);
  return [on, setOn];
}
