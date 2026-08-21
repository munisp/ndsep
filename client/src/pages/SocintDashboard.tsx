import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageLoader } from "@/components/PageLoader";
import { EmptyState } from "@/components/EmptyState";
import {
  Shield, Search, AlertTriangle, Eye, Bug, Skull,
  Radio, Globe, Lock, FileCode, Database, Activity,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

function severityColor(sev: string) {
  switch (sev) {
    case "critical": return "bg-red-500/15 text-red-600 dark:text-red-400";
    case "high": return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    case "medium": return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400";
    case "low": return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function tlpColor(tlp: string) {
  switch (tlp) {
    case "RED": return "bg-red-500/15 text-red-600 dark:text-red-400";
    case "AMBER": return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "GREEN": return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "WHITE": return "bg-muted text-muted-foreground";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function SocintDashboard() {
  const [iocQuery, setIocQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: indicators, isLoading: indicatorsLoading } = trpc.socint.indicators.useQuery({ limit: 100 });
  const { data: rules } = trpc.socint.detectionRules.useQuery({});
  const { data: darkWeb } = trpc.socint.darkWebHits.useQuery({ limit: 50 });
  const { data: cases } = trpc.socint.cases.useQuery({});
  const { data: ransomware } = trpc.socint.ransomwareGroups.useQuery();
  const { data: cves } = trpc.socint.cves.useQuery({ exploitedOnly: true });
  const { data: connectors } = trpc.socint.connectors.useQuery();
  const { data: searchResults } = trpc.socint.searchIndicator.useQuery(
    { value: searchTerm },
    { enabled: searchTerm.length >= 3 }
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc-dashboard" }, { label: "SOCint CTI Hub" }]} />
      <div>
        <h1 className="text-2xl font-bold">SOCint — Cyber Threat Intelligence</h1>
        <p className="text-muted-foreground">Unified CTI platform — indicators, detection rules, dark web tracking, case management</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { icon: Database, label: "IOCs", value: indicators?.total ?? 0, color: "text-blue-500", bg: "bg-blue-500/10" },
          { icon: FileCode, label: "Detection Rules", value: rules?.total ?? 0, color: "text-purple-500", bg: "bg-purple-500/10" },
          { icon: Eye, label: "Dark Web Hits", value: darkWeb?.total ?? 0, color: "text-red-500", bg: "bg-red-500/10" },
          { icon: Shield, label: "Active Cases", value: cases?.total ?? 0, color: "text-amber-500", bg: "bg-amber-500/10" },
          { icon: Skull, label: "Ransomware Groups", value: ransomware?.total ?? 0, color: "text-rose-500", bg: "bg-rose-500/10" },
          { icon: Bug, label: "Exploited CVEs", value: cves?.total ?? 0, color: "text-orange-500", bg: "bg-orange-500/10" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-md ${s.bg}`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
                <div>
                  <p className="text-xl font-bold">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* IOC Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Search className="w-4 h-4" /> IOC Lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={iocQuery}
              onChange={e => setIocQuery(e.target.value)}
              placeholder="Search IP, domain, hash, email..."
              onKeyDown={e => { if (e.key === "Enter" && iocQuery.length >= 3) setSearchTerm(iocQuery); }}
            />
            <Button onClick={() => { if (iocQuery.length >= 3) setSearchTerm(iocQuery); }} aria-label="Search IOC">Search</Button>
          </div>
          {searchResults && searchResults.results.length > 0 && (
            <Table className="mt-4">
              <TableHeader><TableRow>
                <TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Confidence</TableHead><TableHead>TLP</TableHead><TableHead>Source</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {searchResults.results.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell><Badge className="bg-muted text-muted-foreground text-[10px]">{r.type}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.value}</TableCell>
                    <TableCell>{r.confidence}%</TableCell>
                    <TableCell><Badge className={`text-[10px] ${tlpColor(r.tlp)}`}>{r.tlp}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="indicators">
        <TabsList>
          <TabsTrigger value="indicators"><Database className="w-3.5 h-3.5 mr-1" />Indicators</TabsTrigger>
          <TabsTrigger value="rules"><FileCode className="w-3.5 h-3.5 mr-1" />Detection Rules</TabsTrigger>
          <TabsTrigger value="darkweb"><Eye className="w-3.5 h-3.5 mr-1" />Dark Web</TabsTrigger>
          <TabsTrigger value="ransomware"><Skull className="w-3.5 h-3.5 mr-1" />Ransomware</TabsTrigger>
          <TabsTrigger value="cves"><Bug className="w-3.5 h-3.5 mr-1" />CVEs</TabsTrigger>
          <TabsTrigger value="connectors"><Radio className="w-3.5 h-3.5 mr-1" />Connectors</TabsTrigger>
        </TabsList>

        <TabsContent value="indicators" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Indicators of Compromise</CardTitle>
              <CardDescription>Aggregated from 50+ threat feeds — auto-extracted IOCs with MITRE ATT&CK mapping</CardDescription>
            </CardHeader>
            <CardContent>
              {indicatorsLoading ? <PageLoader /> : !indicators?.indicators.length ? <EmptyState title="No indicators" description="No IOCs found" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Confidence</TableHead><TableHead>TLP</TableHead><TableHead>MITRE</TableHead><TableHead>Source</TableHead><TableHead>Last Seen</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {indicators.indicators.slice(0, 30).map((ind, i) => (
                      <TableRow key={ind.id ?? i}>
                        <TableCell><Badge className="bg-muted text-muted-foreground text-[10px]">{ind.type}</Badge></TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">{ind.value}</TableCell>
                        <TableCell>{ind.confidence}%</TableCell>
                        <TableCell><Badge className={`text-[10px] ${tlpColor(ind.tlp)}`}>{ind.tlp}</Badge></TableCell>
                        <TableCell className="text-xs">{ind.mitreTechniques.slice(0, 2).join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ind.source}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ind.lastSeen?.slice(0, 10) ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Detection Rules</CardTitle>
              <CardDescription>500+ Sigma, YARA, Snort, Suricata, and STIX patterns with MITRE technique linkage</CardDescription>
            </CardHeader>
            <CardContent>
              {!rules?.rules.length ? <EmptyState title="No rules" description="Connect SOCint to load detection rules" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>MITRE Tactic</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rules.rules.slice(0, 30).map((r, i) => (
                      <TableRow key={r.id ?? i}>
                        <TableCell className="font-medium text-sm max-w-[250px] truncate">{r.name}</TableCell>
                        <TableCell><Badge className="bg-muted text-muted-foreground text-[10px]">{r.type}</Badge></TableCell>
                        <TableCell><Badge className={`text-[10px] ${severityColor(r.severity)}`}>{r.severity}</Badge></TableCell>
                        <TableCell className="text-xs">{r.mitreTactic || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.source}</TableCell>
                        <TableCell>{r.enabled ? <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px]">Active</Badge> : <Badge className="bg-muted text-muted-foreground text-[10px]">Disabled</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="darkweb" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Dark Web Intelligence</CardTitle>
              <CardDescription>Tor crawl hits, Telegram channel mentions, paste site monitoring</CardDescription>
            </CardHeader>
            <CardContent>
              {!darkWeb?.hits.length ? <EmptyState title="No dark web hits" description="Connect SOCint to monitor dark web" /> : (
                <div className="space-y-2">
                  {darkWeb.hits.slice(0, 20).map((hit, i) => (
                    <div key={hit.id ?? i} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                      <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${hit.threatLevel === "critical" ? "bg-red-500" : hit.threatLevel === "high" ? "bg-orange-500" : hit.threatLevel === "medium" ? "bg-yellow-500" : "bg-blue-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{hit.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{hit.snippet}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className="bg-muted text-muted-foreground text-[10px]">{hit.source}</Badge>
                          {hit.actorGroup && <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 text-[10px]">{hit.actorGroup}</Badge>}
                          <span className="text-[10px] text-muted-foreground ml-auto">{hit.timestamp?.slice(0, 10)}</span>
                        </div>
                      </div>
                      <Badge className={`shrink-0 text-[10px] ${severityColor(hit.threatLevel)}`}>{hit.threatLevel.toUpperCase()}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ransomware" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ransomware Group Tracker</CardTitle>
              <CardDescription>Active ransomware groups, victim counts, targeted sectors and countries</CardDescription>
            </CardHeader>
            <CardContent>
              {!ransomware?.groups.length ? <EmptyState title="No groups tracked" description="Connect SOCint ransomware.live integration" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Group</TableHead><TableHead>Victims</TableHead><TableHead>Last Active</TableHead><TableHead>Target Sectors</TableHead><TableHead>Target Countries</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {ransomware.groups.slice(0, 20).map((g, i) => (
                      <TableRow key={g.name ?? i}>
                        <TableCell className="font-medium">{g.name}</TableCell>
                        <TableCell className="font-bold">{g.victimCount}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{g.lastActive?.slice(0, 10)}</TableCell>
                        <TableCell className="text-xs">{g.targetSectors.slice(0, 3).join(", ")}</TableCell>
                        <TableCell className="text-xs">{g.targetCountries.slice(0, 3).join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cves" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Exploited Vulnerabilities (NVD + EPSS)</CardTitle>
              <CardDescription>CVEs actively exploited in the wild with CVSS and EPSS scores</CardDescription>
            </CardHeader>
            <CardContent>
              {!cves?.cves.length ? <EmptyState title="No CVEs" description="Connect SOCint NVD integration" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>CVE ID</TableHead><TableHead>Severity</TableHead><TableHead>CVSS</TableHead><TableHead>EPSS</TableHead><TableHead>Description</TableHead><TableHead>Published</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {cves.cves.slice(0, 20).map((c, i) => (
                      <TableRow key={c.cveId ?? i}>
                        <TableCell className="font-mono text-xs font-medium">{c.cveId}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${severityColor(c.severity)}`}>{c.severity}</Badge></TableCell>
                        <TableCell className="font-bold">{c.cvssScore}</TableCell>
                        <TableCell className="text-xs">{(c.epssScore * 100).toFixed(1)}%</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{c.description}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.publishedDate?.slice(0, 10)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connectors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Connector Status</CardTitle>
              <CardDescription>22 built-in connectors — abuse.ch, OTX, MISP, TAXII, CISA KEV, NVD, MITRE ATT&CK, Sigma</CardDescription>
            </CardHeader>
            <CardContent>
              {!connectors?.connectors.length ? <EmptyState title="No connectors" description="Deploy SOCint to activate connectors" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Connector</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Last Run</TableHead><TableHead>Next Run</TableHead><TableHead>Records</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {connectors.connectors.map((c, i) => (
                      <TableRow key={c.name ?? i}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell><Badge className="bg-muted text-muted-foreground text-[10px]">{c.type}</Badge></TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${c.status === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : c.status === "error" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.lastRun?.slice(0, 16).replace("T", " ")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.nextRun?.slice(0, 16).replace("T", " ")}</TableCell>
                        <TableCell className="font-mono text-xs">{c.recordsProcessed.toLocaleString()}</TableCell>
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
