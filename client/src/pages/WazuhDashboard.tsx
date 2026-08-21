import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { Shield, Server, Bug, CheckCircle, FileText, Activity, AlertTriangle, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function WazuhDashboard() {
  const { data: stats } = trpc.wazuh.stats.useQuery();
  const { data: alerts } = trpc.wazuh.alerts.useQuery({ limit: 50 });
  const { data: agents } = trpc.wazuh.agents.useQuery();
  const { data: vulns } = trpc.wazuh.vulnerabilities.useQuery({});
  const { data: compliance } = trpc.wazuh.compliance.useQuery({ framework: "ndpa" });
  const { data: fim } = trpc.wazuh.fimEvents.useQuery({ limit: 30 });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc-dashboard" }, { label: "Wazuh SIEM" }]} />
      <div>
        <h1 className="text-2xl font-bold">Wazuh — SIEM & Compliance Monitoring</h1>
        <p className="text-muted-foreground">Endpoint detection, vulnerability management, NDPA/NDPR compliance for regulated entities</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { icon: Server, label: "Total Agents", value: stats?.totalAgents ?? 0, sub: `${stats?.activeAgents ?? 0} active`, color: "text-blue-500", bg: "bg-blue-500/10" },
          { icon: AlertTriangle, label: "Critical (24h)", value: stats?.criticalAlerts24h ?? 0, sub: `${stats?.highAlerts24h ?? 0} high`, color: "text-red-500", bg: "bg-red-500/10" },
          { icon: Bug, label: "Vulnerabilities", value: stats?.totalVulnerabilities ?? 0, sub: `${stats?.criticalVulnerabilities ?? 0} critical`, color: "text-orange-500", bg: "bg-orange-500/10" },
          { icon: CheckCircle, label: "Compliance", value: `${stats?.compliancePassRate ?? 0}%`, sub: "NDPA pass rate", color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { icon: FileText, label: "FIM Events (24h)", value: stats?.fimEvents24h ?? 0, sub: "file changes", color: "text-purple-500", bg: "bg-purple-500/10" },
          { icon: Lock, label: "Disconnected", value: stats?.disconnectedAgents ?? 0, sub: "agents offline", color: "text-muted-foreground", bg: "bg-muted" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-md ${s.bg}`}><s.icon className={`w-3.5 h-3.5 ${s.color}`} /></div>
                <div>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[9px] text-muted-foreground">{s.sub}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts"><AlertTriangle className="w-3.5 h-3.5 mr-1" />Alerts</TabsTrigger>
          <TabsTrigger value="agents"><Server className="w-3.5 h-3.5 mr-1" />Agents</TabsTrigger>
          <TabsTrigger value="vulns"><Bug className="w-3.5 h-3.5 mr-1" />Vulnerabilities</TabsTrigger>
          <TabsTrigger value="compliance"><CheckCircle className="w-3.5 h-3.5 mr-1" />NDPA Compliance</TabsTrigger>
          <TabsTrigger value="fim"><FileText className="w-3.5 h-3.5 mr-1" />File Integrity</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Security Alerts</CardTitle><CardDescription>Real-time alerts with MITRE ATT&CK technique mapping</CardDescription></CardHeader>
            <CardContent>
              {!alerts?.alerts.length ? <EmptyState title="No alerts" description="Connect Wazuh to monitor endpoints" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Rule</TableHead><TableHead>Agent</TableHead><TableHead>Level</TableHead><TableHead>MITRE</TableHead><TableHead>Groups</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {alerts.alerts.slice(0, 25).map((a, i) => (
                      <TableRow key={a.id ?? i}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{a.timestamp?.slice(11, 19)}</TableCell>
                        <TableCell className="text-sm max-w-[250px] truncate">{a.rule.description}</TableCell>
                        <TableCell className="text-xs font-mono">{a.agent.name}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${a.rule.level >= 12 ? "bg-red-500/15 text-red-600 dark:text-red-400" : a.rule.level >= 8 ? "bg-orange-500/15 text-orange-600 dark:text-orange-400" : "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"}`}>{a.rule.level}</Badge></TableCell>
                        <TableCell className="text-xs">{a.rule.mitreTechnique ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.rule.groups.slice(0, 2).join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Monitored Agents</CardTitle><CardDescription>Endpoints reporting to Wazuh — regulated entity infrastructure</CardDescription></CardHeader>
            <CardContent>
              {!agents?.agents.length ? <EmptyState title="No agents" description="Deploy Wazuh agents to monitored infrastructure" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>IP</TableHead><TableHead>OS</TableHead><TableHead>Status</TableHead><TableHead>Groups</TableHead><TableHead>Last Seen</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {agents.agents.slice(0, 25).map((a, i) => (
                      <TableRow key={a.id ?? i}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="font-mono text-xs">{a.ip}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.os}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${a.status === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}>{a.status}</Badge></TableCell>
                        <TableCell className="text-xs">{a.group.join(", ")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.lastKeepAlive?.slice(0, 16).replace("T", " ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vulns" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Vulnerability Assessment</CardTitle><CardDescription>CVE detection across all monitored agents — fix prioritization</CardDescription></CardHeader>
            <CardContent>
              {!vulns?.vulnerabilities.length ? <EmptyState title="No vulnerabilities" description="Deploy Wazuh vulnerability detector" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>CVE</TableHead><TableHead>Severity</TableHead><TableHead>CVSS</TableHead><TableHead>Package</TableHead><TableHead>Agent</TableHead><TableHead>Fix</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {vulns.vulnerabilities.slice(0, 25).map((v, i) => (
                      <TableRow key={`${v.cveId}-${v.agentId}-${i}`}>
                        <TableCell className="font-mono text-xs">{v.cveId}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${v.severity === "critical" ? "bg-red-500/15 text-red-600 dark:text-red-400" : v.severity === "high" ? "bg-orange-500/15 text-orange-600 dark:text-orange-400" : "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"}`}>{v.severity}</Badge></TableCell>
                        <TableCell className="font-bold">{v.cvssScore}</TableCell>
                        <TableCell className="text-xs font-mono">{v.affectedPackage}</TableCell>
                        <TableCell className="text-xs">{v.agentName}</TableCell>
                        <TableCell>{v.fixAvailable ? <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px]">Available</Badge> : <Badge className="bg-muted text-muted-foreground text-[10px]">No fix</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">NDPA/NDPR Compliance Checks</CardTitle><CardDescription>Security Configuration Assessment — Nigeria Data Protection compliance</CardDescription></CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4 p-3 rounded-lg border bg-card">
                <div className="text-center"><p className="text-2xl font-bold text-emerald-500">{compliance?.passRate ?? 0}%</p><p className="text-[10px] text-muted-foreground">Pass Rate</p></div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center"><p className="text-lg font-bold">{compliance?.passed ?? 0}</p><p className="text-[10px] text-muted-foreground">Passed</p></div>
                <div className="text-center"><p className="text-lg font-bold text-red-500">{compliance?.failed ?? 0}</p><p className="text-[10px] text-muted-foreground">Failed</p></div>
                <div className="text-center"><p className="text-lg font-bold">{compliance?.total ?? 0}</p><p className="text-[10px] text-muted-foreground">Total</p></div>
              </div>
              {!compliance?.checks.length ? <EmptyState title="No checks" description="Configure NDPA SCA policy in Wazuh" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Requirement</TableHead><TableHead>Status</TableHead><TableHead>Agent</TableHead><TableHead>Last Checked</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {compliance.checks.slice(0, 20).map((c, i) => (
                      <TableRow key={c.id ?? i}>
                        <TableCell className="text-sm max-w-[350px] truncate">{c.description}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${c.status === "passed" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : c.status === "failed" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>{c.status}</Badge></TableCell>
                        <TableCell className="text-xs">{c.agentName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.lastChecked?.slice(0, 10)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fim" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">File Integrity Monitoring</CardTitle><CardDescription>Filesystem changes detected across monitored infrastructure</CardDescription></CardHeader>
            <CardContent>
              {!fim?.events.length ? <EmptyState title="No FIM events" description="Enable syscheck on Wazuh agents" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Agent</TableHead><TableHead>Path</TableHead><TableHead>Event</TableHead><TableHead>User</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {fim.events.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{e.timestamp?.slice(11, 19)}</TableCell>
                        <TableCell className="text-xs">{e.agentName}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[300px] truncate">{e.path}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${e.event === "deleted" ? "bg-red-500/15 text-red-600 dark:text-red-400" : e.event === "modified" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}>{e.event}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.userId ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
