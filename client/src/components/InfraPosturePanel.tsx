/**
 * InfraPosturePanel (round 13 W3)
 * ===============================
 * Infrastructure security posture summary for compliance-scanning targets,
 * backed by OSIRIS RECON (ports / CVEs / SSL) via
 * complianceScanning.runInfraPostureScan + listInfraPostureRuns and the
 * existing scan_findings pipeline (finding_type='infra_posture').
 *
 * Fail-closed display: when the scanner was unavailable (no
 * OSIRIS_SCANNER_KEY / 503) the panel shows the recorded outage — never a
 * phantom "clean" posture.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";

const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  low: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  info: "bg-muted text-muted-foreground border-border",
};

export function InfraPosturePanel({ targetId }: { targetId?: number }) {
  const [selectedTarget, setSelectedTarget] = useState<number | null>(targetId ?? null);
  const effectiveTarget = targetId ?? selectedTarget;

  const targets = trpc.complianceScanning.listTargets.useQuery({}, { enabled: targetId === undefined });
  const runs = trpc.complianceScanning.listInfraPostureRuns.useQuery(
    effectiveTarget ? { target_id: effectiveTarget } : {},
  );
  const findings = trpc.complianceScanning.listFindings.useQuery(
    {
      finding_type: "infra_posture",
      ...(effectiveTarget ? { target_id: effectiveTarget } : {}),
    },
  );

  const runScan = trpc.complianceScanning.runInfraPostureScan.useMutation({
    onSuccess: (outcome: any) => {
      if (outcome?.scannerAvailable) {
        toast.success(`Posture scan complete — severity ${outcome.severity ?? "none"}, ${outcome.findingsCount} finding(s)`);
      } else {
        toast.warning(`Scanner unavailable (fail-closed): ${outcome?.error ?? "no result"} — no posture recorded`);
      }
      runs.refetch(); findings.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const runRows: any[] = (runs.data as any[]) ?? [];
  const findingRows: any[] = (findings.data as any[]) ?? [];
  const latestRun = runRows[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Infrastructure posture (OSIRIS RECON)
            </CardTitle>
            <CardDescription>
              Port / CVE / SSL posture of controller web infrastructure. Findings flow into the
              compliance scanning findings list (type <span className="font-mono">infra_posture</span>)
              and the supervision risk sweep.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {targetId === undefined && (
              <Select
                value={effectiveTarget ? String(effectiveTarget) : "all"}
                onValueChange={(v) => setSelectedTarget(v === "all" ? null : Number(v))}
              >
                <SelectTrigger className="w-56"><SelectValue placeholder="All targets" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All targets</SelectItem>
                  {((targets.data as any[]) ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.controller_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="sm" onClick={() => { runs.refetch(); findings.refetch(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!effectiveTarget || runScan.isPending}
              title={effectiveTarget ? "Run OSIRIS RECON posture scan for this target" : "Select a target first"}
              onClick={() => effectiveTarget && runScan.mutate({ target_id: effectiveTarget })}
            >
              {runScan.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Scan posture"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Latest posture status */}
        {latestRun && (
          <div className={`rounded-md border px-3 py-2 text-sm flex items-center gap-2 ${
            latestRun.scanner_available ? "border-border" : "border-yellow-500/40 bg-yellow-500/10"
          }`}>
            {latestRun.scanner_available
              ? <ShieldCheck className="h-4 w-4 text-green-400 shrink-0" />
              : <ShieldOff className="h-4 w-4 text-yellow-400 shrink-0" />}
            <span>
              Latest sweep of <span className="font-mono">{latestRun.host}</span>{" "}
              {new Date(latestRun.created_at).toLocaleString()}:{" "}
              {latestRun.scanner_available
                ? <>{latestRun.findings_count} finding(s){latestRun.result?.severity ? <> — severity <Badge variant="outline" className={SEV_COLORS[latestRun.result.severity] ?? ""}>{latestRun.result.severity}</Badge></> : null}</>
                : <>scanner unavailable{latestRun.scanner_key_present ? "" : " (scanner key not configured)"} — fail-closed, no posture recorded{latestRun.error ? <span className="text-muted-foreground"> ({latestRun.error})</span> : null}</>}
            </span>
          </div>
        )}

        {/* Posture findings */}
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Posture findings ({findingRows.length})
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead><TableHead>Target</TableHead>
                <TableHead>Exposed ports</TableHead><TableHead>CVEs</TableHead>
                <TableHead>Cert</TableHead><TableHead>Status</TableHead><TableHead>Detected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findingRows.map((f: any) => {
                const ev = f.evidence ?? {};
                return (
                  <TableRow key={f.id}>
                    <TableCell><Badge variant="outline" className={SEV_COLORS[f.severity] ?? ""}>{f.severity}</Badge></TableCell>
                    <TableCell className="text-sm">{f.controller_name ?? `#${f.target_id}`}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {(ev.open_ports ?? []).map((p: any) => p.port).join(", ") || "—"}
                      {(ev.exposed_sensitive_ports ?? []).length > 0 && (
                        <Badge variant="outline" className="ml-1 bg-red-500/20 text-red-300 border-red-500/40">
                          sensitive: {ev.exposed_sensitive_ports.join(",")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {(ev.matched_cves ?? []).map((c: any) => `${c.cve_id}${c.kev_listed ? " (KEV)" : ""}`).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-xs">{(ev.cert_issues ?? []).join("; ") || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{f.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{f.detected_at ? new Date(f.detected_at).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                );
              })}
              {findingRows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No infra posture findings.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Sweep history */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Posture sweep history ({runRows.length})</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead><TableHead>Host</TableHead><TableHead>Scanner</TableHead>
                <TableHead>Findings</TableHead><TableHead>Duration</TableHead><TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runRows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.host}</TableCell>
                  <TableCell>
                    {r.scanner_available
                      ? <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/40">ok</Badge>
                      : <Badge variant="outline" className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">unavailable</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">{r.findings_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.duration_ms != null ? `${r.duration_ms}ms` : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
              {runRows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No posture sweeps yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default InfraPosturePanel;
