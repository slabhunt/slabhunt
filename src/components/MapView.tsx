import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Polyline, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Drop, Hotspot } from "../lib/supabase";
import type { Fix } from "../hooks/useLocation";
import { creatureImage, SPECIES } from "../lib/species";
import { CATCH_RADIUS_M, distanceM } from "../lib/geo";
import { hunterHtml } from "../lib/hunterSprite";

type LatLng = { lat: number; lng: number };
type Props = {
  pos: LatLng;               // explorer position now
  dest: LatLng | null;       // trip destination while traveling
  arrived: boolean;
  sightM: number;            // how far the explorer can see
  hotspots: Hotspot[];       // this season's boosted cities
  retro: boolean;            // retro look: chunky pixels, pixel sprites and your pixel character
  avatar?: number;           // player character id (hunterSprite.ts)
  gps: Fix | null;           // real location, when walking bonus is on
  drops: Drop[];
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  onDropTap: (d: Drop) => void;
  onMapTap: (lat: number, lng: number) => void;
};

function Follow({ pos, follow }: { pos: LatLng; follow: boolean }) {
  const map = useMap();
  useEffect(() => { if (follow) map.panTo([pos.lat, pos.lng], { animate: false }); }, [pos.lat, pos.lng, follow, map]);
  return null;
}

function Events({ onMapTap, onDrag }: { onMapTap: (lat: number, lng: number) => void; onDrag: () => void }) {
  useMapEvents({
    click: (e) => onMapTap(e.latlng.lat, Math.max(-180, Math.min(180, e.latlng.wrap().lng))),
    dragstart: onDrag,
  });
  return null;
}

const iconCache = new Map<string, L.DivIcon>();
function dropIcon(sp: number, near: boolean, retro: boolean) {
  const key = `${sp}:${near}:${retro}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const rare = SPECIES[sp]?.rar === "r" || SPECIES[sp]?.rar === "l";
    icon = L.divIcon({
      className: "drop-icon" + (near ? " near" : "") + (rare ? " rare" : ""),
      // Retro: draw the sprite tiny, then let the browser blow it up with hard pixel edges.
      html: `<img src="${creatureImage(sp, retro ? 12 : 48)}" alt="${SPECIES[sp]?.name ?? "Creature"}" width="56" height="56">`,
      iconSize: [56, 56],
      iconAnchor: [28, 34],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

// The player's pixel character stands on the map (60x78 at 3x), feet on the spot.
const hunterIcons = new Map<string, L.DivIcon>();
function hunterIcon(avatar: number, walking: boolean) {
  const key = `${avatar}:${walking}`;
  let i = hunterIcons.get(key);
  if (!i) {
    i = L.divIcon({ className: "hunter-marker", html: hunterHtml(avatar, 3).replace('class="hunter"', `class="hunter${walking ? " walking" : ""}"`), iconSize: [60, 78], iconAnchor: [30, 76] });
    hunterIcons.set(key, i);
  }
  return i;
}

const hotspotIcons = new Map<string, L.DivIcon>();
const hotspotIcon = (name: string) => {
  let i = hotspotIcons.get(name);
  if (!i) {
    i = L.divIcon({ className: "hotspot-label", html: `<span>★ ${name.replace(/[<>&"]/g, "")}</span>`, iconSize: [10, 10], iconAnchor: [5, 5] });
    hotspotIcons.set(name, i);
  }
  return i;
};

export default function MapView({ pos, dest, arrived, sightM, hotspots, retro, avatar = 0, gps, drops, follow, onFollowChange, onDropTap, onMapTap }: Props) {
  const start = useRef<[number, number]>([pos.lat, pos.lng]);
  const live = useMemo(() => drops.filter((d) => !d.caught_by && new Date(d.expires_at).getTime() > Date.now()), [drops]);
  return (
    <MapContainer center={start.current} zoom={16} minZoom={3} maxZoom={19} zoomControl={false} className="map" worldCopyJump attributionControl>
      {/* Retro loads one zoom level lower and doubles the tile size, so every map pixel becomes a 2x2 block. */}
      <TileLayer
        key={retro ? "retro" : "normal"}
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
        tileSize={retro ? 512 : 256}
        zoomOffset={retro ? -1 : 0}
      />
      <Follow pos={pos} follow={follow} />
      <Events onMapTap={onMapTap} onDrag={() => onFollowChange(false)} />
      {dest && !arrived && (
        <>
          <Polyline positions={[[pos.lat, pos.lng], [dest.lat, dest.lng]]} pathOptions={{ color: "#E8B33A", weight: 3, dashArray: "6 8", opacity: 0.8 }} interactive={false} />
          <CircleMarker center={[dest.lat, dest.lng]} radius={6} pathOptions={{ color: "#E8B33A", weight: 2, fillOpacity: 0 }} interactive={false} />
        </>
      )}
      {hotspots.map((h) => (
        <Circle key={h.name} center={[h.lat, h.lng]} radius={h.radius_m} pathOptions={{ color: "#E8B33A", weight: 2, dashArray: "2 10", opacity: 0.7, fillColor: "#E8B33A", fillOpacity: 0.04 }} interactive={false} />
      ))}
      {hotspots.map((h) => (
        <Marker key={"l" + h.name} position={[h.lat, h.lng]} icon={hotspotIcon(h.name)} interactive={false} />
      ))}
      <Circle center={[pos.lat, pos.lng]} radius={sightM} pathOptions={{ color: "#7FC8F8", weight: 1, opacity: 0.6, fillColor: "#7FC8F8", fillOpacity: 0.05 }} interactive={false} />
      {arrived && (
        <Circle center={[pos.lat, pos.lng]} radius={CATCH_RADIUS_M} pathOptions={{ color: "#E8B33A", weight: 2, dashArray: "6 6", fillOpacity: 0.06 }} interactive={false} />
      )}
      {live.map((d) => (
        <Marker
          key={d.id}
          position={[d.lat, d.lng]}
          icon={dropIcon(d.species_id, arrived && distanceM(pos.lat, pos.lng, d.lat, d.lng) <= CATCH_RADIUS_M, retro)}
          eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onDropTap(d); } }}
          keyboard
          title={SPECIES[d.species_id]?.name}
        />
      ))}
      {gps && (
        <CircleMarker center={[gps.lat, gps.lng]} radius={7} pathOptions={{ color: "#FFFFFF", weight: 2, fillColor: "#4C9BE0", fillOpacity: 1 }} interactive={false} />
      )}
      <Marker position={[pos.lat, pos.lng]} icon={hunterIcon(avatar, !!dest && !arrived)} interactive={false} zIndexOffset={500} />
    </MapContainer>
  );
}
