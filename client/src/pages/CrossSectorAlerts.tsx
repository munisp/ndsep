import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { exportToCsv } from "@/lib/safeExport";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const SECTOR_COLORS: Record<string, string> = {
  banking: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  telecom: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  healthcare: "bg-green-500/15 text-green-600 dark:text-green-400",
  energy: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  insurance: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  fintech: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  ndpa: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
};

// Cross-sector alerts are derived from violations + enforcement cases across all sectors
function useCrossSectorAlerts() {
  const violations = trpc.compliance.violations.useQuery({ limit: 500 }, { refetchInterval: 30000 });
  const orgs = trpc.organizations.list.useQuery();

  const orgMap = new Map((orgs.data ?? []).map(o => [o.id, o]));

  // Build cross-sector alerts: orgs with violations in multiple sectors
  type ViolationItem = NonNullable<typeof violations.data>[number];
  const orgViolations = new Map<number, { sectors: Set<string>; violations: ViolationItem[]; highestSeverity: string }>();
  for (const v of violations.data ?? []) {
    const orgId = Number(v.organizationId);
    if (!orgId) continue;
    if (!orgViolations.has(orgId)) {
      orgViolations.set(orgId, { sectors: new Set(), violations: [], highestSeverity: "low" });
    }
    const entry = orgViolations.get(orgId)!;
    entry.violations.push(v);
    const orgEntry = orgMap.get(orgId);
    const sector = orgEntry ? String((orgEntry as Record<string, unknown>).sector ?? "ndpa") : "ndpa";
    entry.sectors.add(sector);
    if (v.severity === "critical") entry.highestSeverity = "critical";
    else if (v.severity === "high" && entry.highestSeverity !== "critical") entry.highestSeverity = "high";
    else if (v.severity === "medium" && !["critical","high"].includes(entry.highestSeverity)) entry.highestSeverity = "medium";
  }

  const crossSectorAlerts = Array.from(orgViolations.entries())
    .filter(([, v]) => v.violations.length > 0)
    .map(([orgId, v]) => ({
      orgId,
      org: orgMap.get(orgId) as any,
      sectors: Array.from(v.sectors),
      violationCount: v.violations.length,
      highestSeverity: v.highestSeverity,
      latestViolation: v.violations.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0],
      isCrossSector: v.sectors.size > 1,
    }))
    .sort((a, b) => {
      const sev = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sev[b.highestSeverity as keyof typeof sev] ?? 0) - (sev[a.highestSeverity as keyof typeof sev] ?? 0);
    });

  return {
    crossSectorAlerts,
    isLoading: violations.isLoading || orgs.isLoading,
    totalCrossSector: crossSectorAlerts.filter(a => a.isCrossSector).length,
    totalCritical: crossSectorAlerts.filter(a => a.highestSeverity === "critical").length,
    totalHigh: crossSectorAlerts.filter(a => a.highestSeverity === "high").length,
  };
}

export default function CrossSectorAlerts() {
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showCrossSectorOnly, setShowCrossSectorOnly] = useState(false);

  const { crossSectorAlerts, isLoading, totalCrossSector, totalCritical, totalHigh } = useCrossSectorAlerts();

  const filtered = crossSectorAlerts.filter(a => {
    if (showCrossSectorOnly && !a.isCrossSector) return false;
    if (sectorFilter !== "all" && !a.sectors.includes(sectorFilter)) return false;
    if (severityFilter !== "all" && a.highestSeverity !== severityFilter) return false;
    if (search && !a.org?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function exportToExcel() {
    const rows = filtered.map(a => ({
      "Organisation": a.org?.name ?? `Org #${a.orgId}`,
      "Sectors": a.sectors.join(", "),
      "Violation Count": a.violationCount,
      "Highest Severity": a.highestSeverity,
      "Cross-Sector": a.isCrossSector ? "Yes" : "No",
      "Latest Violation": a.latestViolation?.title ?? "",
      "Latest Violation Date": a.latestViolation?.createdAt ? new Date(String(a.latestViolation.createdAt)).toLocaleDateString() : "",
    }));
    exportToCsv(rows, `cross-sector-alerts-${new Date().toISOString().split("T")[0]}`);
    toast.success("Export complete");
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Analytics", href: "/analytics" }, { label: "Cross Sector Alerts" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cross-Sector Enforcement Alerts</h1>
          <p className="text-muted-foreground mt-1">Organisations with compliance violations across multiple regulated sectors</p>
        </div>
        <Button onClick={exportToExcel} variant="outline" size="sm">Export XLSX</Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-600">{totalCritical}</div>
            <div className="text-sm text-muted-foreground">Critical Severity</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-orange-600">{totalHigh}</div>
            <div className="text-sm text-muted-foreground">High Severity</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-600">{totalCrossSector}</div>
            <div className="text-sm text-muted-foreground">Multi-Sector Orgs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{crossSectorAlerts.length}</div>
            <div className="text-sm text-muted-foreground">Total Flagged Orgs</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search organisation..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sectors</SelectItem>
            <SelectItem value="banking">Banking</SelectItem>
            <SelectItem value="telecom">Telecom</SelectItem>
            <SelectItem value="healthcare">Healthcare</SelectItem>
            <SelectItem value="energy">Energy</SelectItem>
            <SelectItem value="insurance">Insurance</SelectItem>
            <SelectItem value="fintech">Fintech</SelectItem>
            <SelectItem value="ndpa">NDPA</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={showCrossSectorOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setShowCrossSectorOnly(!showCrossSectorOnly)}
        >
          Multi-Sector Only
        </Button>
      </div>

      {/* Alerts Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading alerts...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No alerts match the current filters.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(alert => (
            <Card key={alert.orgId} className={`border-l-4 ${
              alert.highestSeverity === "critical" ? "border-l-red-500" :
              alert.highestSeverity === "high" ? "border-l-orange-500" :
              alert.highestSeverity === "medium" ? "border-l-yellow-500" : "border-l-green-500"
            }`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{alert.org?.name ?? `Organisation #${alert.orgId}`}</span>
                      {alert.isCrossSector && (
                        <Badge variant="outline" className="text-purple-700 border-purple-500/30 bg-purple-50">
                          Multi-Sector
                        </Badge>
                      )}
                      <Badge className={SEVERITY_COLORS[alert.highestSeverity] ?? ""}>
                        {alert.highestSeverity.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {alert.sectors.map(s => (
                        <Badge key={s} className={SECTOR_COLORS[s] ?? "bg-muted text-foreground"}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </Badge>
                      ))}
                    </div>
                    {alert.latestViolation && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        Latest: {String(alert.latestViolation.title)} — {new Date(String(alert.latestViolation.createdAt)).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold">{alert.violationCount}</div>
                    <div className="text-xs text-muted-foreground">violations</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
