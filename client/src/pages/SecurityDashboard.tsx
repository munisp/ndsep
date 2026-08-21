import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldAlert, ShieldCheck, Lock, FileWarning, Activity, BarChart3 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, getStatusVariant } from "@/components/StatusBadge";

export default function SecurityDashboard() {
  const score = trpc.securityAudit.getScore.useQuery();
  const findings = trpc.securityAudit.getFindings.useQuery();
  const latest = trpc.securityAudit.getLatest.useQuery();
  const { data: intelCompliance } = trpc.intelAggregator.enrichCompliance.useQuery(undefined, { refetchInterval: 120_000 });

  const isLoading = score.isLoading || findings.isLoading;
  const error = score.error || findings.error;

  if (isLoading) return <PageLoader message="Loading security status…" />;
  if (error) return <ErrorState message={error.message} retry={() => { score.refetch(); findings.refetch(); }} />;

  const scoreData = score.data;
  const findingsData = findings.data ?? [];
  const gradeColor = (scoreData?.score ?? 0) >= 85 ? "text-green-600" : (scoreData?.score ?? 0) >= 65 ? "text-yellow-600" : "text-red-600";

  const securityModules = [
    { name: "Security Score", status: `${scoreData?.score ?? 0}/100 (${scoreData?.grade ?? "N/A"})`, icon: BarChart3, ok: (scoreData?.score ?? 0) >= 75 },
    { name: "Fixed Findings", status: `${scoreData?.fixedCount ?? 0} resolved`, icon: ShieldCheck, ok: true },
    { name: "Open Findings", status: `${scoreData?.remainingCount ?? 0} remaining`, icon: ShieldAlert, ok: (scoreData?.remainingCount ?? 0) === 0 },
    { name: "Resolution Rate", status: `${scoreData?.resolutionRate ?? 100}%`, icon: Activity, ok: (scoreData?.resolutionRate ?? 100) >= 80 },
    { name: "Total Scanned", status: `${scoreData?.totalCount ?? 0} checks`, icon: Shield, ok: true },
    { name: "Last Scan", status: latest.data?.scannedAt ? new Date(latest.data.scannedAt).toLocaleDateString() : "Never", icon: FileWarning, ok: !!latest.data },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Security Dashboard"
        subtitle="Real-time security posture monitoring via tRPC"
        icon={Shield}
        badge={<span className={`text-4xl font-bold ${gradeColor}`}>{scoreData?.grade ?? "N/A"}</span>}
      />

      {/* Security Modules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {securityModules.map((mod) => (
          <Card key={mod.name}>
            <CardContent className="flex items-center gap-4 p-4">
              <mod.icon className={`h-8 w-8 ${mod.ok ? "text-green-600" : "text-red-600"}`} />
              <div>
                <p className="font-medium">{mod.name}</p>
                <Badge variant={mod.ok ? "default" : "destructive"}>
                  {mod.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Wazuh SIEM Integration — NDPA Compliance from live monitoring */}
      {intelCompliance && (
        <Card className="border-l-4 border-l-blue-500/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4 text-blue-500" />
              Wazuh SIEM — NDPA Endpoint Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className={`text-2xl font-bold ${intelCompliance.ndpaScore >= 80 ? "text-green-600" : intelCompliance.ndpaScore >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                  {intelCompliance.ndpaScore}%
                </p>
                <p className="text-xs text-muted-foreground">NDPA Score</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{intelCompliance.monitoredEndpoints}</p>
                <p className="text-xs text-muted-foreground">Monitored Endpoints</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{intelCompliance.openVulnerabilities}</p>
                <p className="text-xs text-muted-foreground">Open Vulnerabilities</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-600">{intelCompliance.complianceGaps.length}</p>
                <p className="text-xs text-muted-foreground">Compliance Gaps</p>
              </div>
            </div>
            {intelCompliance.complianceGaps.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/30">
                <p className="text-xs font-medium text-muted-foreground mb-2">Compliance Gaps (from Wazuh NDPA audit)</p>
                <div className="flex flex-wrap gap-1.5">
                  {intelCompliance.complianceGaps.slice(0, 6).map((gap: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs">{gap}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Security Findings Table */}
      <Card>
        <CardHeader><CardTitle>Security Findings ({findingsData.length})</CardTitle></CardHeader>
        <CardContent>
          {findingsData.length === 0 ? (
            <EmptyState title="No security findings" description="Run a scan to generate findings." icon={ShieldCheck} />
          ) : (
            <div className="space-y-2">
              {findingsData.map((f) => (
                <div key={f.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={f.severity === "critical" || f.severity === "high" ? "destructive" : "default"} className="text-xs">
                        {f.severity}
                      </Badge>
                      <span className="font-medium text-sm">{f.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{f.description}</p>
                  </div>
                  <StatusBadge variant={getStatusVariant(f.status)}>
                    {f.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
