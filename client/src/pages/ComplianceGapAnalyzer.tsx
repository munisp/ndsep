import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Target, AlertTriangle, CheckCircle, TrendingUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const priorityColors: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/20 text-green-400 border-green-500/30",
};

const statusColors: Record<string, string> = {
  open: "bg-red-500/20 text-red-400",
  in_progress: "bg-yellow-500/20 text-yellow-400",
  remediated: "bg-green-500/20 text-green-400",
  accepted: "bg-blue-500/20 text-blue-400",
};

export default function ComplianceGapAnalyzer() {
  const [orgFilter, setOrgFilter] = useState("all");
  const [frameworkFilter, setFrameworkFilter] = useState("all");
  const [selectedGap, setSelectedGap] = useState<any>(null);

  const { data: gaps, refetch } = trpc.phase12.complianceGap.listAssessments.useQuery({
    orgId: orgFilter !== "all" ? parseInt(orgFilter) : undefined,
  });
  const { data: summary } = trpc.phase12.complianceGap.listAssessments.useQuery({});
  const { data: orgs } = trpc.organizations.list.useQuery({ limit: 100 });

  const updateStatus = trpc.phase12.complianceGap.runAssessment.useMutation({
    onSuccess: () => { refetch(); toast.success("Gap status updated"); },
  });
  const runAnalysis = trpc.phase12.complianceGap.runAssessment.useMutation({
    onSuccess: () => { refetch(); toast.success("Gap analysis complete"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const criticalCount = gaps?.filter((g: any) => g.priority === "critical").length ?? 0;
  const openCount = gaps?.filter((g: any) => g.status === "open").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Compliance Gap Analyzer" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Compliance Gap Analyzer</h1>
          <p className="text-muted-foreground text-sm mt-1">Identify and remediate NDPA, ISO 27001, SOC2, GDPR compliance gaps</p>
        </div>
        <Button onClick={() => runAnalysis.mutate({ orgId: 1 })} className="bg-blue-600 hover:bg-blue-700" disabled={runAnalysis.isPending}>
          <RefreshCw className={`w-4 h-4 mr-2 ${runAnalysis.isPending ? "animate-spin" : ""}`} />
          {runAnalysis.isPending ? "Analysing..." : "Run Analysis"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-red-900/20 border-red-700/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs">Critical Gaps</p>
            <p className="text-2xl font-bold text-red-300">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-orange-900/20 border-orange-700/40">
          <CardContent className="p-4">
            <p className="text-orange-400 text-xs">Open Gaps</p>
            <p className="text-2xl font-bold text-orange-300">{openCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Gaps</p>
            <p className="text-2xl font-bold text-foreground">{gaps?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-900/20 border-green-700/40">
          <CardContent className="p-4">
            <p className="text-green-400 text-xs">Remediated</p>
            <p className="text-2xl font-bold text-green-300">
              {gaps?.filter((g: any) => g.status === "remediated").length ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Framework Coverage */}
      {summary && (
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-foreground text-base">Framework Coverage</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-6">
              {Object.entries((summary as any)?.byFramework ?? {}).map(([fw, data]: [string, any]) => (
                <div key={fw}>
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground text-sm font-medium">{fw}</span>
                    <span className="text-foreground text-sm">{data.score ?? 0}%</span>
                  </div>
                  <Progress value={data.score ?? 0} className="h-2" />
                  <p className="text-muted-foreground text-xs mt-1">{data.gaps} gaps remaining</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger className="bg-card border-border text-foreground w-52">
            <SelectValue placeholder="All Organisations" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">All Organisations</SelectItem>
            {orgs?.map((o: any) => (
              <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={frameworkFilter} onValueChange={setFrameworkFilter}>
          <SelectTrigger className="bg-card border-border text-foreground w-44">
            <SelectValue placeholder="All Frameworks" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">All Frameworks</SelectItem>
            <SelectItem value="NDPA">NDPA 2023</SelectItem>
            <SelectItem value="ISO27001">ISO 27001</SelectItem>
            <SelectItem value="SOC2">SOC 2</SelectItem>
            <SelectItem value="GDPR">GDPR</SelectItem>
            <SelectItem value="PCI-DSS">PCI-DSS</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Gaps Table */}
      <Card className="bg-card/50 border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Gap</TableHead>
                <TableHead className="text-muted-foreground">Framework</TableHead>
                <TableHead className="text-muted-foreground">Control</TableHead>
                <TableHead className="text-muted-foreground">Organisation</TableHead>
                <TableHead className="text-muted-foreground">Priority</TableHead>
                <TableHead className="text-muted-foreground">Effort</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gaps?.map((gap: any) => (
                <TableRow key={gap.id} className="border-border cursor-pointer hover:bg-muted/30"
                  onClick={() => setSelectedGap(gap)}>
                  <TableCell>
                    <p className="text-foreground text-sm font-medium">{gap.gap_title}</p>
                    <p className="text-muted-foreground text-xs line-clamp-1">{gap.description}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="border-blue-500/40 text-blue-400">{gap.framework}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-xs font-mono">{gap.control_id}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{gap.org_name ?? "Platform-wide"}</TableCell>
                  <TableCell><Badge className={priorityColors[gap.priority ?? "medium"]}>{gap.priority}</Badge></TableCell>
                  <TableCell>
                    <span className={`text-xs ${gap.remediation_effort === "high" ? "text-red-400" : gap.remediation_effort === "medium" ? "text-yellow-400" : "text-green-400"}`}>
                      {gap.remediation_effort}
                    </span>
                  </TableCell>
                  <TableCell><Badge className={statusColors[gap.status ?? "open"]}>{gap.status?.replace("_", " ")}</Badge></TableCell>
                  <TableCell>
                    <Select value={gap.status ?? "open"}
                      onValueChange={(v) => updateStatus.mutate({ orgId: gap.org_id ?? 1 })}>
                      <SelectTrigger className="h-7 bg-muted border-border text-foreground text-xs w-28" onClick={e => e.stopPropagation()}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="remediated">Remediated</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
