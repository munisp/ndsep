/**
 * NDSEP NOC AI Agent Dashboard
 * =============================
 * Unified UI for the AI-powered NOC agent system.
 * 6 tabs: Overview, Anomalies, Diagnoses, Remediations, Knowledge, Predictions
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Zap, Shield, Activity, AlertTriangle, CheckCircle2, Clock, TrendingUp, Eye, Cpu, Bot } from "lucide-react";
import { trpc } from "@/lib/trpc";

function val<T>(data: unknown): T {
  return data as T;
}

function severityBadge(severity: string) {
  const colors: Record<string, string> = {
    critical: "bg-red-600 text-foreground",
    high: "bg-orange-500 text-foreground",
    medium: "bg-yellow-500 text-black",
    low: "bg-blue-500 text-foreground",
  };
  return <Badge className={colors[severity] || "bg-muted text-foreground"}>{severity}</Badge>;
}

function outcomeBadge(outcome: string) {
  const colors: Record<string, string> = {
    success: "bg-green-600 text-foreground",
    partial_success: "bg-yellow-500 text-black",
    failure: "bg-red-600 text-foreground",
    pending: "bg-blue-500 text-foreground",
    queued_for_approval: "bg-purple-500 text-foreground",
  };
  return <Badge className={colors[outcome] || "bg-muted text-foreground"}>{outcome.replace(/_/g, " ")}</Badge>;
}

function statusDot(status: string) {
  const colors: Record<string, string> = {
    healthy: "bg-green-500",
    active: "bg-green-500",
    degraded: "bg-yellow-500",
    down: "bg-red-500",
  };
  return <span className={`inline-block w-3 h-3 rounded-full ${colors[status] || "bg-muted-foreground"}`} />;
}

export default function NocAgentDashboard() {
  const dashboard = trpc.nocAgent.dashboard.useQuery();
  const anomalies = trpc.nocAgent.anomalies.useQuery();
  const diagnoses = trpc.nocAgent.diagnoses.useQuery();
  const executions = trpc.nocAgent.executions.useQuery();
  const knowledge = trpc.nocAgent.knowledgeBase.useQuery();
  const predictions = trpc.nocAgent.predictions.useQuery();
  const agentHealth = trpc.nocAgent.agentHealth.useQuery();
  const pending = trpc.nocAgent.pendingApprovals.useQuery();

  const d = val<Record<string, unknown>>(dashboard.data) || {};
  const agents = val<Record<string, Record<string, unknown>>>(d.agents) || {};
  const db = val<Record<string, number>>(d.database) || {};
  const orchestrator = val<Record<string, unknown>>(d.orchestrator) || {};

  const anomalyData = val<Record<string, unknown>>(anomalies.data) || {};
  const anomalyList = val<Record<string, unknown>[]>(anomalyData.anomalies) || [];

  const diagData = val<Record<string, unknown>>(diagnoses.data) || {};
  const diagList = val<Record<string, unknown>[]>(diagData.diagnoses) || [];

  const execData = val<Record<string, unknown>>(executions.data) || {};
  const execList = val<Record<string, unknown>[]>(execData.executions) || [];

  const kbData = val<Record<string, unknown>>(knowledge.data) || {};
  const kbPatterns = val<Record<string, unknown>[]>(kbData.patterns) || [];

  const predData = val<Record<string, unknown>>(predictions.data) || {};
  const predList = val<Record<string, unknown>[]>(predData.predictions) || [];

  const healthList = val<Record<string, unknown>[]>(agentHealth.data) || [];

  const pendingData = val<Record<string, unknown>>(pending.data) || {};
  const pendingList = val<Record<string, unknown>[]>(pendingData.pending) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-8 w-8 text-purple-400" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI NOC Agent</h1>
          <p className="text-sm text-zinc-400">Autonomous perception → reasoning → action loop</p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-zinc-800 border border-zinc-700">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
          <TabsTrigger value="remediations">Remediations</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          <TabsTrigger value="predictions">Predictions</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Overview ──────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          {/* Agent Health */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {healthList.map((agent, i) => (
              <Card key={i} className="bg-zinc-900 border-zinc-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {statusDot(String(agent.status))}
                    {String(agent.name)} Agent
                    <Badge variant="outline" className="ml-auto text-xs">{String(agent.lang)}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-zinc-400">
                    Port {String(agent.port)} · {agent.latency ? `${agent.latency}ms` : "unreachable"}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-blue-400" />
                  <div>
                    <p className="text-xs text-zinc-400">Anomalies Detected</p>
                    <p className="text-2xl font-bold text-foreground">{Number(anomalyData.total || 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-purple-400" />
                  <div>
                    <p className="text-xs text-zinc-400">Diagnoses Made</p>
                    <p className="text-2xl font-bold text-foreground">{diagList.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-400" />
                  <div>
                    <p className="text-xs text-zinc-400">Remediations</p>
                    <p className="text-2xl font-bold text-foreground">{execList.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-400" />
                  <div>
                    <p className="text-xs text-zinc-400">Predictions Active</p>
                    <p className="text-2xl font-bold text-foreground">{predList.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Orchestrator Status */}
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader><CardTitle className="text-sm">Orchestrator</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-zinc-400">Status:</span> <Badge className="bg-green-600 ml-1">{String(orchestrator.status || "inactive")}</Badge></div>
                <div><span className="text-zinc-400">Loop:</span> <span className="text-zinc-300 ml-1">{String(orchestrator.loop || "—")}</span></div>
                <div><span className="text-zinc-400">Auto Threshold:</span> <span className="text-zinc-300 ml-1">{String(orchestrator.auto_threshold || 0.85)}</span></div>
                <div><span className="text-zinc-400">DB Memories:</span> <span className="text-zinc-300 ml-1">{db.agent_memories || 0}</span></div>
              </div>
            </CardContent>
          </Card>

          {/* Pending Approvals */}
          {pendingList.length > 0 && (
            <Card className="bg-zinc-900 border-red-700 border-2">
              <CardHeader><CardTitle className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Pending Human Approvals ({pendingList.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {pendingList.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-zinc-800 rounded">
                      <div>
                        <p className="text-sm text-foreground">{String(p.root_cause || "").slice(0, 80)}</p>
                        <p className="text-xs text-zinc-400">Confidence: {Number(Number(p.confidence) * 100).toFixed(0)}% · {String(p.review_reason)}</p>
                      </div>
                      <Badge className="bg-purple-600">Awaiting Approval</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Tab 2: Anomalies ─────────────────────────────────────────────── */}
        <TabsContent value="anomalies" className="space-y-4">
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader><CardTitle className="text-sm">Detected Anomalies ({Number(anomalyData.total || 0)})</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 text-zinc-400">
                      <th className="text-left p-2">Severity</th>
                      <th className="text-left p-2">Service</th>
                      <th className="text-left p-2">Metric</th>
                      <th className="text-right p-2">Value</th>
                      <th className="text-right p-2">Z-Score</th>
                      <th className="text-right p-2">Isolation</th>
                      <th className="text-left p-2">Method</th>
                      <th className="text-right p-2">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomalyList.slice(0, 50).map((a, i) => (
                      <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800">
                        <td className="p-2">{severityBadge(String(a.severity))}</td>
                        <td className="p-2 text-zinc-300">{String(a.service_name)}</td>
                        <td className="p-2 text-zinc-400">{String(a.metric_name)}</td>
                        <td className="p-2 text-right text-foreground">{Number(a.current_value).toFixed(2)}</td>
                        <td className="p-2 text-right text-foreground">{Number(a.z_score).toFixed(2)}</td>
                        <td className="p-2 text-right text-foreground">{Number(a.isolation_score).toFixed(3)}</td>
                        <td className="p-2 text-zinc-400">{String(a.detection_method)}</td>
                        <td className="p-2 text-right text-foreground">{(Number(a.confidence) * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Diagnoses ─────────────────────────────────────────────── */}
        <TabsContent value="diagnoses" className="space-y-4">
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader><CardTitle className="text-sm">Root Cause Diagnoses ({diagList.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {diagList.slice(0, 20).map((d, i) => (
                  <div key={i} className="p-3 bg-zinc-800 rounded border border-zinc-700">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-purple-400" />
                        <span className="text-sm font-medium text-foreground">{String(d.root_cause_category || "").replace(/_/g, " ")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{(Number(d.confidence) * 100).toFixed(0)}% confidence</Badge>
                        {d.should_auto_execute
                          ? <Badge className="bg-green-600">Auto-Execute</Badge>
                          : <Badge className="bg-yellow-500 text-black">Human Review</Badge>
                        }
                      </div>
                    </div>
                    <p className="text-sm text-zinc-300 mb-1">{String(d.root_cause_hypothesis || "").slice(0, 200)}</p>
                    {d.matched_pattern ? (
                      <p className="text-xs text-zinc-500">Matched pattern: {String(d.matched_pattern)}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(val<string[]>(d.evidence) || []).slice(0, 3).map((e, j) => (
                        <span key={j} className="text-xs bg-zinc-700 px-2 py-0.5 rounded text-zinc-300">{e}</span>
                      ))}
                    </div>
                    {d.human_review_reason ? (
                      <p className="text-xs text-yellow-400 mt-1">{String(d.human_review_reason)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Remediations ──────────────────────────────────────────── */}
        <TabsContent value="remediations" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-400">Total Executions</p>
                <p className="text-2xl font-bold text-foreground">{execList.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-400">Successful</p>
                <p className="text-2xl font-bold text-green-400">{execList.filter(e => e.outcome === "success").length}</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-400">Failed</p>
                <p className="text-2xl font-bold text-red-400">{execList.filter(e => e.outcome === "failed").length}</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-400">Pending Approval</p>
                <p className="text-2xl font-bold text-purple-400">{pendingList.length}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader><CardTitle className="text-sm">Execution History</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 text-zinc-400">
                      <th className="text-left p-2">Outcome</th>
                      <th className="text-left p-2">Auto</th>
                      <th className="text-right p-2">Confidence</th>
                      <th className="text-right p-2">Steps</th>
                      <th className="text-right p-2">Duration</th>
                      <th className="text-left p-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execList.slice(0, 30).map((e, i) => (
                      <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800">
                        <td className="p-2">{outcomeBadge(String(e.outcome))}</td>
                        <td className="p-2">{e.was_auto_executed ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Clock className="h-4 w-4 text-yellow-400" />}</td>
                        <td className="p-2 text-right text-foreground">{(Number(e.confidence) * 100).toFixed(0)}%</td>
                        <td className="p-2 text-right text-foreground">{String(e.steps_succeeded)}/{String(e.steps_total)}</td>
                        <td className="p-2 text-right text-zinc-300">{Number(e.duration_ms)}ms</td>
                        <td className="p-2 text-zinc-400 max-w-xs truncate">{String(e.outcome_details || "").slice(0, 80)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 5: Knowledge Base ────────────────────────────────────────── */}
        <TabsContent value="knowledge" className="space-y-4">
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader><CardTitle className="text-sm">Incident Knowledge Graph ({kbPatterns.length} patterns)</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {kbPatterns.map((p, i) => (
                  <div key={i} className="p-3 bg-zinc-800 rounded border border-zinc-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">{String(p.incident_type || "").replace(/_/g, " ")}</span>
                      <Badge variant="outline">{(Number(p.success_rate || 0) * 100).toFixed(0)}% success</Badge>
                    </div>
                    <p className="text-xs text-zinc-400 mb-2">{String(p.root_cause || "").slice(0, 120)}</p>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>{String(p.root_cause_category || "").replace(/_/g, " ")}</span>
                      <span>·</span>
                      <span>{Number(p.occurrence_count || 0)} occurrences</span>
                      <span>·</span>
                      <span>Avg {Number(p.avg_resolution_seconds || 0)}s</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-xs text-zinc-500">{(val<unknown[]>(p.remediation_steps) || []).length} remediation steps</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 6: Predictions ───────────────────────────────────────────── */}
        <TabsContent value="predictions" className="space-y-4">
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-green-400" /> Active Predictions ({predList.length})</CardTitle></CardHeader>
            <CardContent>
              {predList.length === 0 ? (
                <p className="text-sm text-zinc-400">No active predictions — the system is operating within normal baselines.</p>
              ) : (
                <div className="space-y-3">
                  {predList.map((p, i) => (
                    <div key={i} className="p-3 bg-zinc-800 rounded border border-zinc-700">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground">{String(p.prediction_type || "").replace(/_/g, " ")}</span>
                        <Badge variant="outline">{(Number(p.confidence) * 100).toFixed(0)}% confidence</Badge>
                      </div>
                      <p className="text-sm text-zinc-300">{String(p.predicted_event || "")}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                        <span>Service: {String(p.affected_service)}</span>
                        <span>·</span>
                        <span>Predicted: {String(p.predicted_time || "").slice(0, 19)}</span>
                      </div>
                      {(val<string[]>(p.recommended_actions) || []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(val<string[]>(p.recommended_actions) || []).map((a, j) => (
                            <span key={j} className="text-xs bg-zinc-700 px-2 py-0.5 rounded text-green-300">{a}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
