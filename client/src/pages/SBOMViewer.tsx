/**
 * SBOM Viewer — Software Bill of Materials
 * Dependency inventory, vulnerability scan results, CVE tracking
 */
import { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Shield, AlertTriangle, Search, Download, RefreshCw } from "lucide-react";

const severityColor: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  moderate: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  low: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  info: "bg-muted text-foreground",
};

export default function SBOMViewer() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");

  const { data: sbomData, isLoading, refetch } = trpc.sbom.generate.useQuery({});
  const { data: vulns } = trpc.sbom.getVulnerabilityReport.useQuery();

  const handleRescan = () => { refetch(); toast.success('SBOM refreshed'); };

  const sbom = sbomData as any;
  const vulnsData = (vulns as any) ?? [];

  const filteredVulns = vulnsData.filter((v: any) => {
    const matchSearch = v.package?.toLowerCase().includes(search.toLowerCase()) || v.cve?.toLowerCase().includes(search.toLowerCase());
    const matchSeverity = severityFilter === "all" || v.severity === severityFilter;
    return matchSearch && matchSeverity;
  });

  const exportSBOM = () => {
    const blob = new Blob([JSON.stringify(sbom, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ndsep-sbom.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success("SBOM exported");
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "Security", href: "/security" }, { label: "SBOM Viewer" }]} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="w-6 h-6 text-blue-600" />
              Software Bill of Materials (SBOM)
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Dependency inventory, vulnerability scanning, CVE tracking</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportSBOM} disabled={!sbom}>
              <Download className="w-4 h-4 mr-2" />Export SBOM
            </Button>
            <Button onClick={handleRescan} >
              <RefreshCw className="w-4 h-4 mr-2" />
              {"Re-scan"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        {sbom && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Packages", value: sbom.total_packages ?? 0, icon: Package, color: "text-blue-600" },
              { label: "Vulnerabilities", value: sbom.vuln_count ?? vulnsData.length, icon: AlertTriangle, color: "text-red-600" },
              { label: "Critical/High", value: vulnsData.filter((v: any) => ['critical','high'].includes(v.severity)).length, icon: Shield, color: "text-orange-600" },
              { label: "Last Scan", value: sbom.generated_at ? new Date(sbom.generated_at).toLocaleDateString() : 'N/A', icon: RefreshCw, color: "text-green-600" },
            ].map(s => (
              <div key={s.label} className="border rounded-lg p-4 flex items-center gap-3">
                <s.icon className={`w-8 h-8 ${s.color}`} />
                <div>
                  <div className="text-xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Vulnerability table */}
        <div>
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search package or CVE..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Package</th>
                  <th className="text-left p-3 font-medium">Version</th>
                  <th className="text-left p-3 font-medium">CVE</th>
                  <th className="text-left p-3 font-medium">Severity</th>
                  <th className="text-left p-3 font-medium">Description</th>
                  <th className="text-left p-3 font-medium">Fix Available</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">Loading SBOM data...</td></tr>
                ) : filteredVulns.length === 0 ? (
                  <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">No vulnerabilities found</td></tr>
                ) : filteredVulns.map((v: any, i: number) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-mono text-xs">{v.package}</td>
                    <td className="p-3 font-mono text-xs">{v.version}</td>
                    <td className="p-3">
                      {v.cve ? (
                        <a href={`https://nvd.nist.gov/vuln/detail/${v.cve}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-mono text-xs">{v.cve}</a>
                      ) : '-'}
                    </td>
                    <td className="p-3"><Badge className={severityColor[v.severity] ?? "bg-muted"}>{v.severity}</Badge></td>
                    <td className="p-3 text-xs max-w-xs truncate">{v.description}</td>
                    <td className="p-3">{v.fix_available ? <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">Yes</Badge> : <Badge className="bg-muted text-foreground">No</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
