/**
 * SovereigntyMap — live data-sovereignty map (R17-W3).
 *
 * Layers (all real tRPC, 60s polling, fail-closed — an offline layer is
 * hidden and marked, never fabricated):
 *   1. Cable landing points + schematic per-system polylines
 *      (trpc.infrastructureRisk.seedStatus — migration 0148 seed, provenance
 *      surfaced in the footer)
 *   2. Cable-watch vessels (trpc.infrastructureRisk.listCableAlerts —
 *      AIS anomalies near landings)
 *   3. Disaster proximity events (trpc.infrastructureRisk.listAvailabilityRisks)
 *   4. Maritime chokepoints (static geographic reference, labelled as such)
 *   5. Cross-border transfer risk (trpc.transferForecast.listForecasts —
 *      country centroids coloured by blended risk level)
 *
 * Map patterns follow client/src/components/OsirisIntelMap.tsx (maplibre-gl
 * dark-matter basemap, canvas-generated dot sprites, single shared popup).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { trpc } from "@/lib/trpc";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Anchor, Cable, Flame, Globe2, Ship, Eye, EyeOff, MapPin, RefreshCw,
} from "lucide-react";

// ─── Static geographic reference data (well-known maritime chokepoints) ──────
const CHOKEPOINTS = [
  { name: "Suez Canal", lat: 30.46, lng: 32.34 },
  { name: "Strait of Hormuz", lat: 26.55, lng: 56.25 },
  { name: "Bab el-Mandeb", lat: 12.58, lng: 43.42 },
  { name: "Strait of Malacca", lat: 1.43, lng: 102.89 },
  { name: "Strait of Gibraltar", lat: 35.97, lng: -5.49 },
  { name: "Bosphorus", lat: 41.12, lng: 29.08 },
  { name: "Cape of Good Hope", lat: -34.83, lng: 20.0 },
  { name: "Panama Canal", lat: 9.08, lng: -79.68 },
  { name: "Danish Straits", lat: 55.33, lng: 11.0 },
  { name: "Gulf of Guinea corridor", lat: 3.5, lng: 4.0 },
];

/** ISO-3166 alpha-2 → approximate country centroid (static geographic
 *  reference; forecasts for unlisted ISOs are counted and skipped). */
const ISO_CENTROIDS: Record<string, [number, number]> = {
  NG: [8.68, 9.08], GH: [-1.02, 7.95], CI: [-5.55, 7.54], SN: [-14.47, 14.5],
  BJ: [2.31, 9.32], TG: [1.19, 8.62], CM: [12.28, 5.69], KE: [37.9, 0.18],
  ZA: [24.68, -29.0], EG: [29.87, 26.49], MA: [-7.09, 31.79], ET: [39.6, 8.6],
  GB: [-2.86, 54.15], IE: [-8.15, 53.28], FR: [2.55, 46.6], DE: [10.45, 51.16],
  NL: [5.29, 52.13], BE: [4.66, 50.64], ES: [-3.65, 40.31], PT: [-8.06, 39.66],
  IT: [12.83, 41.87], CH: [8.23, 46.8], SE: [15.0, 62.0], NO: [8.79, 61.15],
  PL: [19.4, 52.12], US: [-98.35, 39.5], CA: [-106.35, 56.13], BR: [-51.93, -10.83],
  AE: [54.37, 24.1], SA: [45.08, 23.89], IL: [34.85, 31.05], IN: [78.96, 20.59],
  SG: [103.83, 1.35], JP: [138.25, 36.2], CN: [104.2, 35.86], KR: [127.98, 37.55],
  AU: [133.78, -25.27], RU: [37.62, 55.75], TR: [35.24, 38.96], QA: [51.18, 25.35],
};

type RiskLevel = "none" | "elevated" | "high" | "critical";
const RISK_COLORS: Record<RiskLevel, string> = {
  critical: "#EF4444",
  high: "#F97316",
  elevated: "#EAB308",
  none: "#10B981",
};

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface LayerDef {
  key: string;
  label: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
  /** maplibre layer ids controlled by this chip */
  mapLayers: string[];
  reference?: boolean;
}

const LAYER_DEFS: LayerDef[] = [
  { key: "cables", label: "Cable Landings", color: "#26C6DA", icon: Cable, mapLayers: ["cable-lines", "cable-points"] },
  { key: "vessels", label: "Cable-Watch Vessels", color: "#38BDF8", icon: Ship, mapLayers: ["vessel-dots"] },
  { key: "disasters", label: "Disaster Proximity", color: "#F97316", icon: Flame, mapLayers: ["disaster-halo", "disaster-dots"] },
  { key: "chokepoints", label: "Chokepoints", color: "#D4AF37", icon: Anchor, mapLayers: ["choke-dots", "choke-labels"], reference: true },
  { key: "transferRisk", label: "Transfer Risk", color: "#A78BFA", icon: Globe2, mapLayers: ["risk-halo", "risk-dots"] },
];

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export default function SovereigntyMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LAYER_DEFS.map((l) => [l.key, true])));

  // ── Live queries (60s polling, fail-closed) ──────────────────────────────
  const landings = trpc.infrastructureRisk.seedStatus.useQuery(undefined, { refetchInterval: 60_000 });
  const cableAlerts = trpc.infrastructureRisk.listCableAlerts.useQuery({ limit: 200 }, { refetchInterval: 60_000 });
  const availRisks = trpc.infrastructureRisk.listAvailabilityRisks.useQuery({ limit: 200 }, { refetchInterval: 60_000 });
  const stats = trpc.infrastructureRisk.stats.useQuery(undefined, { refetchInterval: 60_000 });
  const forecasts = trpc.transferForecast.listForecasts.useQuery({ limit: 100 }, { refetchInterval: 60_000 });

  // ── GeoJSON derivations ──────────────────────────────────────────────────
  const cableFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const pts = (landings.data?.points ?? [])
      .map((p: any) => ({ ...p, lat: num(p.latitude), lng: num(p.longitude) }))
      .filter((p: any) => p.lat !== null && p.lng !== null);
    const features: GeoJSON.Feature[] = pts.map((p: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        name: p.name, city: p.city, cable_system: p.cable_system,
        active: p.active, provenance: p.provenance,
      },
    }));
    // Schematic per-system polylines (landing points of one cable system,
    // ordered west→east — NOT surveyed cable routes). Plain object grouping
    // (Map iteration requires downlevelIteration in this tsconfig).
    const bySystem: Record<string, { lng: number; lat: number }[]> = {};
    for (const p of pts) {
      const key = String((p as any).cable_system ?? "unknown");
      (bySystem[key] ??= []).push({ lng: (p as any).lng, lat: (p as any).lat });
    }
    for (const [system, arr] of Object.entries(bySystem)) {
      if (arr.length < 2) continue;
      const coords = [...arr].sort((a, b) => a.lng - b.lng).map((c) => [c.lng, c.lat]);
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { cable_system: system, schematic: true },
      });
    }
    return { type: "FeatureCollection", features };
  }, [landings.data]);

  const vesselFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const rows = (cableAlerts.data?.rows ?? [])
      .map((r: any) => ({ ...r, lat: num(r.latitude), lng: num(r.longitude) }))
      .filter((r: any) => r.lat !== null && r.lng !== null);
    return {
      type: "FeatureCollection",
      features: rows.map((r: any) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: {
          vessel_name: r.vessel_name, vessel_mmsi: r.vessel_mmsi,
          speed_knots: r.speed_knots, vessel_status: r.vessel_status,
          cable_point_name: r.cable_point_name, cable_system: r.cable_system,
          distance_km: r.distance_km, status: r.status, last_seen_at: r.last_seen_at,
        },
      })),
    };
  }, [cableAlerts.data]);

  const disasterFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const rows = (availRisks.data?.rows ?? [])
      .map((r: any) => ({ ...r, lat: num(r.latitude), lng: num(r.longitude) }))
      .filter((r: any) => r.lat !== null && r.lng !== null);
    return {
      type: "FeatureCollection",
      features: rows.map((r: any) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: {
          location_name: r.location_name, entity_name: r.entity_name,
          event_type: r.event_type, magnitude: r.magnitude, severity: r.severity,
          distance_km: r.distance_km, status: r.status, assessed_at: r.assessed_at,
        },
      })),
    };
  }, [availRisks.data]);

  const chokeFC = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: CHOKEPOINTS.map((c) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
      properties: { name: c.name },
    })),
  }), []);

  const { riskFC, unmappedIsos } = useMemo(() => {
    const rows = (forecasts.data?.forecasts ?? []) as any[];
    const unmapped: string[] = [];
    const features: GeoJSON.Feature[] = [];
    for (const f of rows) {
      const iso = String(f.countryIso ?? "").toUpperCase();
      const c = ISO_CENTROIDS[iso];
      if (!c) { if (iso) unmapped.push(iso); continue; }
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
        properties: {
          iso, blendedLevel: f.blendedLevel as RiskLevel,
          probability: f.forecastProbability, status: f.forecastStatus,
          rationale: f.rationale, createdAt: f.createdAt,
        },
      });
    }
    return { riskFC: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection, unmappedIsos: unmapped };
  }, [forecasts.data]);

  // ── Layer online/offline bookkeeping ─────────────────────────────────────
  const layerStatus: Record<string, { online: boolean; count: number; note?: string | null }> = {
    cables: {
      online: !landings.isError && !!landings.data?.seeded,
      count: landings.data?.pointCount ?? 0,
      note: landings.isError ? "query failed" : landings.data?.note,
    },
    vessels: {
      online: !cableAlerts.isError && (cableAlerts.data?.rows?.length ?? 0) > 0,
      count: vesselFC.features.length,
      note: cableAlerts.isError ? "query failed" : cableAlerts.data?.note,
    },
    disasters: {
      online: !availRisks.isError && (availRisks.data?.rows?.length ?? 0) > 0,
      count: disasterFC.features.length,
      note: availRisks.isError ? "query failed" : availRisks.data?.note,
    },
    chokepoints: { online: true, count: CHOKEPOINTS.length, note: "static geographic reference" },
    transferRisk: {
      online: !forecasts.isError && (forecasts.data?.count ?? 0) > 0,
      count: riskFC.features.length,
      note: forecasts.isError ? "query failed" : null,
    },
  };

  // ── Map bootstrap ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [8, 5.5],
      zoom: 4.2,
      minZoom: 2,
      maxZoom: 18,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      mapRef.current = map;

      map.addSource("cables", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "cable-lines", type: "line", source: "cables",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#26C6DA", "line-width": 1.4, "line-opacity": 0.5, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "cable-points", type: "circle", source: "cables",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": ["case", ["==", ["get", "active"], true], "#26C6DA", "#64748B"],
          "circle-stroke-width": 1.2, "circle-stroke-color": "#0F172A",
        },
      });

      map.addSource("vessels", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "vessel-dots", type: "circle", source: "vessels",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "distance_km"], 10], 0, 4, 50, 9],
          "circle-color": "#38BDF8",
          "circle-opacity": 0.9, "circle-stroke-width": 1, "circle-stroke-color": "#0F172A",
        },
      });

      map.addSource("disasters", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "disaster-halo", type: "circle", source: "disasters",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "magnitude"], 2], 0, 8, 10, 26],
          "circle-color": "#F97316", "circle-opacity": 0.15,
        },
      });
      map.addLayer({
        id: "disaster-dots", type: "circle", source: "disasters",
        paint: {
          "circle-radius": 5,
          "circle-color": ["match", ["get", "severity"], "critical", "#EF4444", "high", "#F97316", "medium", "#EAB308", "#F97316"],
          "circle-stroke-width": 1, "circle-stroke-color": "#0F172A",
        },
      });

      map.addSource("chokepoints", { type: "geojson", data: chokeFC });
      map.addLayer({
        id: "choke-dots", type: "circle", source: "chokepoints",
        paint: { "circle-radius": 5, "circle-color": "#D4AF37", "circle-stroke-width": 1.2, "circle-stroke-color": "#0F172A" },
      });
      map.addLayer({
        id: "choke-labels", type: "symbol", source: "chokepoints",
        layout: {
          "text-field": ["get", "name"], "text-size": 10,
          "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true,
        },
        paint: { "text-color": "#D4AF37", "text-halo-color": "#0F172A", "text-halo-width": 1 },
      });

      map.addSource("transferRisk", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "risk-halo", type: "circle", source: "transferRisk",
        paint: {
          "circle-radius": 18,
          "circle-color": ["match", ["get", "blendedLevel"],
            "critical", RISK_COLORS.critical, "high", RISK_COLORS.high,
            "elevated", RISK_COLORS.elevated, RISK_COLORS.none],
          "circle-opacity": 0.18,
        },
      });
      map.addLayer({
        id: "risk-dots", type: "circle", source: "transferRisk",
        paint: {
          "circle-radius": 6,
          "circle-color": ["match", ["get", "blendedLevel"],
            "critical", RISK_COLORS.critical, "high", RISK_COLORS.high,
            "elevated", RISK_COLORS.elevated, RISK_COLORS.none],
          "circle-stroke-width": 1.2, "circle-stroke-color": "#0F172A",
        },
      });

      // ── Shared popup ──
      const popup = new maplibregl.Popup({ closeButton: false, className: "sov-popup", maxWidth: "300px" });
      const bind = (layerId: string, render: (p: any) => string) => {
        map.on("click", layerId, (e) => {
          const p = e.features?.[0]?.properties;
          if (p) popup.setLngLat(e.lngLat).setHTML(render(p)).addTo(map);
        });
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      };
      bind("cable-points", (p) => `<div class="sov-tip"><strong>${escapeHtml(p.name)}</strong><br/><span class="muted">${escapeHtml(p.cable_system)} — ${escapeHtml(p.city ?? "")}</span><br/><span class="dim">${p.active ? "active" : "inactive"} landing</span></div>`);
      bind("cable-lines", (p) => `<div class="sov-tip"><strong>${escapeHtml(p.cable_system)}</strong><br/><span class="dim">schematic path (landing points only, not a surveyed route)</span></div>`);
      bind("vessel-dots", (p) => `<div class="sov-tip"><strong>${escapeHtml(p.vessel_name ?? "Unknown vessel")}</strong><br/><span class="muted">MMSI ${escapeHtml(p.vessel_mmsi)} — ${escapeHtml(p.vessel_status ?? "")} @ ${escapeHtml(p.speed_knots ?? "?")} kn</span><br/><span class="dim">${escapeHtml(p.distance_km ?? "?")} km from ${escapeHtml(p.cable_point_name ?? "")} (${escapeHtml(p.cable_system ?? "")}) — ${escapeHtml(p.status)}</span></div>`);
      bind("disaster-dots", (p) => `<div class="sov-tip"><strong>${escapeHtml(p.event_type)} — ${escapeHtml(p.severity)}</strong><br/><span class="muted">${escapeHtml(p.location_name)} (${escapeHtml(p.entity_name ?? "")})</span><br/><span class="dim">magnitude ${escapeHtml(p.magnitude ?? "?")}, ${escapeHtml(p.distance_km ?? "?")} km away — ${escapeHtml(p.status)}</span></div>`);
      bind("choke-dots", (p) => `<div class="sov-tip"><strong>${escapeHtml(p.name)}</strong><br/><span class="dim">maritime chokepoint (geographic reference)</span></div>`);
      bind("risk-dots", (p) => `<div class="sov-tip"><strong>${escapeHtml(p.iso)} — ${escapeHtml(p.blendedLevel)}</strong><br/><span class="muted">12-month disruption probability: ${p.probability != null ? `${Math.round(Number(p.probability) * 100)}%` : "n/a"} (${escapeHtml(p.status)})</span><br/><span class="dim">${escapeHtml(p.rationale ?? "")}</span></div>`);

      setMapReady(true);
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [chokeFC]);

  // ── Push query data into sources ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;
    const set = (id: string, fc: GeoJSON.FeatureCollection) => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(fc);
    };
    set("cables", cableFC);
    set("vessels", vesselFC);
    set("disasters", disasterFC);
    set("transferRisk", riskFC);
  }, [cableFC, vesselFC, disasterFC, riskFC, mapReady]);

  // ── Chip visibility (offline layers stay hidden) ─────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;
    for (const def of LAYER_DEFS) {
      const visible = active[def.key] !== false && layerStatus[def.key]?.online !== false;
      for (const id of def.mapLayers) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mapReady, landings.data, cableAlerts.data, availRisks.data, forecasts.data]);

  // ── Stat strip values ────────────────────────────────────────────────────
  const probs = ((forecasts.data?.forecasts ?? []) as any[])
    .map((f) => (f.forecastProbability != null ? Number(f.forecastProbability) : null))
    .filter((p): p is number => p !== null);
  const avgProb = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
  const statCards = [
    { label: "Cable landings", value: landings.data ? `${landings.data.pointCount}/${landings.data.expectedCount}` : "—", sub: landings.data?.seeded ? "seeded" : (landings.data?.note ?? "loading") },
    { label: "Cable alerts (open)", value: stats.data ? String(stats.data.cable.open) : "—", sub: stats.data?.note ?? "vessel anomalies" },
    { label: "Disaster risks (open)", value: stats.data ? String(stats.data.availability.open) : "—", sub: "declared DC locations" },
    { label: "Tracked vessels", value: String(vesselFC.features.length), sub: "with coordinates" },
    { label: "Countries forecast", value: forecasts.data ? String(forecasts.data.count) : "—", sub: "latest readings" },
    { label: "Avg 12-mo probability", value: avgProb !== null ? `${Math.round(avgProb * 100)}%` : "—", sub: "transfer disruption" },
  ];

  return (
    <PageShell>
      <Breadcrumbs items={[{ label: "Intelligence" }, { label: "Sovereignty Map" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" /> Sovereignty Map
          </h1>
          <p className="text-sm text-muted-foreground">
            Live cable infrastructure, vessel anomalies, disaster proximity and cross-border transfer risk.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <RefreshCw className="h-3 w-3" /> 60s auto-refresh
        </Badge>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="text-xl font-bold text-foreground">{s.value}</div>
              <div className="text-[10px] text-muted-foreground truncate">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Layer chips */}
      <div className="flex flex-wrap gap-2">
        {LAYER_DEFS.map((def) => {
          const st = layerStatus[def.key];
          const on = active[def.key] !== false && st.online;
          const Icon = def.icon;
          return (
            <button
              key={def.key}
              onClick={() => setActive((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                on ? "bg-card border-border" : "opacity-50 border-border"
              }`}
              title={st.online ? `${st.count} feature(s)` : `layer offline — hidden, not fabricated${st.note ? ` (${st.note})` : ""}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.online ? def.color : "#64748B" }} />
              <Icon className="h-3.5 w-3.5" />
              <span className="font-medium">{def.label}</span>
              <span className="text-muted-foreground">{st.online ? st.count : "offline"}</span>
              {on ? <Eye className="h-3 w-3 text-muted-foreground" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
            </button>
          );
        })}
      </div>

      {/* Map */}
      <div className="relative h-[560px] rounded-lg border overflow-hidden bg-[#0f1115]">
        <div ref={containerRef} className="w-full h-full" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="animate-pulse text-muted-foreground text-sm">Initializing sovereignty map…</div>
          </div>
        )}
      </div>

      {/* Provenance footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <div>
            <strong className="text-foreground">Cable landing provenance:</strong>{" "}
            {landings.data?.provenance ?? "not seeded — cable layer offline (migration 0148)"}
            {landings.data?.missingSystems?.length ? (
              <span> — missing systems: {landings.data.missingSystems.join(", ")}</span>
            ) : null}
          </div>
          <div>
            Cable polylines are schematic (same-system landing points only, not surveyed routes).
            Chokepoints are static geographic reference data.
            {unmappedIsos.length > 0 && (
              <span> Transfer-risk readings skipped for unmapped ISO codes: {Array.from(new Set(unmappedIsos)).join(", ")}.</span>
            )}
          </div>
          <div>
            Sources: infrastructureRisk.seedStatus / listCableAlerts / listAvailabilityRisks / stats,
            transferForecast.listForecasts — any offline layer is hidden, never fabricated.
          </div>
        </CardContent>
      </Card>

      <style>{`
        .sov-popup .maplibregl-popup-content {
          background: rgba(10, 15, 30, 0.95);
          border: 1px solid rgba(100, 116, 139, 0.3);
          border-radius: 8px;
          padding: 0;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        }
        .sov-popup .maplibregl-popup-tip { border-top-color: rgba(10, 15, 30, 0.95); }
        .sov-tip { color: #fff; font-size: 12px; padding: 8px 12px; line-height: 1.4; }
        .sov-tip strong { font-size: 13px; display: block; margin-bottom: 2px; }
        .sov-tip .muted { color: #94a3b8; font-size: 11px; }
        .sov-tip .dim { color: #64748b; font-size: 10px; display: block; margin-top: 2px; }
      `}</style>
    </PageShell>
  );
}
