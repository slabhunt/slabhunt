// A graded slab that floats: silver case, a label with the grade (colored by tier), and the card inside. Until a real
// card photo is uploaded (image_url), the slab shows one of our creatures so it never looks like an empty placeholder.
import type { CSSProperties } from "react";
import { creatureImage, SPECIES } from "../lib/species";

const TIER_COLOR: Record<string, string> = {
  common: "#B9C3D6", uncommon: "#5DC28A", rare: "#4C9BE0", epic: "#A46BE8", legendary: "#F2C14E", prize: "#E8B33A",
};

function pick(name: string) {
  let h = 7;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SPECIES.length;
}

export default function SlabArt({ name, grade, tier = "prize", image, width = 120, float = true, label }: {
  name: string; grade?: string | null; tier?: string; image?: string | null; width?: number; float?: boolean; label?: string;
}) {
  const style = { "--sw": `${width}px`, "--tier": TIER_COLOR[tier] ?? TIER_COLOR.prize } as CSSProperties;
  const top = (label ?? grade ?? "").toUpperCase() || "GRADED";
  return (
    <div className={"slabart" + (float ? " float" : "")} style={style} role="img" aria-label={`${name}${grade ? `, ${grade}` : ""}`}>
      <div className="slabart-case">
        <div className="slabart-label"><b>{top}</b></div>
        <div className="slabart-face">
          {image ? <img className="photo" src={image} alt="" loading="lazy" /> : <img className="creature" src={creatureImage(pick(name), 96)} alt="" />}
          <i className="slabart-sheen" aria-hidden="true" />
        </div>
      </div>
      <i className="slabart-shadow" aria-hidden="true" />
    </div>
  );
}
