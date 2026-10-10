import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Polyline, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Drop } from "../lib/supabase";
import type { Fix } from "../hooks/useLocation";
import { creatureImage, SPECIES } from "../lib/species";
import { CATCH_RADIUS_M, distanceM } from "../lib/geo";

type LatLng = { lat: number; lng: number };
type Props = {
  pos: LatLng;               // explorer position now
  dest: LatLng | null;       // trip destination while traveling
  arrived: boolean;
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
function dropIcon(sp: number, near: boolean) {
  const key = `${sp}:${near}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const rare = SPECIES[sp]?.rar === "r";
    icon = L.divIcon({
      className: "drop-icon" + (near ? " near" : "") + (rare ? " rare" : ""),
      html: `<img src="${creatureImage(sp, 48)}" alt="${SPECIES[sp]?.name ?? "Creature"}" width="56" height="56">`,
      iconSize: [56, 56],
      iconAnchor: [28, 34],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

const explorerIcon = L.divIcon({ className: "explorer-icon", html: "<span></span>", iconSize: [30, 30], iconAnchor: [15, 15] });

export default function MapView({ pos, dest, arrived, gps, drops, follow, onFollowChange, onDropTap, onMapTap }: Props) {
  const start = useRef<[number, number]>([pos.lat, pos.lng]);
  const live = useMemo(() => drops.filter((d) => !d.caught_by && new Date(d.expires_at).getTime() > Date.now()), [drops]);
  return (
    <MapContainer center={start.current} zoom={16} minZoom={3} maxZoom={19} zoomControl={false} className="map" worldCopyJump attributionControl>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <Follow pos={pos} follow={follow} />
      <Events onMapTap={onMapTap} onDrag={() => onFollowChange(false)} />
      {dest && !arrived && (
        <>
          <Polyline positions={[[pos.lat, pos.lng], [dest.lat, dest.lng]]} pathOptions={{ color: "#E8B33A", weight: 3, dashArray: "6 8", opacity: 0.8 }} interactive={false} />
          <CircleMarker center={[dest.lat, dest.lng]} radius={6} pathOptions={{ color: "#E8B33A", weight: 2, fillOpacity: 0 }} interactive={false} />
        </>
      )}
      {arrived && (
        <Circle center={[pos.lat, pos.lng]} radius={CATCH_RADIUS_M} pathOptions={{ color: "#E8B33A", weight: 2, dashArray: "6 6", fillOpacity: 0.06 }} interactive={false} />
      )}
      {live.map((d) => (
        <Marker
          key={d.id}
          position={[d.lat, d.lng]}
          icon={dropIcon(d.species_id, arrived && distanceM(pos.lat, pos.lng, d.lat, d.lng) <= CATCH_RADIUS_M)}
          eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onDropTap(d); } }}
          keyboard
          title={SPECIES[d.species_id]?.name}
        />
      ))}
      {gps && (
        <CircleMarker center={[gps.lat, gps.lng]} radius={7} pathOptions={{ color: "#FFFFFF", weight: 2, fillColor: "#4C9BE0", fillOpacity: 1 }} interactive={false} />
      )}
      <Marker position={[pos.lat, pos.lng]} icon={explorerIcon} interactive={false} />
    </MapContainer>
  );
}
