// Street-level 3D map: tilted camera, 3D buildings, creatures standing up on the street.
// Loaded only when a player turns 3D on (MapLibre is large), so the 2D map stays fast.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Drop, Hotspot } from "../lib/supabase";
import type { Fix } from "../hooks/useLocation";
import type { CompassReading } from "../lib/compass";
import { creatureImage, SPECIES } from "../lib/species";
import { angleDiff, bearingDeg, CATCH_RADIUS_M, distanceM } from "../lib/geo";

// Free vector map tiles with building heights (no account or key needed).
const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const PITCH = 68;
const ZOOM = 17.4;

type LatLng = { lat: number; lng: number };
type GJ = Parameters<maplibregl.GeoJSONSource["setData"]>[0];
type Props = {
  pos: LatLng;
  dest: LatLng | null;
  arrived: boolean;
  sightM: number;
  hotspots: Hotspot[];
  retro: boolean;
  gps: Fix | null;
  drops: Drop[];
  follow: boolean;
  compass: React.MutableRefObject<CompassReading>;
  turnWithMe: boolean;          // rotate the view with the phone's compass
  onFollowChange: (v: boolean) => void;
  onDropTap: (d: Drop) => void;
  onMapTap: (lat: number, lng: number) => void;
  onFail: () => void;           // no WebGL, or the map couldn't load: App falls back to 2D
};

function ring(lat: number, lng: number, r: number, n = 72): number[][] {
  const dLat = r / 111320, dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const pts: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return pts;
}

const poly = (kind: string, pts: number[][]) => ({ type: "Feature", properties: { kind }, geometry: { type: "Polygon", coordinates: [pts] } });
const line = (kind: string, pts: number[][]) => ({ type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates: pts } });

/** Recolor the light street style into the game's night look. */
function nightStyle(map: maplibregl.Map) {
  const layers = map.getStyle().layers ?? [];
  for (const l of layers) {
    const id = l.id;
    try {
      if (l.type === "background") map.setPaintProperty(id, "background-color", "#131F33");
      else if (l.type === "fill") {
        map.setPaintProperty(id, "fill-color",
          /water/.test(id) ? "#0E2740" : /park|grass|wood|forest|landcover|landuse|pitch|cemetery/.test(id) ? "#15292B" : "#18243A");
        map.setPaintProperty(id, "fill-outline-color", "rgba(0,0,0,0)");
      } else if (l.type === "line") {
        map.setPaintProperty(id, "line-color",
          /water|river|stream|canal/.test(id) ? "#0E2740"
            : /motorway|trunk|primary/.test(id) ? "#5A4A22"
            : /boundary|admin/.test(id) ? "#2A3B5E"
            : "#2C3B57");
      } else if (l.type === "fill-extrusion") {
        map.setPaintProperty(id, "fill-extrusion-color", "#27385C");
        map.setPaintProperty(id, "fill-extrusion-opacity", 0.9);
      } else if (l.type === "symbol") {
        if (/poi|transit|aeroway/.test(id)) { map.setLayoutProperty(id, "visibility", "none"); continue; }
        map.setPaintProperty(id, "text-color", /motorway|trunk|primary|highway/.test(id) ? "#C9A24A" : "#A9B4CB");
        map.setPaintProperty(id, "text-halo-color", "#0F1828");
      }
    } catch { /* a layer without that property: leave it */ }
  }
  // Make sure buildings stand up even if the style only has flat ones.
  if (!layers.some((l) => l.type === "fill-extrusion") && map.getSource("openmaptiles")) {
    map.addLayer({
      id: "vh-buildings", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
      paint: {
        "fill-extrusion-color": "#27385C",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.9,
      },
    });
  }
}

function addOverlay(map: maplibregl.Map) {
  map.addSource("vh", { type: "geojson", data: { type: "FeatureCollection", features: [] } as unknown as GJ });
  const is = (k: string): maplibregl.FilterSpecification => ["==", ["get", "kind"], k];
  map.addLayer({ id: "vh-hot-fill", type: "fill", source: "vh", filter: is("hot"), paint: { "fill-color": "#E8B33A", "fill-opacity": 0.05 } });
  map.addLayer({ id: "vh-hot-line", type: "line", source: "vh", filter: is("hot"), paint: { "line-color": "#E8B33A", "line-width": 2, "line-opacity": 0.7, "line-dasharray": [1, 4] } });
  map.addLayer({ id: "vh-sight-fill", type: "fill", source: "vh", filter: is("sight"), paint: { "fill-color": "#7FC8F8", "fill-opacity": 0.06 } });
  map.addLayer({ id: "vh-sight-line", type: "line", source: "vh", filter: is("sight"), paint: { "line-color": "#7FC8F8", "line-width": 1.5, "line-opacity": 0.7 } });
  map.addLayer({ id: "vh-catch-line", type: "line", source: "vh", filter: is("catch"), paint: { "line-color": "#E8B33A", "line-width": 3, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "vh-trip", type: "line", source: "vh", filter: is("trip"), paint: { "line-color": "#E8B33A", "line-width": 4, "line-opacity": 0.85, "line-dasharray": [1, 1.5] } });
}

export default function Map3D(props: Props) {
  const { pos, dest, arrived, sightM, hotspots, retro, gps, drops, follow } = props;
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLButtonElement; img: HTMLImageElement; drop: Drop }>());
  const me = useRef<maplibregl.Marker | null>(null);
  const gpsDot = useRef<maplibregl.Marker | null>(null);
  // Latest props for the map's own event handlers and animation loop.
  const live = useRef(props);
  live.current = props;
  const cam = useRef<{ lng: number; lat: number } | null>(null);

  /* ---------- create the map once ---------- */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: el,
        style: STYLE,
        center: [pos.lng, pos.lat],
        zoom: ZOOM,
        pitch: PITCH,
        maxPitch: 85,
        minZoom: 3,
        attributionControl: { compact: true },
        // Retro renders at low resolution and lets CSS blow it up with hard pixel edges.
        ...(retro ? { pixelRatio: 0.35 } : {}),
      });
    } catch {
      live.current.onFail();
      return;
    }
    mapRef.current = map;
    let loaded = false;
    const failTimer = window.setTimeout(() => { if (!loaded) live.current.onFail(); }, 15000);

    const pad = () => map.setPadding({ top: Math.round(el.clientHeight * 0.38), bottom: 0, left: 0, right: 0 });
    map.on("load", () => {
      loaded = true;
      clearTimeout(failTimer);
      nightStyle(map);
      addOverlay(map);
      pad();
      ready.current = true;
      map.fire("vh-ready");
    });
    map.on("resize", pad);
    map.on("click", (e) => {
      const t = e.originalEvent.target as HTMLElement | null;
      if (t?.closest?.(".drop3d")) return;
      const w = e.lngLat.wrap();
      live.current.onMapTap(w.lat, w.lng);
    });
    map.on("dragstart", () => live.current.onFollowChange(false));

    const meEl = document.createElement("div");
    meEl.className = "explorer-icon";
    meEl.innerHTML = "<span></span>";
    me.current = new maplibregl.Marker({ element: meEl, pitchAlignment: "map", rotationAlignment: "map" }).setLngLat([pos.lng, pos.lat]).addTo(map);

    return () => {
      clearTimeout(failTimer);
      ready.current = false;
      markers.current.clear();
      me.current = null;
      gpsDot.current = null;
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; `key` in App remounts it when retro changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- camera: glide after the explorer, face the trip or the phone's heading ---------- */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const map = mapRef.current;
      const p = live.current;
      if (map && ready.current) {
        me.current?.setLngLat([p.pos.lng, p.pos.lat]);
        if (p.follow) {
          const c = cam.current ?? { lng: p.pos.lng, lat: p.pos.lat };
          c.lng += (p.pos.lng - c.lng) * 0.2;
          c.lat += (p.pos.lat - c.lat) * 0.2;
          cam.current = c;
          let want: number | null = null;
          if (p.dest && !p.arrived && distanceM(p.pos.lat, p.pos.lng, p.dest.lat, p.dest.lng) > 5) want = bearingDeg(p.pos.lat, p.pos.lng, p.dest.lat, p.dest.lng);
          else if (p.turnWithMe && p.compass.current.heading != null) want = p.compass.current.heading;
          const o: { center: [number, number]; bearing?: number } = { center: [c.lng, c.lat] };
          if (want != null) {
            const cur = map.getBearing();
            const d = angleDiff(want, cur);
            if (Math.abs(d) > 0.2) o.bearing = cur + d * 0.12;
          }
          const moved = Math.abs(map.getCenter().lng - c.lng) > 1e-7 || Math.abs(map.getCenter().lat - c.lat) > 1e-7;
          if (moved || o.bearing != null) map.jumpTo(o);
        } else {
          cam.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Re-center: tilt back down to street level.
  useEffect(() => {
    const map = mapRef.current;
    if (follow && map && ready.current) map.easeTo({ pitch: PITCH, zoom: ZOOM, duration: 600 });
  }, [follow]);

  /* ---------- circles, hotspots and the trip line ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      const src = map.getSource("vh") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const features = [
        ...hotspots.map((h) => poly("hot", ring(h.lat, h.lng, h.radius_m))),
        poly("sight", ring(pos.lat, pos.lng, sightM)),
        ...(arrived ? [line("catch", ring(pos.lat, pos.lng, CATCH_RADIUS_M))] : []),
        ...(dest && !arrived ? [line("trip", [[pos.lng, pos.lat], [dest.lng, dest.lat]])] : []),
      ];
      src.setData({ type: "FeatureCollection", features } as unknown as GJ);
    };
    if (ready.current) draw(); else map.once("vh-ready", draw);
  }, [pos.lat, pos.lng, dest?.lat, dest?.lng, arrived, sightM, hotspots]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- creatures: upright sprites, bigger when close ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      const seen = new Set<string>();
      for (const d of drops) {
        seen.add(d.id);
        let k = markers.current.get(d.id);
        if (!k) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "drop3d";
          el.setAttribute("aria-label", SPECIES[d.species_id]?.name ?? "Creature");
          const img = document.createElement("img");
          img.alt = "";
          el.appendChild(img);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const cur = markers.current.get(d.id);
            if (cur) live.current.onDropTap(cur.drop);
          });
          const m = new maplibregl.Marker({ element: el, anchor: "bottom", pitchAlignment: "viewport", rotationAlignment: "viewport" })
            .setLngLat([d.lng, d.lat]).addTo(map);
          k = { m, el, img, drop: d };
          markers.current.set(d.id, k);
        }
        k.drop = d;
        const src = creatureImage(d.species_id, retro ? 12 : 64);
        if (k.img.src !== src) k.img.src = src;
        const dist = distanceM(pos.lat, pos.lng, d.lat, d.lng);
        const near = arrived && dist <= CATCH_RADIUS_M;
        const rar = SPECIES[d.species_id]?.rar;
        k.el.classList.toggle("near", near);
        k.el.classList.toggle("rare", rar === "r" || rar === "l");
        k.el.style.setProperty("--s", String(Math.max(0.6, Math.min(1.6, 100 / (dist + 35)))));
      }
      for (const [id, k] of markers.current) if (!seen.has(id)) { k.m.remove(); markers.current.delete(id); }
    };
    if (ready.current) sync(); else map.once("vh-ready", sync);
  }, [drops, pos.lat, pos.lng, arrived, retro]);

  /* ---------- real GPS dot (walking bonus) ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!gps) { gpsDot.current?.remove(); gpsDot.current = null; return; }
    if (!gpsDot.current) {
      const el = document.createElement("div");
      el.className = "gps-dot";
      gpsDot.current = new maplibregl.Marker({ element: el, pitchAlignment: "map" }).setLngLat([gps.lng, gps.lat]).addTo(map);
    } else gpsDot.current.setLngLat([gps.lng, gps.lat]);
  }, [gps?.lat, gps?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="map map3d" />;
}
