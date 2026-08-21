import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { Ship, Anchor, AlertTriangle, Search, Activity, MapPin, Shield, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function PhantomTideDashboard() {
  const [vesselQuery, setVesselQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: stats } = trpc.phantomTide.stats.useQuery();
  const { data: vessels } = trpc.phantomTide.vessels.useQuery({});
  const { data: sanctions } = trpc.phantomTide.sanctionAlerts.useQuery();
  const { data: anomalies } = trpc.phantomTide.anomalies.useQuery({ resolved: false });
  const { data: zones } = trpc.phantomTide.convergenceZones.useQuery();
  const { data: ports } = trpc.phantomTide.portActivity.useQuery({ country: "NG" });
  const { data: searchResults } = trpc.phantomTide.lookupVessel.useQuery(
    { query: searchTerm },
    { enabled: searchTerm.length >= 2 }
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc-dashboard" }, { label: "Maritime Intelligence" }]} />
      <div>
        <h1 className="text-2xl font-bold">Phantom Tide — Maritime Intelligence</h1>
        <p className="text-muted-foreground">Gulf of Guinea & Niger Delta: vessel tracking, sanctions screening, anomaly detection</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { icon: Ship, label: "Total Vessels", value: stats?.totalVessels ?? 0, color: "text-cyan-500", bg: "bg-cyan-500/10" },
          { icon: Shield, label: "Sanctioned", value: stats?.sanctionedVessels ?? 0, color: "text-red-500", bg: "bg-red-500/10" },
          { icon: AlertTriangle, label: "Anomalies", value: stats?.activeAnomalies ?? 0, color: "text-orange-500", bg: "bg-orange-500/10" },
          { icon: Radio, label: "Convergence", value: stats?.convergenceZones ?? 0, color: "text-purple-500", bg: "bg-purple-500/10" },
          { icon: Anchor, label: "Ports", value: stats?.moniteredPorts ?? 0, color: "text-blue-500", bg: "bg-blue-500/10" },
          { icon: Activity, label: "AIS Gaps (24h)", value: stats?.aisGaps24h ?? 0, color: "text-amber-500", bg: "bg-amber-500/10" },
          { icon: MapPin, label: "Avg Risk", value: `${(stats?.avgRiskScore ?? 0).toFixed(1)}`, color: "text-rose-500", bg: "bg-rose-500/10" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-md ${s.bg}`}><s.icon className={`w-3.5 h-3.5 ${s.color}`} /></div>
                <div>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[9px] text-muted-foreground">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Vessel Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Search className="w-4 h-4" /> Vessel Lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input value={vesselQuery} onChange={e => setVesselQuery(e.target.value)} placeholder="Search vessel name, MMSI, or IMO..." onKeyDown={e => { if (e.key === "Enter") setSearchTerm(vesselQuery); }} />
            <Button onClick={() => setSearchTerm(vesselQuery)} aria-label="Search vessel">Search</Button>
          </div>
          {searchResults && searchResults.results.length > 0 && (
            <Table className="mt-4">
              <TableHeader><TableRow>
                <TableHead>Name</TableHead><TableHead>MMSI</TableHead><TableHead>Type</TableHead><TableHead>Flag</TableHead><TableHead>Speed</TableHead><TableHead>Risk</TableHead><TableHead>Sanctioned</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {searchResults.results.map((v, i) => (
                  <TableRow key={v.mmsi ?? i}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell className="font-mono text-xs">{v.mmsi}</TableCell>
                    <TableCell><Badge className="bg-muted text-muted-foreground text-[10px]">{v.type}</Badge></TableCell>
                    <TableCell>{v.flag}</TableCell>
                    <TableCell>{v.speed} kn</TableCell>
                    <TableCell><span className={`font-bold ${v.riskScore > 70 ? "text-red-500" : v.riskScore > 40 ? "text-orange-500" : "text-emerald-500"}`}>{v.riskScore}</span></TableCell>
                    <TableCell>{v.sanctioned ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 text-[10px]">YES</Badge> : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="sanctions">
        <TabsList>
          <TabsTrigger value="sanctions"><Shield className="w-3.5 h-3.5 mr-1" />Sanctions Alerts</TabsTrigger>
          <TabsTrigger value="anomalies"><AlertTriangle className="w-3.5 h-3.5 mr-1" />Anomalies</TabsTrigger>
          <TabsTrigger value="convergence"><Radio className="w-3.5 h-3.5 mr-1" />Convergence Zones</TabsTrigger>
          <TabsTrigger value="ports"><Anchor className="w-3.5 h-3.5 mr-1" />Nigerian Ports</TabsTrigger>
        </TabsList>

        <TabsContent value="sanctions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Maritime Sanctions Alerts</CardTitle>
              <CardDescription>Vessels flagged by OFAC, EU, and UN sanctions lists entering Nigerian waters</CardDescription>
            </CardHeader>
            <CardContent>
              {!sanctions?.alerts.length ? <EmptyState title="No sanctions alerts" description="No sanctioned vessels detected in zone" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Vessel</TableHead><TableHead>MMSI</TableHead><TableHead>Flag</TableHead><TableHead>List</TableHead><TableHead>Reason</TableHead><TableHead>Severity</TableHead><TableHead>Detected</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {sanctions.alerts.map((a, i) => (
                      <TableRow key={a.mmsi ?? i}>
                        <TableCell className="font-medium">{a.vesselName}</TableCell>
                        <TableCell className="font-mono text-xs">{a.mmsi}</TableCell>
                        <TableCell>{a.flag}</TableCell>
                        <TableCell className="text-xs">{a.sanctionsList}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{a.reason}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${a.severity === "critical" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-orange-500/15 text-orange-600 dark:text-orange-400"}`}>{a.severity}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.detectedAt?.slice(0, 16).replace("T", " ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="anomalies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Maritime Anomalies</CardTitle>
              <CardDescription>AIS gaps, speed anomalies, route deviations, dark vessels, ship-to-ship transfers</CardDescription>
            </CardHeader>
            <CardContent>
              {!anomalies?.anomalies.length ? <EmptyState title="No anomalies" description="No active maritime anomalies" /> : (
                <div className="space-y-2">
                  {anomalies.anomalies.map((a, i) => (
                    <div key={a.id ?? i} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                      <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${a.confidence > 80 ? "text-red-500" : a.confidence > 50 ? "text-orange-500" : "text-yellow-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{a.vesselName} — <span className="text-muted-foreground">{a.type.replace(/_/g, " ")}</span></p>
                        <p className="text-xs text-muted-foreground">{a.description}</p>
                      </div>
                      <Badge className="text-[10px] bg-muted text-muted-foreground">{a.confidence}% conf</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="convergence" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Convergence Zones</CardTitle>
              <CardDescription>Multi-source overlap areas requiring attention — ranked by threat density</CardDescription>
            </CardHeader>
            <CardContent>
              {!zones?.zones.length ? <EmptyState title="No convergence zones" description="No high-density areas detected" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Zone</TableHead><TableHead>Vessels</TableHead><TableHead>Anomalies</TableHead><TableHead>Risk</TableHead><TableHead>Sources</TableHead><TableHead>Updated</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {zones.zones.map((z, i) => (
                      <TableRow key={z.id ?? i}>
                        <TableCell className="font-medium">{z.name}</TableCell>
                        <TableCell>{z.vesselCount}</TableCell>
                        <TableCell>{z.anomalyCount}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${z.riskLevel === "critical" ? "bg-red-500/15 text-red-600 dark:text-red-400" : z.riskLevel === "high" ? "bg-orange-500/15 text-orange-600 dark:text-orange-400" : "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"}`}>{z.riskLevel}</Badge></TableCell>
                        <TableCell className="text-xs">{z.sources.join(", ")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{z.lastUpdated?.slice(0, 16).replace("T", " ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Nigerian Port Activity</CardTitle>
              <CardDescription>Real-time arrivals, departures, anchorage, and sanctioned vessel detection</CardDescription>
            </CardHeader>
            <CardContent>
              {!ports?.ports.length ? <EmptyState title="No port data" description="Connect Phantom Tide for port intelligence" /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Port</TableHead><TableHead>Arrivals (24h)</TableHead><TableHead>Departures (24h)</TableHead><TableHead>At Anchor</TableHead><TableHead>Avg Dwell</TableHead><TableHead>Sanctioned</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {ports.ports.map((p, i) => (
                      <TableRow key={p.portName ?? i}>
                        <TableCell className="font-medium">{p.portName}</TableCell>
                        <TableCell>{p.arrivals24h}</TableCell>
                        <TableCell>{p.departures24h}</TableCell>
                        <TableCell>{p.anchorage}</TableCell>
                        <TableCell>{p.avgDwell_hours}h</TableCell>
                        <TableCell>{p.sanctionedVessels > 0 ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 text-[10px]">{p.sanctionedVessels}</Badge> : "0"}</TableCell>
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
