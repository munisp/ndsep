/// <reference types="@types/google.maps" />
import { useRef, useEffect } from "react";
import { MapView } from "@/components/Map";

// Organization locations with compliance data for the heatmap
// These represent national organizations under sovereignty enforcement
const ORG_LOCATIONS = [
  { name: "National Bank", lat: 3.1478, lng: 101.6953, compliance: 85, sector: "finance", status: "compliant" },
  { name: "Telecom Alpha", lat: 3.1319, lng: 101.6841, compliance: 42, sector: "telecom", status: "non_compliant" },
  { name: "HealthNet Systems", lat: 3.1569, lng: 101.7123, compliance: 91, sector: "healthcare", status: "compliant" },
  { name: "EduCloud Platform", lat: 3.0738, lng: 101.5183, compliance: 67, sector: "education", status: "under_review" },
  { name: "DefenceCore Ltd", lat: 3.1478, lng: 101.7093, compliance: 78, sector: "defence", status: "compliant" },
  { name: "FinTech Gateway", lat: 3.1612, lng: 101.7195, compliance: 55, sector: "finance", status: "under_review" },
  { name: "DataVault Corp", lat: 3.0850, lng: 101.6330, compliance: 33, sector: "tech", status: "non_compliant" },
  { name: "GovCloud Services", lat: 3.1390, lng: 101.6869, compliance: 96, sector: "government", status: "compliant" },
];

// Cross-border data flow lines (source → destination)
const CROSS_BORDER_FLOWS = [
  { from: { lat: 3.1319, lng: 101.6841 }, to: { lat: 1.3521, lng: 103.8198 }, label: "SG egress", blocked: false },
  { from: { lat: 3.0850, lng: 101.6330 }, to: { lat: 37.7749, lng: -122.4194 }, label: "US egress", blocked: true },
  { from: { lat: 3.1612, lng: 101.7195 }, to: { lat: 51.5074, lng: -0.1278 }, label: "UK egress", blocked: false },
];

function getComplianceColor(score: number): string {
  if (score >= 80) return "#00c896"; // green - compliant
  if (score >= 60) return "#f59e0b"; // amber - under review
  return "#ef4444"; // red - non-compliant
}

interface ComplianceHeatmapProps {
  className?: string;
  showFlows?: boolean;
  height?: string;
}

export function ComplianceHeatmap({ className = "", showFlows = true, height = "h-[420px]" }: ComplianceHeatmapProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const handleMapReady = (map: google.maps.Map) => {
    mapRef.current = map;

    // Apply dark blueprint-style map styling
    map.setOptions({
      styles: [
        { elementType: "geometry", stylers: [{ color: "#0a1628" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#0a1628" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#4a7fa5" }] },
        { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1e3a5f" }] },
        { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#2d6a9f" }] },
        { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#0d1f35" }] },
        { featureType: "poi", elementType: "geometry", stylers: [{ color: "#0d1f35" }] },
        { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#2d6a9f" }] },
        { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0d1f35" }] },
        { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#1e5f74" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a3a5c" }] },
        { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0a2040" }] },
        { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#3d7ab5" }] },
        { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e4a7a" }] },
        { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0a2040" }] },
        { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#4a8fc0" }] },
        { featureType: "transit", elementType: "geometry", stylers: [{ color: "#0d1f35" }] },
        { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#2d6a9f" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#061525" }] },
        { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#1a4a7a" }] },
        { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#061525" }] },
      ],
    });

    // Add organization markers with compliance-colored circles
    ORG_LOCATIONS.forEach((org) => {
      const color = getComplianceColor(org.compliance);
      const markerEl = document.createElement("div");
      markerEl.style.cssText = `
        width: 48px; height: 48px; border-radius: 50%;
        background: ${color}22; border: 2px solid ${color};
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; position: relative;
        box-shadow: 0 0 12px ${color}66;
        transition: transform 0.2s;
      `;
      // XSS-safe: build DOM nodes instead of innerHTML for user-controlled data
      const scoreWrapper = document.createElement("div");
      scoreWrapper.style.cssText = "text-align:center;";
      const scoreNum = document.createElement("div");
      scoreNum.style.cssText = `font-size:11px; font-weight:700; color:${color}; font-family:monospace;`;
      scoreNum.textContent = String(org.compliance);
      const scoreLabel = document.createElement("div");
      scoreLabel.style.cssText = `font-size:7px; color:${color}99; font-family:monospace;`;
      scoreLabel.textContent = "SCORE";
      scoreWrapper.appendChild(scoreNum);
      scoreWrapper.appendChild(scoreLabel);
      markerEl.appendChild(scoreWrapper);

      // Tooltip on hover
      const tooltip = document.createElement("div");
      tooltip.style.cssText = `
        position: absolute; bottom: 54px; left: 50%; transform: translateX(-50%);
        background: #0a1628ee; border: 1px solid ${color}66; border-radius: 4px;
        padding: 6px 10px; white-space: nowrap; pointer-events: none;
        font-family: monospace; font-size: 10px; color: #e0f0ff;
        display: none; z-index: 1000;
      `;
      // XSS-safe: use textContent for all user-controlled org fields
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = org.name;
      const brNode = document.createElement("br");
      const detailText = document.createTextNode(`${org.sector.toUpperCase()} · ${org.status.replace("_", " ").toUpperCase()}`);
      tooltip.appendChild(nameStrong);
      tooltip.appendChild(brNode);
      tooltip.appendChild(detailText);
      markerEl.appendChild(tooltip);

      markerEl.addEventListener("mouseenter", () => {
        tooltip.style.display = "block";
        markerEl.style.transform = "scale(1.2)";
      });
      markerEl.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
        markerEl.style.transform = "scale(1)";
      });

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: org.lat, lng: org.lng },
        content: markerEl,
        title: org.name,
      });
      markersRef.current.push(marker);
    });

    // Draw cross-border data flow lines
    if (showFlows) {
      CROSS_BORDER_FLOWS.forEach((flow) => {
        const color = flow.blocked ? "#ef4444" : "#f59e0b";
        const polyline = new google.maps.Polyline({
          path: [flow.from, flow.to],
          geodesic: true,
          strokeColor: color,
          strokeOpacity: 0.7,
          strokeWeight: flow.blocked ? 2 : 1.5,
          icons: [{
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 3,
              strokeColor: color,
              fillColor: color,
              fillOpacity: 0.8,
            },
            offset: "50%",
          }],
          map,
        });
        polylinesRef.current.push(polyline);
      });
    }
  };

  return (
    <div className={`relative ${className}`}>
      <MapView
        className={height}
        initialCenter={{ lat: 3.1478, lng: 101.6953 }}
        initialZoom={11}
        onMapReady={handleMapReady}
      />
      {/* Legend overlay */}
      <div className="absolute bottom-3 left-3 bg-card/95 border border-border rounded p-2 text-[10px] font-mono space-y-1">
        <div className="text-muted-foreground font-semibold mb-1">COMPLIANCE LEGEND</div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
          <span className="text-foreground/80">≥80 Compliant</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
          <span className="text-foreground/80">60–79 Under Review</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
          <span className="text-foreground/80">&lt;60 Non-Compliant</span>
        </div>
        {showFlows && (
          <>
            <div className="border-t border-border my-1" />
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-amber-500 inline-block" />
              <span className="text-foreground/80">Cross-border flow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-red-500 inline-block" />
              <span className="text-foreground/80">Blocked egress</span>
            </div>
          </>
        )}
      </div>
      {/* Live indicator */}
      <div className="absolute top-3 right-3 bg-card/95 border border-border rounded px-2 py-1 text-[10px] font-mono flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
        <span className="text-muted-foreground">LIVE · 8 ORGS MONITORED</span>
      </div>
    </div>
  );
}
