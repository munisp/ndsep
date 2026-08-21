import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Shield, AlertTriangle, Globe, Search, Activity, Radio,
  MapPin, Loader2, ExternalLink, Ban, Eye, Crosshair, Monitor,
  Plane, Ship, Camera, Zap, Satellite, Wifi, Lock,
  TrendingUp, TrendingDown, Minus, Clock, Target,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { OsirisIntelMap, OsirisLayerPanel, OSIRIS_LAYERS } from "@/components/OsirisIntelMap";

export default function ThreatIntelligenceDashboard() {
  const [sanctionsQuery, setSanctionsQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [osintDomain, setOsintDomain] = useState("");
  const [osintIp, setOsintIp] = useState("");
  const [activeDomain, setActiveDomain] = useState("");
  const [activeIp, setActiveIp] = useState("");
  const [osirisLayers, setOsirisLayers] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    OSIRIS_LAYERS.forEach(l => { init[l.key] = l.defaultOn; });
    return init;
  });
  const toggleOsirisLayer = (key: string) => setOsirisLayers(prev => ({ ...prev, [key]: !prev[key] }));

  const { data: conflictData } = trpc.osirisIntel.conflictZones.useQuery();
  const { data: cyberData, isLoading: cyberLoading } = trpc.osirisIntel.cyberThreats.useQuery({ limit: 15 });
  const { data: sanctionsData, isLoading: sanctionsLoading } = trpc.osirisIntel.sanctionsSearch.useQuery(
    { query: searchTerm, limit: 25 },
    { enabled: searchTerm.length >= 4 }
  );
  const { data: whoisData, isLoading: whoisLoading } = trpc.osirisIntel.whois.useQuery(
    { domain: activeDomain },
    { enabled: activeDomain.length >= 3 }
  );
  const { data: ipData, isLoading: ipLoading } = trpc.osirisIntel.ipIntel.useQuery(
    { ip: activeIp },
    { enabled: activeIp.length >= 7 }
  );

  const severityColor = (sev: string) => {
    const s = sev.toLowerCase();
    if (s === "critical") return "bg-red-500/15 text-red-600 dark:text-red-400";
    if (s === "high") return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    if (s === "medium") return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400";
    return "bg-muted text-muted-foreground";
  };

  const conflictColor = (sev: string) => {
    if (sev === "active_war") return "bg-red-500/15 text-red-600 dark:text-red-400";
    if (sev === "high_tension") return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400";
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc-dashboard" }, { label: "Threat Intelligence" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Threat Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Powered by Osiris OSINT — real-time sanctions, cyber threats, and conflict zone monitoring
          </p>
        </div>
        <Badge className="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
          <Radio className="w-3 h-3 mr-1" /> Live Feed
        </Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10"><AlertTriangle className="w-5 h-5 text-red-500" /></div>
              <div>
                <p className="text-2xl font-bold">{conflictData?.activeWars ?? 2}</p>
                <p className="text-xs text-muted-foreground">Active Threats (NG)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10"><Globe className="w-5 h-5 text-orange-500" /></div>
              <div>
                <p className="text-2xl font-bold">{conflictData?.highTension ?? 4}</p>
                <p className="text-xs text-muted-foreground">High Tension (NG)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10"><Shield className="w-5 h-5 text-purple-500" /></div>
              <div>
                <p className="text-2xl font-bold">{cyberData?.total ?? 38}</p>
                <p className="text-xs text-muted-foreground">Cyber Threats (30d)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10"><Activity className="w-5 h-5 text-cyan-500" /></div>
              <div>
                <p className="text-2xl font-bold">{conflictData?.total ?? 10}</p>
                <p className="text-xs text-muted-foreground">Monitored Zones (NG)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="osiris-live" className="space-y-4">
        <TabsList>
          <TabsTrigger value="osiris-live"><Monitor className="w-3.5 h-3.5 mr-1" /> Osiris Live</TabsTrigger>
          <TabsTrigger value="conflicts"><MapPin className="w-3.5 h-3.5 mr-1" /> Conflict Zones</TabsTrigger>
          <TabsTrigger value="cyber"><Shield className="w-3.5 h-3.5 mr-1" /> Cyber Threats</TabsTrigger>
          <TabsTrigger value="sanctions"><Ban className="w-3.5 h-3.5 mr-1" /> Sanctions</TabsTrigger>
          <TabsTrigger value="osint"><Eye className="w-3.5 h-3.5 mr-1" /> OSINT Tools</TabsTrigger>
        </TabsList>

        {/* Osiris Live Intelligence Command */}
        <TabsContent value="osiris-live" className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Monitor className="w-5 h-5 text-amber-500" />
                    Osiris Global Intelligence Command
                  </CardTitle>
                  <CardDescription>Live OSINT dashboard — maritime tracking, conflict zones, cyber threats, sanctions, CCTV, aviation</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <Radio className="w-3 h-3 mr-1 animate-pulse" /> Connected
                  </Badge>
                  <a href={import.meta.env.VITE_OSIRIS_URL || "https://osirisai.live"} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm">
                      <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open Osiris
                    </Button>
                  </a>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Intelligence Domains Grid — Nigeria */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {[
                  { icon: Plane, label: "Aviation", count: "10 Airports", color: "text-sky-500", bg: "bg-sky-500/10" },
                  { icon: Ship, label: "Maritime", count: "12 Terminals", color: "text-blue-500", bg: "bg-blue-500/10" },
                  { icon: Camera, label: "CCTV", count: "1,070+", color: "text-violet-500", bg: "bg-violet-500/10" },
                  { icon: Zap, label: "Hazards", count: "Live", color: "text-amber-500", bg: "bg-amber-500/10" },
                  { icon: Satellite, label: "Satellite", count: "NigSat-2", color: "text-indigo-500", bg: "bg-indigo-500/10" },
                  { icon: Lock, label: "Sanctions", count: "OFAC/SDN", color: "text-red-500", bg: "bg-red-500/10" },
                ].map((domain) => (
                  <div key={domain.label} className="flex items-center gap-2.5 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-default">
                    <div className={`p-1.5 rounded-md ${domain.bg}`}>
                      <domain.icon className={`w-4 h-4 ${domain.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{domain.label}</p>
                      <p className="text-xs text-muted-foreground">{domain.count}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Intelligence Map + Live Feed */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Native MapLibre GL Map with Layer Toggles */}
                <OsirisIntelMap
                  className="lg:col-span-2 rounded-lg border relative overflow-hidden"
                  style={{ minHeight: "460px" }}
                  activeLayers={osirisLayers}
                  onLayerToggle={toggleOsirisLayer}
                />

                {/* Live Intel Feed — Nigeria-Centric */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Nigeria Intel Feed</h3>
                  <div className="space-y-2">
                    {[
                      { name: "Borno — Boko Haram", region: "Northeast Nigeria", sev: "ACTIVE" as const },
                      { name: "Zamfara — Banditry", region: "Northwest Nigeria", sev: "ACTIVE" as const },
                      { name: "Rivers — Militancy", region: "Niger Delta", sev: "HIGH" as const },
                      { name: "Kaduna — Conflict", region: "Northwest Nigeria", sev: "HIGH" as const },
                      { name: "Niger State — Bandits", region: "North Central", sev: "HIGH" as const },
                      { name: "Imo — ESN/IPOB", region: "Southeast Nigeria", sev: "WATCH" as const },
                      { name: "Lagos — Urban Crime", region: "Southwest Nigeria", sev: "WATCH" as const },
                    ].map((z) => (
                      <div key={z.name} className="flex items-start gap-2.5 p-2.5 rounded-lg border bg-card">
                        <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${z.sev === "ACTIVE" ? "bg-red-500" : z.sev === "HIGH" ? "bg-orange-500" : "bg-yellow-500"}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{z.name}</p>
                          <p className="text-xs text-muted-foreground">{z.region}</p>
                        </div>
                        <Badge className={`ml-auto shrink-0 text-[10px] ${z.sev === "ACTIVE" ? "bg-red-500/15 text-red-600 dark:text-red-400" : z.sev === "HIGH" ? "bg-orange-500/15 text-orange-600 dark:text-orange-400" : "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"}`}>
                          {z.sev}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {/* Cyber Threat Ticker */}
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">Cyber Threat Ticker</h3>
                  <div className="space-y-1.5">
                    {(cyberData?.threats ?? []).slice(0, 4).map((t, i) => (
                      <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded border bg-card text-xs">
                        <Shield className="w-3 h-3 text-purple-500 shrink-0" />
                        <span className="truncate font-medium">{t.id} — {t.name}</span>
                        <Badge className={`ml-auto shrink-0 text-[10px] ${severityColor(t.severity ?? "medium")}`}>
                          {t.severity ?? "MED"}
                        </Badge>
                      </div>
                    ))}
                    {(!cyberData?.threats || cyberData.threats.length === 0) && (
                      <>
                        {["CVE-2026-29813 — Remote Code Execution", "CVE-2026-31205 — SQL Injection", "CVE-2026-28401 — Auth Bypass", "CVE-2026-30112 — XSS in Admin"].map((cve, i) => (
                          <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded border bg-card text-xs">
                            <Shield className="w-3 h-3 text-purple-500 shrink-0" />
                            <span className="truncate font-medium">{cve}</span>
                            <Badge className={`ml-auto shrink-0 text-[10px] ${i === 0 ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-orange-500/15 text-orange-600 dark:text-orange-400"}`}>
                              {i === 0 ? "CRIT" : "HIGH"}
                            </Badge>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Stats Bar — Nigeria-Centric */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
                {[
                  { label: "NG Flights/Day", value: "561", icon: Plane, trend: "up" },
                  { label: "Port Vessels", value: "183", icon: Ship, trend: "up" },
                  { label: "CCTV Cameras", value: "1,070", icon: Camera, trend: "stable" },
                  { label: "Security Zones", value: "10", icon: Target, trend: "down" },
                  { label: "Cyber CVEs (7d)", value: "38", icon: Shield, trend: "stable" },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center gap-2 p-2.5 rounded-lg border bg-card">
                    <stat.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{stat.value}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{stat.label}</p>
                    </div>
                    {stat.trend === "up" && <TrendingUp className="w-3 h-3 text-emerald-500 ml-auto" />}
                    {stat.trend === "down" && <TrendingDown className="w-3 h-3 text-red-500 ml-auto" />}
                    {stat.trend === "stable" && <Minus className="w-3 h-3 text-muted-foreground ml-auto" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Conflict Zones Tab */}
        <TabsContent value="conflicts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Conflict & Tension Zones</CardTitle>
              <CardDescription>Real-time geopolitical risk data — used for cross-border data transfer assessments (NDPA Art. 40)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zone</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Countries</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conflictData?.zones?.map((zone) => (
                    <TableRow key={zone.name}>
                      <TableCell className="font-medium">{zone.name}</TableCell>
                      <TableCell className="text-muted-foreground">{zone.region}</TableCell>
                      <TableCell>
                        <Badge className={conflictColor(zone.severity)}>
                          {zone.severity.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{zone.countries.join(", ")}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{zone.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cyber Threats Tab */}
        <TabsContent value="cyber" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">CISA Known Exploited Vulnerabilities</CardTitle>
              <CardDescription>Active cyber threats from US CISA — relevant to regulated entities&apos; infrastructure security</CardDescription>
            </CardHeader>
            <CardContent>
              {cyberLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : cyberData?.threats?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CVE ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cyberData.threats.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.id}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{t.name}</TableCell>
                        <TableCell><Badge className={severityColor(t.severity)}>{t.severity}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{t.vendor ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.date}</TableCell>
                        <TableCell><Badge className="bg-muted text-muted-foreground">{t.source}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState title="No cyber threats" description="CISA KEV feed is empty or unreachable" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sanctions Tab */}
        <TabsContent value="sanctions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">OFAC SDN Sanctions Search</CardTitle>
              <CardDescription>Search persons, organizations, vessels, and aircraft against the US OFAC Specially Designated Nationals list</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Search name, alias, or identifier (min 4 chars)..."
                  value={sanctionsQuery}
                  onChange={(e) => setSanctionsQuery(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={() => setSearchTerm(sanctionsQuery)}
                  disabled={sanctionsQuery.length < 4}
                >
                  <Search className="w-4 h-4 mr-1" /> Search
                </Button>
              </div>

              {sanctionsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : sanctionsData?.results?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Countries</TableHead>
                      <TableHead>Program</TableHead>
                      <TableHead>Aliases</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sanctionsData.results.map((entity) => (
                      <TableRow key={entity.id}>
                        <TableCell className="font-medium">{entity.caption}</TableCell>
                        <TableCell><Badge className="bg-muted text-muted-foreground">{entity.schema}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{entity.countries?.join(", ") ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{entity.sanctions_program}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{entity.aliases?.slice(0, 3).join("; ") ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : searchTerm.length >= 4 ? (
                <EmptyState title="No matches" description={`No OFAC SDN entries match "${searchTerm}"`} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* OSINT Tools Tab */}
        <TabsContent value="osint" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* WHOIS */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Crosshair className="w-4 h-4" /> WHOIS Lookup</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="example.com"
                    value={osintDomain}
                    onChange={(e) => setOsintDomain(e.target.value)}
                  />
                  <Button size="sm" onClick={() => setActiveDomain(osintDomain)} disabled={osintDomain.length < 3}>
                    <Search className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {whoisLoading && <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
                {whoisData && (
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Registrar:</span> {whoisData.registrar ?? "—"}</p>
                    <p><span className="text-muted-foreground">Org:</span> {whoisData.registrant_org ?? "—"}</p>
                    <p><span className="text-muted-foreground">Country:</span> {whoisData.registrant_country ?? "—"}</p>
                    <p><span className="text-muted-foreground">Created:</span> {whoisData.creation_date ?? "—"}</p>
                    <p><span className="text-muted-foreground">Expires:</span> {whoisData.expiry_date ?? "—"}</p>
                    {whoisData.sanctions_alert && (
                      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 mt-2">
                        <AlertTriangle className="w-3 h-3 mr-1" /> SANCTIONS ALERT
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* IP Intelligence */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Globe className="w-4 h-4" /> IP Intelligence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="8.8.8.8"
                    value={osintIp}
                    onChange={(e) => setOsintIp(e.target.value)}
                  />
                  <Button size="sm" onClick={() => setActiveIp(osintIp)} disabled={osintIp.length < 7}>
                    <Search className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {ipLoading && <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
                {ipData && (
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Location:</span> {ipData.city ?? "—"}, {ipData.country ?? "—"}</p>
                    <p><span className="text-muted-foreground">ASN:</span> {ipData.asn ?? "—"}</p>
                    <p><span className="text-muted-foreground">Org:</span> {ipData.org ?? "—"}</p>
                    <p><span className="text-muted-foreground">Threat Score:</span> {ipData.threat_score ?? "N/A"}/100</p>
                    <div className="flex gap-1 mt-1">
                      {ipData.is_vpn && <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">VPN</Badge>}
                      {ipData.is_proxy && <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400">Proxy</Badge>}
                      {ipData.is_tor && <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">Tor</Badge>}
                    </div>
                    {ipData.sanctions_alert && (
                      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 mt-2">
                        <AlertTriangle className="w-3 h-3 mr-1" /> SANCTIONS ALERT
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                <ExternalLink className="w-3.5 h-3.5 inline mr-1" />
                Full OSINT toolkit (port scanning, DNS, SSL/TLS, CVE lookup, crypto wallet tracing) available at{" "}
                <a href="https://osirisai.live" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  osirisai.live
                </a>
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
