import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Plane, Ship, Camera, Activity, AlertTriangle, Satellite,
  Radio, Flame, Shield, Anchor, Eye, EyeOff,
} from "lucide-react";

// ══════════════════════════════════════════════════════════════════════════════
// NIGERIA-CENTRIC INTELLIGENCE DATA
// ══════════════════════════════════════════════════════════════════════════════

// Nigerian security hotspots
const NIGERIAN_SECURITY_ZONES = [
  { name: "Borno — Boko Haram", lat: 11.85, lng: 13.16, severity: "active_war", region: "Northeast Nigeria", description: "Active insurgency, Sambisa Forest operations" },
  { name: "Zamfara — Banditry", lat: 12.17, lng: 6.22, severity: "active_war", region: "Northwest Nigeria", description: "Armed banditry, kidnappings" },
  { name: "Kaduna — Conflict", lat: 10.52, lng: 7.43, severity: "high_tension", region: "Northwest Nigeria", description: "Farmer-herder clashes, banditry" },
  { name: "Rivers — Militancy", lat: 4.82, lng: 7.03, severity: "high_tension", region: "Niger Delta", description: "Oil infrastructure threats, pipeline vandalism" },
  { name: "Niger State — Bandits", lat: 9.61, lng: 5.52, severity: "high_tension", region: "North Central", description: "Armed banditry, kidnappings" },
  { name: "Plateau — Clashes", lat: 9.90, lng: 8.89, severity: "monitoring", region: "North Central", description: "Communal violence, farmer-herder conflicts" },
  { name: "Imo — ESN/IPOB", lat: 5.48, lng: 7.03, severity: "monitoring", region: "Southeast Nigeria", description: "Separatist agitation, sit-at-home enforcement" },
  { name: "Katsina — Banditry", lat: 12.99, lng: 7.60, severity: "high_tension", region: "Northwest Nigeria", description: "Cross-border banditry" },
  { name: "Benue — Herders", lat: 7.73, lng: 8.52, severity: "monitoring", region: "North Central", description: "Farmer-herder violence" },
  { name: "Lagos — Urban Crime", lat: 6.52, lng: 3.38, severity: "monitoring", region: "Southwest Nigeria", description: "Urban security concerns, cybercrime" },
];

// Nigerian maritime (Gulf of Guinea, Niger Delta)
const NIGERIAN_MARITIME = [
  { name: "Lagos Port (Apapa)", lat: 6.44, lng: 3.38, type: "port", vessels: 45 },
  { name: "Tin Can Island Port", lat: 6.43, lng: 3.35, type: "port", vessels: 32 },
  { name: "Port Harcourt (Onne)", lat: 4.72, lng: 7.16, type: "port", vessels: 28 },
  { name: "Warri Port", lat: 5.52, lng: 5.73, type: "port", vessels: 15 },
  { name: "Calabar Port", lat: 4.96, lng: 8.33, type: "port", vessels: 12 },
  { name: "Bonny Terminal (NLNG)", lat: 4.42, lng: 7.17, type: "terminal", vessels: 8 },
  { name: "Escravos Terminal", lat: 5.59, lng: 5.18, type: "terminal", vessels: 6 },
  { name: "Brass Terminal", lat: 4.31, lng: 6.24, type: "terminal", vessels: 5 },
  { name: "Forcados Terminal", lat: 5.35, lng: 5.35, type: "terminal", vessels: 7 },
  { name: "Gulf of Guinea Patrol", lat: 3.5, lng: 4.0, type: "patrol", vessels: 3 },
  { name: "Lekki Deep Sea Port", lat: 6.38, lng: 4.01, type: "port", vessels: 18 },
  { name: "Niger Delta Waterways", lat: 4.85, lng: 6.30, type: "patrol", vessels: 4 },
];

// Nigerian aviation hubs
const NIGERIAN_AVIATION = [
  { name: "MMIA Lagos", lat: 6.58, lng: 3.32, code: "LOS", flights: 187, type: "international" },
  { name: "Nnamdi Azikiwe Abuja", lat: 9.01, lng: 7.26, code: "ABV", flights: 142, type: "international" },
  { name: "Mallam Aminu Kano", lat: 12.05, lng: 8.52, code: "KAN", flights: 68, type: "international" },
  { name: "Port Harcourt Intl", lat: 5.02, lng: 6.95, code: "PHC", flights: 54, type: "domestic" },
  { name: "Akanu Ibiam Enugu", lat: 6.47, lng: 7.56, code: "ENU", flights: 32, type: "domestic" },
  { name: "Sam Mbakwe Owerri", lat: 5.43, lng: 7.21, code: "QOW", flights: 28, type: "domestic" },
  { name: "Ibadan Airport", lat: 7.36, lng: 3.98, code: "IBA", flights: 14, type: "domestic" },
  { name: "Kaduna Airport", lat: 10.70, lng: 7.32, code: "KAD", flights: 22, type: "military" },
  { name: "Maiduguri Airport", lat: 11.86, lng: 13.08, code: "MIU", flights: 8, type: "military" },
  { name: "Makurdi Airbase", lat: 7.70, lng: 8.61, code: "MDI", flights: 6, type: "military" },
];

// Nigerian CCTV / surveillance zones
const NIGERIAN_CCTV = [
  { name: "Lagos Island CCTV", lat: 6.45, lng: 3.40, cameras: 320, status: "active" },
  { name: "Abuja CBD CCTV", lat: 9.06, lng: 7.49, cameras: 280, status: "active" },
  { name: "Lekki/VI Corridor", lat: 6.43, lng: 3.47, cameras: 150, status: "active" },
  { name: "Kano Metro CCTV", lat: 12.00, lng: 8.52, cameras: 95, status: "partial" },
  { name: "Port Harcourt Urban", lat: 4.77, lng: 7.01, cameras: 78, status: "active" },
  { name: "Abuja Airport Ring", lat: 9.01, lng: 7.26, cameras: 64, status: "active" },
  { name: "Oyo/Ibadan Metro", lat: 7.38, lng: 3.93, cameras: 45, status: "partial" },
  { name: "Kaduna Urban", lat: 10.52, lng: 7.43, cameras: 38, status: "partial" },
];

// ══════════════════════════════════════════════════════════════════════════════
// LAYER DEFINITIONS (matching Osiris layer panel structure)
// ══════════════════════════════════════════════════════════════════════════════

export interface LayerConfig {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  group: string;
  defaultOn: boolean;
}

export const OSIRIS_LAYERS: LayerConfig[] = [
  { key: "conflicts", label: "Security Zones", icon: AlertTriangle, color: "#EF4444", group: "THREAT", defaultOn: true },
  { key: "aviation", label: "Aviation", icon: Plane, color: "#00E5FF", group: "AVIATION", defaultOn: true },
  { key: "maritime", label: "Maritime", icon: Ship, color: "#26C6DA", group: "MARITIME", defaultOn: true },
  { key: "cctv", label: "CCTV / Surveillance", icon: Camera, color: "#7E57C2", group: "SURVEIL", defaultOn: true },
  { key: "satellites", label: "Satellites", icon: Satellite, color: "#D4AF37", group: "SPACE", defaultOn: false },
  { key: "hazards", label: "Natural Hazards", icon: Flame, color: "#F9A825", group: "HAZARD", defaultOn: false },
  { key: "cyber", label: "Cyber Threats", icon: Shield, color: "#D32F2F", group: "NETWORK", defaultOn: true },
  { key: "sanctions", label: "Sanctions Intel", icon: Radio, color: "#FF9800", group: "SANCTIONS", defaultOn: false },
];

interface OsirisIntelMapProps {
  className?: string;
  style?: React.CSSProperties;
  activeLayers?: Record<string, boolean>;
  onLayerToggle?: (key: string) => void;
  compact?: boolean;
}

export function OsirisIntelMap({ className, style, activeLayers: externalLayers, onLayerToggle, compact }: OsirisIntelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [internalLayers, setInternalLayers] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    OSIRIS_LAYERS.forEach(l => { init[l.key] = l.defaultOn; });
    return init;
  });

  const layers = externalLayers ?? internalLayers;
  const toggleLayer = (key: string) => {
    if (onLayerToggle) {
      onLayerToggle(key);
    } else {
      setInternalLayers(prev => ({ ...prev, [key]: !prev[key] }));
    }
  };

  // Create dot image for map markers
  const createDot = useCallback((map: maplibregl.Map, id: string, color: string, size: number) => {
    if (map.hasImage(id)) return;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 4;
    ctx.shadowColor = color;
    ctx.fill();
    map.addImage(id, { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data) });
  }, []);

  // Create plane icon
  const createPlane = useCallback((map: maplibregl.Map, id: string, color: string) => {
    if (map.hasImage(id)) return;
    const size = 20;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    const cx = size / 2, cy = size / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.4);
    ctx.lineTo(cx - size * 0.12, cy + size * 0.1);
    ctx.lineTo(cx - size * 0.4, cy + size * 0.2);
    ctx.lineTo(cx - size * 0.4, cy + size * 0.3);
    ctx.lineTo(cx - size * 0.12, cy + size * 0.15);
    ctx.lineTo(cx, cy + size * 0.35);
    ctx.lineTo(cx + size * 0.12, cy + size * 0.15);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.3);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.2);
    ctx.lineTo(cx + size * 0.12, cy + size * 0.1);
    ctx.closePath();
    ctx.fill();
    map.addImage(id, { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data) });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [7.5, 9.0], // Center on Nigeria
      zoom: 5.8,
      minZoom: 4,
      maxZoom: 18,
      attributionControl: false,
      maxPitch: 60,
    });

    map.on("load", () => {
      mapRef.current = map;

      // Create marker icons
      createDot(map, "dot-red", "#EF4444", 14);
      createDot(map, "dot-orange", "#F97316", 12);
      createDot(map, "dot-yellow", "#EAB308", 10);
      createDot(map, "dot-cyan", "#26C6DA", 10);
      createDot(map, "dot-purple", "#7E57C2", 8);
      createPlane(map, "plane-cyan", "#00E5FF");
      createPlane(map, "plane-gold", "#FFD700");
      createPlane(map, "plane-red", "#FF3D3D");

      // ── CONFLICTS / SECURITY ZONES ──
      map.addSource("conflicts", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: NIGERIAN_SECURITY_ZONES.map(z => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [z.lng, z.lat] },
            properties: { name: z.name, severity: z.severity, region: z.region, description: z.description },
          })),
        },
      });
      map.addLayer({
        id: "conflicts-pulse",
        type: "circle",
        source: "conflicts",
        paint: {
          "circle-radius": ["case", ["==", ["get", "severity"], "active_war"], 22, ["==", ["get", "severity"], "high_tension"], 16, 10],
          "circle-color": ["case", ["==", ["get", "severity"], "active_war"], "#EF4444", ["==", ["get", "severity"], "high_tension"], "#F97316", "#EAB308"],
          "circle-opacity": 0.12,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": ["case", ["==", ["get", "severity"], "active_war"], "#EF4444", "#F97316"],
          "circle-stroke-opacity": 0.5,
        },
      });
      map.addLayer({
        id: "conflicts-core",
        type: "circle",
        source: "conflicts",
        paint: {
          "circle-radius": ["case", ["==", ["get", "severity"], "active_war"], 7, ["==", ["get", "severity"], "high_tension"], 5, 4],
          "circle-color": ["case", ["==", ["get", "severity"], "active_war"], "#EF4444", ["==", ["get", "severity"], "high_tension"], "#F97316", "#EAB308"],
          "circle-opacity": 0.95,
        },
      });

      // ── MARITIME (Nigeria / Gulf of Guinea) ──
      map.addSource("maritime", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: NIGERIAN_MARITIME.map(m => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
            properties: { name: m.name, type: m.type, vessels: m.vessels },
          })),
        },
      });
      map.addLayer({
        id: "maritime-glow",
        type: "circle",
        source: "maritime",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "vessels"], 3, 8, 45, 20],
          "circle-color": "#26C6DA",
          "circle-opacity": 0.1,
        },
      });
      map.addLayer({
        id: "maritime-dots",
        type: "circle",
        source: "maritime",
        paint: {
          "circle-radius": ["case", ["==", ["get", "type"], "port"], 5, ["==", ["get", "type"], "terminal"], 4, 3],
          "circle-color": "#26C6DA",
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#B2EBF2",
          "circle-stroke-opacity": 0.5,
        },
      });

      // ── AVIATION (Nigerian airports) ──
      map.addSource("aviation", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: NIGERIAN_AVIATION.map(a => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [a.lng, a.lat] },
            properties: { name: a.name, code: a.code, flights: a.flights, type: a.type },
          })),
        },
      });
      map.addLayer({
        id: "aviation-heatzone",
        type: "circle",
        source: "aviation",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "flights"], 6, 10, 190, 30],
          "circle-color": ["case", ["==", ["get", "type"], "military"], "#FF3D3D", ["==", ["get", "type"], "international"], "#00E5FF", "#FFD700"],
          "circle-opacity": 0.08,
        },
      });
      map.addLayer({
        id: "aviation-symbols",
        type: "symbol",
        source: "aviation",
        layout: {
          "icon-image": ["case", ["==", ["get", "type"], "military"], "plane-red", ["==", ["get", "type"], "international"], "plane-cyan", "plane-gold"],
          "icon-size": 1,
          "icon-allow-overlap": true,
        },
      });

      // ── CCTV / SURVEILLANCE ──
      map.addSource("cctv", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: NIGERIAN_CCTV.map(c => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
            properties: { name: c.name, cameras: c.cameras, status: c.status },
          })),
        },
      });
      map.addLayer({
        id: "cctv-glow",
        type: "circle",
        source: "cctv",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "cameras"], 38, 10, 320, 24],
          "circle-color": "#7E57C2",
          "circle-opacity": 0.1,
        },
      });
      map.addLayer({
        id: "cctv-dots",
        type: "circle",
        source: "cctv",
        paint: {
          "circle-radius": 4,
          "circle-color": ["case", ["==", ["get", "status"], "active"], "#7E57C2", "#9E9E9E"],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#CE93D8",
          "circle-stroke-opacity": 0.5,
        },
      });

      // ── POPUPS ──
      const popup = new maplibregl.Popup({ closeButton: false, className: "osiris-popup", maxWidth: "280px" });

      map.on("click", "conflicts-core", (e) => {
        const p = e.features?.[0]?.properties;
        if (p) popup.setLngLat(e.lngLat).setHTML(`<div class="osiris-tip"><strong>${p.name}</strong><br/><span class="region">${p.region}</span><br/><span class="desc">${p.description}</span></div>`).addTo(map);
      });
      map.on("click", "maritime-dots", (e) => {
        const p = e.features?.[0]?.properties;
        if (p) popup.setLngLat(e.lngLat).setHTML(`<div class="osiris-tip"><strong>${p.name}</strong><br/><span class="region">${p.type} — ${p.vessels} vessels</span></div>`).addTo(map);
      });
      map.on("click", "aviation-symbols", (e) => {
        const p = e.features?.[0]?.properties;
        if (p) popup.setLngLat(e.lngLat).setHTML(`<div class="osiris-tip"><strong>${p.name} (${p.code})</strong><br/><span class="region">${p.type} — ${p.flights} flights/day</span></div>`).addTo(map);
      });
      map.on("click", "cctv-dots", (e) => {
        const p = e.features?.[0]?.properties;
        if (p) popup.setLngLat(e.lngLat).setHTML(`<div class="osiris-tip"><strong>${p.name}</strong><br/><span class="region">${p.cameras} cameras — ${p.status}</span></div>`).addTo(map);
      });

      // Cursor
      ["conflicts-core", "maritime-dots", "aviation-symbols", "cctv-dots"].forEach(id => {
        map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
      });

      setMapReady(true);
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [createDot, createPlane]);

  // Toggle layer visibility when activeLayers change
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;

    const layerMap: Record<string, string[]> = {
      conflicts: ["conflicts-pulse", "conflicts-core"],
      maritime: ["maritime-glow", "maritime-dots"],
      aviation: ["aviation-heatzone", "aviation-symbols"],
      cctv: ["cctv-glow", "cctv-dots"],
    };

    Object.entries(layerMap).forEach(([key, ids]) => {
      const visible = layers[key] !== false;
      ids.forEach(id => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      });
    });
  }, [layers, mapReady]);

  return (
    <div className={`relative ${className ?? ""}`} style={style}>
      {/* Map */}
      <div ref={containerRef} className="w-full h-full rounded-lg" />

      {/* Layer Toggle Panel (Osiris-style) */}
      {!compact && (
        <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 bg-background/90 backdrop-blur-sm rounded-lg border p-2 shadow-lg">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground px-1 pb-1">Layers</span>
          {OSIRIS_LAYERS.filter(l => ["conflicts", "aviation", "maritime", "cctv"].includes(l.key)).map((layer) => {
            const active = layers[layer.key] !== false;
            const Icon = layer.icon;
            return (
              <button
                key={layer.key}
                onClick={() => toggleLayer(layer.key)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all ${active ? "bg-card" : "opacity-40"}`}
                aria-label={`Toggle ${layer.label}`}
              >
                <span style={{ color: active ? layer.color : undefined }}><Icon className="w-3.5 h-3.5" /></span>
                <span className="font-medium">{layer.label}</span>
                {active ? <Eye className="w-3 h-3 ml-auto text-muted-foreground" /> : <EyeOff className="w-3 h-3 ml-auto text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Status bar (Osiris-style bottom bar) */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-3 bg-background/90 backdrop-blur-sm rounded-lg border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-medium text-muted-foreground">LIVE</span>
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          <span><strong className="text-foreground">{NIGERIAN_AVIATION.reduce((s, a) => s + a.flights, 0)}</strong> flights</span>
          <span><strong className="text-foreground">{NIGERIAN_MARITIME.reduce((s, m) => s + m.vessels, 0)}</strong> vessels</span>
          <span><strong className="text-foreground">{NIGERIAN_CCTV.reduce((s, c) => s + c.cameras, 0)}</strong> cameras</span>
          <span><strong className="text-foreground">{NIGERIAN_SECURITY_ZONES.length}</strong> zones</span>
        </div>
        <div className="ml-auto text-[10px] text-muted-foreground font-mono">
          9.06°N 7.49°E
        </div>
      </div>

      {/* Loading state */}
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
          <div className="animate-pulse text-muted-foreground text-sm">Initializing OSIRIS Intel Map...</div>
        </div>
      )}

      <style>{`
        .osiris-popup .maplibregl-popup-content {
          background: rgba(10, 15, 30, 0.95);
          border: 1px solid rgba(100, 116, 139, 0.3);
          border-radius: 8px;
          padding: 0;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        }
        .osiris-popup .maplibregl-popup-tip {
          border-top-color: rgba(10, 15, 30, 0.95);
        }
        .osiris-tip {
          color: #fff;
          font-size: 12px;
          padding: 8px 12px;
          line-height: 1.4;
        }
        .osiris-tip strong {
          font-size: 13px;
          display: block;
          margin-bottom: 2px;
        }
        .osiris-tip .region {
          color: #94a3b8;
          font-size: 11px;
        }
        .osiris-tip .desc {
          color: #64748b;
          font-size: 10px;
          display: block;
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER TOGGLE PANEL (standalone, for PWA sidebar use)
// ══════════════════════════════════════════════════════════════════════════════

interface OsirisLayerPanelProps {
  activeLayers: Record<string, boolean>;
  onToggle: (key: string) => void;
  className?: string;
}

export function OsirisLayerPanel({ activeLayers, onToggle, className }: OsirisLayerPanelProps) {
  const groups = [
    { label: "THREAT", color: "#EF4444", layers: OSIRIS_LAYERS.filter(l => l.group === "THREAT") },
    { label: "AVIATION", color: "#00E5FF", layers: OSIRIS_LAYERS.filter(l => l.group === "AVIATION") },
    { label: "MARITIME", color: "#26C6DA", layers: OSIRIS_LAYERS.filter(l => l.group === "MARITIME") },
    { label: "SURVEIL", color: "#7E57C2", layers: OSIRIS_LAYERS.filter(l => l.group === "SURVEIL") },
    { label: "SPACE", color: "#D4AF37", layers: OSIRIS_LAYERS.filter(l => l.group === "SPACE") },
    { label: "HAZARD", color: "#F9A825", layers: OSIRIS_LAYERS.filter(l => l.group === "HAZARD") },
    { label: "NETWORK", color: "#D32F2F", layers: OSIRIS_LAYERS.filter(l => l.group === "NETWORK") },
    { label: "SANCTIONS", color: "#FF9800", layers: OSIRIS_LAYERS.filter(l => l.group === "SANCTIONS") },
  ];

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      {groups.map(g => (
        <div key={g.label}>
          <div className="text-[9px] font-bold tracking-widest pb-1 border-b border-border/50 mb-1.5" style={{ color: g.color }}>{g.label}</div>
          {g.layers.map(layer => {
            const active = activeLayers[layer.key] !== false;
            const Icon = layer.icon;
            return (
              <button
                key={layer.key}
                onClick={() => onToggle(layer.key)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all ${active ? "bg-card" : "opacity-40"}`}
                aria-label={`Toggle ${layer.label}`}
              >
                <span style={{ color: active ? layer.color : undefined }}><Icon className="w-3.5 h-3.5" /></span>
                <span className="font-medium">{layer.label}</span>
                {active ? <Eye className="w-3 h-3 ml-auto text-muted-foreground" /> : <EyeOff className="w-3 h-3 ml-auto text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
