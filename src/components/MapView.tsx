import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Drop } from "../lib/supabase";
import type { Fix } from "../hooks/useLocation";
import { creatureImage, SPECIES } from "../lib/species";
import { CATCH_RADIUS_M, distanceM } from "../lib/geo";

type Props = {
  fix: Fix;
  drops: Drop[];
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  onDropTap: (d: Drop) => void;
  onMapTap?: (lat: number, lng: number) => void;
};

function Follow({ fix, follow }: { fix: Fix; follow: boolean }) {
  const map = useMap();
  useEffect(() => { if (follow) map.panTo([fix.lat, fix.lng], { animate: true }); }, [fix.lat, fix.lng, follow, map]);
  return null;
}

function Events({ onMapTap, onDrag }: { onMapTap?: (lat: number, lng: number) => void; onDrag: () => void }) {
  useMapEvents({
    click: (e) => onMapTap?.(e.latlng.lat, e.latlng.lng),
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

export default function MapView({ fix, drops, follow, onFollowChange, onDropTap, onMapTap }: Props) {
  const start = useRef<[number, number]>([fix.lat, fix.lng]);
  const live = useMemo(() => drops.filter((d) => !d.caught_by && new Date(d.expires_at).getTime() > Date.now()), [drops]);
  return (
    <MapContainer center={start.current} zoom={17} minZoom={14} maxZoom={19} zoomControl={false} className="map" attributionControl>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <Follow fix={fix} follow={follow} />
      <Events onMapTap={onMapTap} onDrag={() => onFollowChange(false)} />
      <Circle center={[fix.lat, fix.lng]} radius={CATCH_RADIUS_M} pathOptions={{ color: "#E8B33A", weight: 2, dashArray: "6 6", fillOpacity: 0.06 }} interactive={false} />
      {fix.accuracy > 15 && (
        <Circle center={[fix.lat, fix.lng]} radius={fix.accuracy} pathOptions={{ color: "#7FC8F8", weight: 1, fillOpacity: 0.05 }} interactive={false} />
      )}
      {live.map((d) => (
        <Marker
          key={d.id}
          position={[d.lat, d.lng]}
          icon={dropIcon(d.species_id, distanceM(fix.lat, fix.lng, d.lat, d.lng) <= CATCH_RADIUS_M)}
          eventHandlers={{ click: () => onDropTap(d) }}
          keyboard
          title={SPECIES[d.species_id]?.name}
        />
      ))}
      <CircleMarker center={[fix.lat, fix.lng]} radius={9} pathOptions={{ color: "#FFF6DD", weight: 3, fillColor: "#E8B33A", fillOpacity: 1 }} interactive={false} />
    </MapContainer>
  );
}
