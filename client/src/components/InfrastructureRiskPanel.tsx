/**
 * InfrastructureRiskPanel (round 13 W6 / P2.8 + P2.9)
 * ====================================================
 * Early-warning surface fed by the infrastructure risk watch
 * (infrastructureRiskRouter → server/services/infrastructureRiskWatch.ts):
 *
 *   Section 1 — Availability risks: disaster-driven availability risk for
 *               declared data-center locations (earthquake M≥4.5 ≤100 km,
 *               fire ≤50 km, severe weather ≤150 km), with acknowledge /
 *               close actions.
 *   Section 2 — Cable-landing watch: vessel anomalies near Nigeria's
 *               submarine cable landings. Early-warning signal only —
 *               "possible anchoring/trawling risk near cable landing —
 *               physical-layer resilience".
 *
 * Degrades gracefully: when migration 0148 is not applied, both sections
 * show the note returned by the API instead of phantom "all clear".
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, Ship, CloudLightning, Anchor, CheckCheck } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500/20 text-red-300 border-red-500/40",
  acknowledged: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  closed: "bg-muted text-muted-foreground border-border",
};

const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  low: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  unknown: "bg-muted text-muted-foreground border-border",
};

const EVENT_LABELS: Record<string, string> = {
  earthquake: "Earthquake",
  fire: "Active fire",
  severe_weather: "Severe weather",
};

// infrastructureRiskRouter is mounted in server/routers.ts (Round-13
// integration) — calls are fully typed.
const ir = trpc.infrastructureRisk;

export function InfrastructureRiskPanel() {
  const utils = trpc.useUtils();
  const [riskStatus, setRiskStatus] = useState<string>("open");
  const [alertStatus, setAlertStatus] = useState<string>("open");

  const stats = ir.stats.useQuery();
  const seed = ir.seedStatus.useQuery();
  const risks = ir.listAvailabilityRisks.useQuery(
    riskStatus === "all" ? {} : { status: riskStatus as "open" | "acknowledged" | "closed" },
  );
  const alerts = ir.listCableAlerts.useQuery(
    alertStatus === "all" ? {} : { status: alertStatus as "open" | "acknowledged" | "closed" },
  );

  const acknowledge = ir.acknowledge.useMutation({
    onSuccess: (r: any) => {
      toast.success(`${r.kind === "cable" ? "Cable alert" : "Availability risk"} ${r.status}`);
      utils.infrastructureRisk.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const riskRows: any[] = (risks.data as any)?.rows ?? [];
  const alertRows: any[] = (alerts.data as any)?.rows ?? [];
  const signal: string = (alerts.data as any)?.signal ??
    "possible anchoring/trawling risk near cable landing — physical-layer resilience";
  const s = stats.data as any;

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><CloudLightning className="h-4 w-4" /> Open availability risks</CardDescription>
            <CardTitle className="text-3xl font-mono">{s?.availability?.open ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {s?.availability?.byType
              ? Object.entries(s.availability.byType).map(([t, n]) => (
                  <span key={t} className="mr-2">{EVENT_LABELS[t] ?? t}: {String(n)}</span>
                ))
              : "no open events"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Anchor className="h-4 w-4" /> Open cable alerts</CardDescription>
            <CardTitle className="text-3xl font-mono">{s?.cable?.open ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            last vessel sighting: {s?.cable?.lastSeenAt ? new Date(s.cable.lastSeenAt).toLocaleString() : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Ship className="h-4 w-4" /> Cable points seeded</CardDescription>
            <CardTitle className="text-3xl font-mono">
              {seed.data ? `${(seed.data as any).pointCount}/${(seed.data as any).expectedCount}` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {seed.data && (seed.data as any).missingSystems?.length > 0
              ? <span className="text-yellow-400">missing: {(seed.data as any).missingSystems.join(", ")}</span>
              : <>provenance: {(seed.data as any)?.provenance ?? "—"} (approximate — public sources)</>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last assessment</CardDescription>
            <CardTitle className="text-sm font-mono pt-2">
              {s?.availability?.lastAssessedAt ? new Date(s.availability.lastAssessedAt).toLocaleString() : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" size="sm" onClick={() => utils.infrastructureRisk.invalidate()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Section 1: availability risks */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">Availability risks — declared data-center locations</CardTitle>
              <CardDescription>
                Active disasters within proximity thresholds of locations declared on hosting
                declarations (earthquake M≥4.5 ≤100 km · fire ≤50 km · severe weather ≤150 km).
              </CardDescription>
            </div>
            <Select value={riskStatus} onValueChange={setRiskStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {(risks.data as any)?.note ? (
            <p className="text-sm text-yellow-400">{(risks.data as any).note}</p>
          ) : riskRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No availability risks in this state.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity / location</TableHead>
                  <TableHead>Hazard</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                  <TableHead>Assessed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riskRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.entity_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.location_name}</div>
                    </TableCell>
                    <TableCell>
                      {EVENT_LABELS[r.event_type] ?? r.event_type}
                      {r.magnitude != null && <span className="text-xs text-muted-foreground"> M{Number(r.magnitude).toFixed(1)}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SEV_COLORS[r.severity] ?? SEV_COLORS.unknown}>{r.severity}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{Number(r.distance_km).toFixed(1)} km</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.assessed_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.status === "open" && (
                        <Button
                          size="sm" variant="outline"
                          disabled={acknowledge.isPending}
                          onClick={() => acknowledge.mutate({ kind: "availability", id: r.id, target_status: "acknowledged" })}
                        >
                          <CheckCheck className="h-3 w-3 mr-1" /> Acknowledge
                        </Button>
                      )}
                      {r.status === "acknowledged" && (
                        <Button
                          size="sm" variant="ghost"
                          disabled={acknowledge.isPending}
                          onClick={() => acknowledge.mutate({ kind: "availability", id: r.id, target_status: "closed" })}
                        >
                          Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 2: cable-landing watch */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">Cable-landing watch — maritime anomalies</CardTitle>
              <CardDescription>
                Early-warning signal only: <span className="font-medium">{signal}</span>.
                Vessels within 2 km of a landing point that are slow (&lt;1 kt) or report
                anchoring/moored status.
              </CardDescription>
            </div>
            <Select value={alertStatus} onValueChange={setAlertStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {(alerts.data as any)?.note ? (
            <p className="text-sm text-yellow-400">{(alerts.data as any).note}</p>
          ) : alertRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cable-watch alerts in this state.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cable point</TableHead>
                  <TableHead>Vessel</TableHead>
                  <TableHead className="text-right">Speed</TableHead>
                  <TableHead>Nav status</TableHead>
                  <TableHead className="text-right">Closest</TableHead>
                  <TableHead>First / last seen</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertRows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.cable_system}</div>
                      <div className="text-xs text-muted-foreground">{a.cable_point_name}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono">{a.vessel_mmsi}</div>
                      {a.vessel_name && <div className="text-xs text-muted-foreground">{a.vessel_name}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {a.speed_knots != null ? `${Number(a.speed_knots).toFixed(1)} kt` : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{a.vessel_status ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(a.distance_km).toFixed(2)} km</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(a.first_seen_at).toLocaleString()}<br />
                      {new Date(a.last_seen_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[a.status] ?? ""}>{a.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {a.status === "open" && (
                        <Button
                          size="sm" variant="outline"
                          disabled={acknowledge.isPending}
                          onClick={() => acknowledge.mutate({ kind: "cable", id: a.id, target_status: "acknowledged" })}
                        >
                          <CheckCheck className="h-3 w-3 mr-1" /> Acknowledge
                        </Button>
                      )}
                      {a.status === "acknowledged" && (
                        <Button
                          size="sm" variant="ghost"
                          disabled={acknowledge.isPending}
                          onClick={() => acknowledge.mutate({ kind: "cable", id: a.id, target_status: "closed" })}
                        >
                          Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
