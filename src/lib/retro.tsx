// Retro mode: everything redrawn in the original handheld's 4 shades of green.
import { useEffect, useState } from "react";

export const GB_PALETTE = ["#0F380F", "#306230", "#8BAC0F", "#9BBC0F"]; // dark -> light

/**
 * SVG filter: turn any image into 4-shade green.
 * 1) convert to brightness, 2) snap to 4 levels, 3) map each level to a palette color.
 */
export function RetroFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="gb" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0.059 0.188 0.545 0.608" />
            <feFuncG type="discrete" tableValues="0.220 0.384 0.675 0.737" />
            <feFuncB type="discrete" tableValues="0.059 0.188 0.059 0.059" />
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
