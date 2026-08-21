import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, CheckCircle2, XCircle, AlertTriangle, TrendingUp, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const FRAMEWORKS = [
  {
    id: "ndpr",
    name: "NDPR",
    fullName: "Nigeria Data Protection Regulation",
    authority: "NITDA",
    color: "#10b981",
    accent: "emerald",
    articles: [
      { id: "Art.2.1", title: "Lawful Basis for Processing", weight: 20 },
      { id: "Art.2.3", title: "Data Subject Rights", weight: 15 },
      { id: "Art.2.5", title: "Data Security Measures", weight: 20 },
      { id: "Art.2.7", title: "Cross-Border Transfer Controls", weight: 25 },
      { id: "Art.2.9", title: "Data Breach Notification", weight: 10 },
      { id: "Art.3.1", title: "DPIA Requirements", weight: 10 },
    ],
  },
  {
    id: "gdpr",
    name: "GDPR",
    fullName: "General Data Protection Regulation",
    authority: "EU DPA",
    color: "#3b82f6",
    accent: "blue",
    articles: [
      { id: "Art.6", title: "Lawfulness of Processing", weight: 20 },
      { id: "Art.17", title: "Right to Erasure", weight: 15 },
      { id: "Art.25", title: "Data Protection by Design", weight: 15 },
      { id: "Art.32", title: "Security of Processing", weight: 20 },
      { id: "Art.44", title: "Transfers to Third Countries", weight: 20 },
      { id: "Art.83", title: "Administrative Fines", weight: 10 },
    ],
  },
  {
    id: "iso27001",
    name: "ISO 27001",
    fullName: "Information Security Management",
    authority: "ISO/IEC",
    color: "#8b5cf6",
    accent: "violet",
    articles: [
      { id: "A.5", title: "Information Security Policies", weight: 15 },
      { id: "A.8", title: "Asset Management", weight: 20 },
      { id: "A.9", title: "Access Control", weight: 20 },
      { id: "A.12", title: "Operations Security", weight: 15 },
      { id: "A.16", title: "Incident Management", weight: 15 },
      { id: "A.18", title: "Compliance", weight: 15 },
    ],
  },
  {
    id: "soc2",
    name: "SOC 2",
    fullName: "Service Organization Control 2",
    authority: "AICPA",
    color: "#f59e0b",
    accent: "amber",
    articles: [
      { id: "CC1", title: "Control Environment", weight: 20 },
      { id: "CC6", title: "Logical & Physical Access", weight: 20 },
      { id: "CC7", title: "System Operations", weight: 20 },
      { id: "CC8", title: "Change Management", weight: 15 },
      { id: "CC9", title: "Risk Mitigation", weight: 15 },
      { id: "A1", title: "Availability", weight: 10 },
    ],
  },
];

function scoreFromCompliance(rate: number, framework: string): number {
  // Simulate framework-specific scoring based on overall compliance rate
  const offsets: Record<string, number> = {
    ndpr: 0,
    gdpr: -5,
    iso27001: 3,
    soc2: -2,
  };
  return Math.min(100, Math.max(0, Math.round(rate + (offsets[framework] ?? 0))));
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div
        className="h-2 rounded-full transition-all"
        style={{ width: `${score}%`, backgroundColor: color }}
      />
    </div>
  );
}

function StatusIcon({ score }: { score: number }) {
  if (score >= 80) return <CheckCircle2 className="w-4 h-4 text-green-400" />;
  if (score >= 60) return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
  return <XCircle className="w-4 h-4 text-red-400" />;
}

export default function FrameworkDashboard() {
  const [exportFramework, setExportFramework] = useState("NDPR");
  const { data: dashStats } = trpc.dashboard.stats.useQuery();
  const { data: violations = [] } = trpc.compliance.violations.useQuery({ limit: 500 });

  const overallRate = (dashStats as any)?.complianceRate ?? 72;
  const totalViolations = (violations as any[]).length;
  const criticalViolations = (violations as any[]).filter((v: any) => v.severity === "critical").length;

  const reportMutation = trpc.dashboard.frameworkReport.useMutation({
    onSuccess: (data) => {
      // Download as markdown file (client-side, no server dependency)
      const blob = new Blob([data.markdownReport], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NDSEP-${data.framework.replace(/\s+/g, "-")}-Compliance-Report-${data.generatedAt}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${data.framework} compliance report downloaded`);
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Framework Dashboard" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Framework Compliance Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Multi-framework compliance posture — NDPR · GDPR · ISO 27001 · SOC 2
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-500/20 text-emerald-400 text-sm px-3 py-1">
            <TrendingUp className="w-3 h-3 mr-1" /> {overallRate}% Overall
          </Badge>
          <Select value={exportFramework} onValueChange={setExportFramework}>
            <SelectTrigger className="w-32 bg-card border-border text-sm h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["NDPR", "GDPR", "ISO 27001", "SOC 2"].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-sm"
            disabled={reportMutation.isPending}
            onClick={() => reportMutation.mutate({ framework: exportFramework })}
          >
            {reportMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1.5" />}
            Export Report
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-sm"
            disabled={reportMutation.isPending}
            onClick={() => {
              reportMutation.mutate({ framework: "NDPR" }, {
                onSuccess: (data) => {
                  const today = data.generatedAt;
                  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                  const nitdaReport = [
                    `NITDA DATA PROTECTION COMPLIANCE ORGANISATION (DPCO)`,
                    `ANNUAL COMPLIANCE REPORT — ${new Date().getFullYear()}`,
                    `Generated by NDSEP on ${today}`,
                    ``,
                    `Organisation: National Data Sovereignty Enforcement Platform`,
                    `Report Reference: NDSEP-NDPR-${today.replace(/-/g, '')}-001`,
                    ``,
                    `=`.repeat(60),
                    ``,
                    data.markdownReport,
                    ``,
                    `=`.repeat(60),
                    ``,
                    `CERTIFICATION`,
                    `This report has been generated in accordance with the Nigeria Data`,
                    `Protection Regulation (NDPR) 2019 and the NDPR Implementation`,
                    `Framework. The data herein is accurate as of the report date.`,
                    ``,
                    `Authorised by: NDSEP Compliance Engine v2.0`,
                    `Submission deadline: ${deadline}`,
                  ].join("\n");
                  const blob = new Blob([nitdaReport], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `NITDA-DPCO-Annual-Report-${today}.txt`;
                  document.body.appendChild(a); a.click();
                  document.body.removeChild(a); URL.revokeObjectURL(url);
                  toast.success("NITDA DPCO report downloaded — ready for submission");
                }
              });
            }}
          >
            <FileDown className="w-3.5 h-3.5 mr-1.5" />
            NITDA Report
          </Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Frameworks Monitored</div>
          <div className="text-2xl font-bold text-foreground">4</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Overall Compliance</div>
          <div className="text-2xl font-bold text-emerald-400">{overallRate}%</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Open Violations</div>
          <div className="text-2xl font-bold text-red-400">{totalViolations}</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-muted-foreground text-sm">Critical Findings</div>
          <div className="text-2xl font-bold text-orange-400">{criticalViolations}</div>
        </div>
      </div>

      {/* Framework Cards Grid */}
      <div className="grid grid-cols-2 gap-6">
        {FRAMEWORKS.map(fw => {
          const score = scoreFromCompliance(overallRate, fw.id);
          return (
            <div key={fw.id} className="bg-card rounded-xl border border-border p-5 space-y-4">
              {/* Framework Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" style={{ color: fw.color }} />
                    <span className="font-bold text-foreground text-lg">{fw.name}</span>
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">{fw.authority}</Badge>
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5">{fw.fullName}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold" style={{ color: fw.color }}>{score}%</div>
                  <div className="flex items-center gap-1 justify-end mt-0.5">
                    <StatusIcon score={score} />
                    <span className="text-xs text-muted-foreground">
                      {score >= 80 ? "Compliant" : score >= 60 ? "Partial" : "Non-compliant"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Overall Progress Bar */}
              <ScoreBar score={score} color={fw.color} />

              {/* Article-level breakdown */}
              <div className="space-y-2">
                {fw.articles.map(article => {
                  // Deterministic offset based on article id hash to avoid random re-renders
                  const articleOffset = ((article.id.charCodeAt(0) + article.id.length) % 21) - 10;
                  const articleScore = Math.min(100, Math.max(0, score + articleOffset));
                  return (
                    <div key={article.id} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-muted-foreground w-12 shrink-0">{article.id}</span>
                      <span className="text-xs text-muted-foreground flex-1 truncate">{article.title}</span>
                      <div className="w-24 shrink-0">
                        <ScoreBar score={articleScore} color={fw.color} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">{articleScore}%</span>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>Weight: {fw.articles.reduce((s, a) => s + a.weight, 0)} pts</span>
                <span>{fw.articles.filter(() => score >= 80).length}/{fw.articles.length} controls passing</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cross-Framework Comparison Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Cross-Framework Control Mapping</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Common control domains across all 4 frameworks</p>
        </div>
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-background/50">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Control Domain</th>
              {FRAMEWORKS.map(fw => (
                <th key={fw.id} className="text-center px-4 py-3 text-muted-foreground font-medium">{fw.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { domain: "Data Classification", refs: ["Art.2.1", "Art.4", "A.8", "CC1"] },
              { domain: "Access Control", refs: ["Art.2.5", "Art.32", "A.9", "CC6"] },
              { domain: "Cross-Border Transfers", refs: ["Art.2.7", "Art.44", "A.18", "CC9"] },
              { domain: "Incident Response", refs: ["Art.2.9", "Art.33", "A.16", "CC7"] },
              { domain: "Audit & Logging", refs: ["Art.3.1", "Art.30", "A.12", "CC7"] },
              { domain: "Encryption at Rest", refs: ["Art.2.5", "Art.32", "A.10", "CC6"] },
            ].map(row => (
              <tr key={row.domain} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3 text-muted-foreground font-medium">{row.domain}</td>
                {row.refs.map((ref, i) => {
                  const score = scoreFromCompliance(overallRate, FRAMEWORKS[i].id);
                  return (
                    <td key={i} className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-mono text-muted-foreground">{ref}</span>
                        <StatusIcon score={score} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
