import { useEffect, useRef } from "react";
import { useNdsepSocket } from "@/hooks/useNdsepSocket";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, Zap } from "lucide-react";

/**
 * CriticalEventBanner — mounts once in DashboardLayout and listens to
 * the WebSocket for critical-severity events, pushing a Sonner toast
 * banner on every new critical violation or HIGH severity SIEM alert.
 */
export function CriticalEventBanner() {
  const { lastEvent, connected } = useNdsepSocket();
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!lastEvent) return;

    const key = `${lastEvent.type}-${(lastEvent as any).id ?? Date.now()}`;
    if (seenIds.current.has(key)) return;
    seenIds.current.add(key);

    if (lastEvent.type === "new_violation") {
      const v = lastEvent as any;
      if (v.severity === "critical" || v.severity === "high") {
        toast.error(
          `Critical Compliance Violation`,
          {
            description: `${v.organizationName ?? "Unknown Org"} — ${v.violationType ?? "Policy breach"} (Severity: ${v.severity?.toUpperCase()})`,
            duration: 8000,
            icon: <AlertTriangle className="w-4 h-4 text-red-500" />,
            action: {
              label: "View",
              onClick: () => { window.location.hash = "/compliance"; },
            },
          }
        );
      }
    }

    if (lastEvent.type === "new_alert") {
      const a = lastEvent as any;
      if (a.severity === "HIGH" || a.severity === "CRITICAL" || a.severity === "critical" || a.severity === "high") {
        toast.error(
          `${a.severity} Security Alert`,
          {
            description: `${a.alertType ?? "Threat detected"} — ${a.source ?? "Unknown source"} → ${a.destination ?? "Unknown destination"}`,
            duration: 8000,
            icon: <ShieldAlert className="w-4 h-4 text-orange-500" />,
            action: {
              label: "View",
              onClick: () => { window.location.hash = "/siem"; },
            },
          }
        );
      }
    }

    if (lastEvent.type === "new_network_event") {
      const n = lastEvent as any;
      if (n.isBlocked || n.isCrossBorder) {
        toast.warning(
          n.isBlocked ? "Network Traffic Blocked" : "Cross-Border Data Transfer Detected",
          {
            description: `${n.sourceIp ?? "?"} → ${n.destinationIp ?? "?"} | ${n.protocol ?? "TCP"} | ${n.bytesTransferred ? `${(n.bytesTransferred / 1024).toFixed(1)} KB` : ""}`,
            duration: 6000,
            icon: <Zap className="w-4 h-4 text-yellow-500" />,
          }
        );
      }
    }
  }, [lastEvent]);

  // This component renders nothing — it only fires toasts
  return null;
}
