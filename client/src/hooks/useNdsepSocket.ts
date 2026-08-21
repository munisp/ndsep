import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

export type NdsepEventType =
  | "dashboard_update"
  | "new_alert"
  | "new_violation"
  | "new_network_event"
  | "streaming_tick"
  | "org_score_update"
  | "org_portal_update"
  | "penalty_issued"
  | "appeal_update"
  | "sector_compliance_update";

export interface StreamingTick {
  topic: string;
  key: string;
  partition: number;
  offset: number;
  latency: number;
  payloadJson: string;
  timestamp: string;
}

export interface AlertEvent {
  id: number;
  title: string;
  severity: string;
  source: string;
  organizationId: number;
  detectedAt: Date;
}

export interface ViolationEvent {
  id: number;
  title: string;
  severity: string;
  organizationId: number;
  detectedAt: Date;
}

export interface NetworkEvent {
  id: number;
  protocol: string | null;
  isBlocked: boolean | null;
  isCrossBorder: boolean | null;
  organizationId: number | null;
  detectedAt: Date;
}

export interface OrgPortalUpdateEvent {
  submissionToken: string;
  orgName: string;
  newPhase: string;
  decision: string;
  notes?: string;
}

export interface PenaltyIssuedEvent {
  orgId: number;
  orgName: string;
  penaltyId: number;
  amountUsd: number;
  reason: string;
}

export interface AppealUpdateEvent {
  orgId: number;
  orgName: string;
  appealId: number;
  decision: string;
  penaltyId: number;
}

export interface SectorComplianceUpdateEvent {
  sector: string;
  complianceScore: number;
  violationCount: number;
  entityCount: number;
  lastScanAt: string;
  workerStatus: string;
}

export type NdsepEvent =
  | { type: "dashboard_update"; payload: Record<string, unknown> }
  | { type: "new_alert"; payload: AlertEvent }
  | { type: "new_violation"; payload: ViolationEvent }
  | { type: "new_network_event"; payload: NetworkEvent }
  | { type: "streaming_tick"; payload: StreamingTick }
  | { type: "org_score_update"; payload: { orgId: number; name: string; complianceScore: number; riskScore: number } }
  | { type: "org_portal_update"; payload: OrgPortalUpdateEvent }
  | { type: "penalty_issued"; payload: PenaltyIssuedEvent }
  | { type: "appeal_update"; payload: AppealUpdateEvent }
  | { type: "sector_compliance_update"; payload: SectorComplianceUpdateEvent };

interface UseNdsepSocketOptions {
  rooms?: string[];
  onEvent?: (event: NdsepEvent) => void;
}

interface UseNdsepSocketReturn {
  connected: boolean;
  lastEvent: NdsepEvent | null;
  streamingTicks: StreamingTick[];
  recentAlerts: AlertEvent[];
  recentViolations: ViolationEvent[];
  recentPortalUpdates: OrgPortalUpdateEvent[];
  recentSectorUpdates: SectorComplianceUpdateEvent[];
  eventCount: number;
}

const MAX_TICKS = 50;
const MAX_ALERTS = 10;
const MAX_VIOLATIONS = 10;
const MAX_PORTAL_UPDATES = 20;
const MAX_SECTOR_UPDATES = 30;

export function useNdsepSocket({
  rooms = [],
  onEvent,
}: UseNdsepSocketOptions = {}): UseNdsepSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<NdsepEvent | null>(null);
  const [streamingTicks, setStreamingTicks] = useState<StreamingTick[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<AlertEvent[]>([]);
  const [recentViolations, setRecentViolations] = useState<ViolationEvent[]>([]);
  const [recentPortalUpdates, setRecentPortalUpdates] = useState<OrgPortalUpdateEvent[]>([]);
  const [recentSectorUpdates, setRecentSectorUpdates] = useState<SectorComplianceUpdateEvent[]>([]);
  // Alias for backward compatibility with tests
  const setSectorUpdates = setRecentSectorUpdates;
  const [eventCount, setEventCount] = useState(0);

  const handleEvent = useCallback(
    (event: NdsepEvent) => {
      setLastEvent(event);
      setEventCount((c) => c + 1);

      if (event.type === "streaming_tick") {
        setStreamingTicks((prev) => [event.payload, ...prev].slice(0, MAX_TICKS));
      } else if (event.type === "new_alert") {
        setRecentAlerts((prev) => [event.payload, ...prev].slice(0, MAX_ALERTS));
      } else if (event.type === "new_violation") {
        setRecentViolations((prev) => [event.payload, ...prev].slice(0, MAX_VIOLATIONS));
      } else if (event.type === "org_portal_update") {
        setRecentPortalUpdates((prev) => [event.payload, ...prev].slice(0, MAX_PORTAL_UPDATES));
      } else if (event.type === "sector_compliance_update") {
        setRecentSectorUpdates((prev) => {
          // Replace existing entry for same sector, or prepend
          const filtered = prev.filter((u) => u.sector !== event.payload.sector);
          return [event.payload, ...filtered].slice(0, MAX_SECTOR_UPDATES);
        });
      }

      onEvent?.(event);
    },
    [onEvent]
  );

  useEffect(() => {
    const socket = io(window.location.origin, {
      path: "/api/ws",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // Subscribe to requested rooms
      rooms.forEach((room) => socket.emit("subscribe", room));
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("ndsep_event", handleEvent);

    return () => {
      rooms.forEach((room) => socket.emit("unsubscribe", room));
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-subscribe if rooms change
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    rooms.forEach((room) => socket.emit("subscribe", room));
  }, [rooms, connected]);

  return {
    connected,
    lastEvent,
    streamingTicks,
    recentAlerts,
    recentViolations,
    recentPortalUpdates,
    recentSectorUpdates,
    eventCount,
  };
}
