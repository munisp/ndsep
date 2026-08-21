import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/SkeletonLoaders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  ArrowLeft, Building2, Shield, AlertTriangle, BookOpen,
  CheckCircle2, Clock, TrendingUp, FileText, Users,
} from "lucide-react";
import { toast } from "sonner";

const severityColor: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  low: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

const statusColor: Record<string, string> = {
  active: "bg-green-500/15 text-green-600 dark:text-green-400",
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  overdue: "bg-red-500/15 text-red-600 dark:text-red-400",
  draft: "bg-muted text-foreground",
  signed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

export default function DpcoClientDashboard() {
  const params = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const clientId = parseInt(params.clientId ?? "0", 10);

  const { data, isLoading, error } = trpc.dpco.getClientDetail.useQuery(
    { clientId },
    { enabled: clientId > 0 }
  );

  const { data: trendData } = trpc.dpco.clientComplianceTrend.useQuery(
    { organisationId: data?.client?.organisation_id ?? 0 },
    { enabled: !!data?.client?.organisation_id }
  );

  const renewalMutation = trpc.dpco.submitRenewalApplication.useMutation({
    onSuccess: () => toast.success("Renewal application submitted to NDPC"),
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  if (clientId === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No client selected. Go back to the Client Portfolio.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/dpco/clients")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Clients
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8"><PageSkeleton /></div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center text-destructive">
        <p>Failed to load client details: {error?.message ?? "Unknown error"}</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/dpco/clients")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Clients
        </Button>
      </div>
    );
  }

  const { client, correctiveActions, dpiaRenewals, trainingCompletion, recentBreaches } = data;
  const trainingPct = trainingCompletion.total > 0
    ? Math.round((trainingCompletion.completed / trainingCompletion.total) * 100)
    : 0;

  const chartData = trendData?.platformTrend?.map((pt: any) => {
    const orgPt = trendData.orgTrend?.find((o: any) => o.month === pt.month);
    return {
      month: pt.month,
      platform: Number(pt.avg_score),
      org: orgPt ? Number(orgPt.avg_score) : null,
    };
  }) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/dpco/clients")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            {client.org_name ?? "Unknown Organisation"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {client.sector?.toUpperCase()} &nbsp;·&nbsp; Contract: {client.contract_reference ?? "N/A"}
            &nbsp;·&nbsp; Engagement: {client.engagement_type}
          </p>
        </div>
        <Badge className={statusColor[client.status] ?? "bg-muted text-foreground"}>
          {client.status}
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Compliance Score</span>
            </div>
            <p className="text-3xl font-bold text-primary">{client.compliance_score ?? "—"}</p>
            <p className="text-xs text-muted-foreground">/100</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">Staff Training</span>
            </div>
            <p className="text-3xl font-bold text-blue-600">{trainingPct}%</p>
            <p className="text-xs text-muted-foreground">{trainingCompletion.completed}/{trainingCompletion.total} completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Open Breaches</span>
            </div>
            <p className="text-3xl font-bold text-orange-500">
              {recentBreaches.filter((b: any) => b.status !== "closed").length}
            </p>
            <p className="text-xs text-muted-foreground">of {recentBreaches.length} recent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-yellow-600" />
              <span className="text-xs text-muted-foreground">DPIA Renewals Due</span>
            </div>
            <p className="text-3xl font-bold text-yellow-600">{dpiaRenewals.length}</p>
            <p className="text-xs text-muted-foreground">upcoming</p>
          </CardContent>
        </Card>
      </div>

      {/* Compliance Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            12-Month NDPA Compliance Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No trend data available yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="platform" stroke="#6366f1" name="Platform Avg" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="org" stroke="#10b981" name={client.org_name ?? "Org"} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Corrective Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Latest Verification Statements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {correctiveActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No verification statements yet.</p>
            ) : correctiveActions.map((ca: any) => (
              <div key={ca.id} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Score: {ca.compliance_score ?? "N/A"}/100</span>
                  <Badge className={statusColor[ca.status] ?? "bg-muted text-foreground"} variant="secondary">
                    {ca.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{ca.findings_summary ?? "No findings summary"}</p>
                <p className="text-xs text-muted-foreground">Date: {ca.statement_date ? new Date(ca.statement_date).toLocaleDateString("en-NG") : "N/A"}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* DPIA Renewals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />
              Upcoming DPIA Renewals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dpiaRenewals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming DPIA renewals.</p>
            ) : dpiaRenewals.map((dpia: any) => (
              <div key={dpia.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium line-clamp-1">{dpia.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Due: {dpia.review_date ? new Date(dpia.review_date).toLocaleDateString("en-NG") : "N/A"}
                  </p>
                </div>
                <Badge className={severityColor[dpia.risk_level] ?? "bg-muted text-foreground"} variant="secondary">
                  {dpia.risk_level}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Staff Training */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Staff Training Completion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>{trainingCompletion.completed} completed</span>
              <span className="font-bold">{trainingPct}%</span>
            </div>
            <Progress value={trainingPct} className="h-3" />
            <p className="text-xs text-muted-foreground">
              {trainingCompletion.total - trainingCompletion.completed} staff members still pending training
            </p>
          </CardContent>
        </Card>

        {/* Recent Breaches */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" />
              Recent Breach Incidents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentBreaches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent breach incidents.</p>
            ) : recentBreaches.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium line-clamp-1">{b.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.detected_at ? new Date(b.detected_at).toLocaleDateString("en-NG") : "N/A"}
                    {b.ndpc_notified_at
                      ? <span className="ml-2 text-green-600">✓ NDPC Notified</span>
                      : <span className="ml-2 text-red-600">⚠ Not Notified</span>
                    }
                  </p>
                </div>
                <Badge className={severityColor[b.severity] ?? "bg-muted text-foreground"} variant="secondary">
                  {b.severity}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Renewal Action */}
      <Card className="border-dashed border-2 border-muted">
        <CardContent className="pt-4 flex items-center justify-between">
          <div>
            <p className="font-medium">DPCO Engagement Renewal</p>
            <p className="text-sm text-muted-foreground">
              Engagement ends: {client.engagement_end ? new Date(client.engagement_end).toLocaleDateString("en-NG") : "N/A"}
            </p>
          </div>
          <Button
            onClick={() => {
              if (!client.dpco_organisation_id) return toast.error("No DPCO organisation linked");
              renewalMutation.mutate({
                dpcoOrgId: client.dpco_organisation_id,
                renewalYear: new Date().getFullYear() + 1,
              });
            }}
            disabled={renewalMutation.isPending}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {renewalMutation.isPending ? "Submitting..." : "Submit Renewal Application"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
