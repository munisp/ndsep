import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { Plane, Ship, Activity, Flame, Cloud, Globe, Radio, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function SigintDashboard() {
  const { data: stats } = trpc.sigint.stats.useQuery();
  const { data: aircraft } = trpc.sigint.aircraft.useQuery({});
  const { data: vessels } = trpc.sigint.vessels.useQuery({});
  const { data: seismic } = trpc.sigint.seismic.useQuery({});
  const { data: fires } = trpc.sigint.fires.useQuery({});
  const { data: weather } = trpc.sigint.weather.useQuery({});
  const { data: gdelt } = trpc.sigint.gdelt.useQuery({ country: "NG", limit: 30 });
  const { data: correlations } = trpc.sigint.correlations.useQuery();

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc-dashboard" }, { label: "SIGINT Correlation" }]} />
      <div>
        <h1 className="text-2xl font-bold">SIGINT — Compound Threat Correlation</h1>
        <p className="text-muted-foreground">Multi-source intelligence: aircraft, vessels, seismic, fires, weather, GDELT events — correlated alerts</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { icon: Plane, label: "Aircraft", value: stats?.trackedAircraft ?? 0, color: "text-sky-500", bg: "bg-sky-500/10" },
          { icon: Plane, label: "Military", value: stats?.militaryAircraft ?? 0, color: "text-red-500", bg: "bg-red-500/10" },
          { icon: Ship, label: "Vessels", value: stats?.trackedVessels ?? 0, color: "text-cyan-500", bg: "bg-cyan-500/10" },
          { icon: Activity, label: "Seismic (24h)", value: stats?.seismicEvents24h ?? 0, color: "text-amber-500", bg: "bg-amber-500/10" },
          { icon: Flame, label: "Fires (24h)", value: stats?.fireHotspots24h ?? 0, color: "text-orange-500", bg: "bg-orange-500/10" },
          { icon: Cloud, label: "Weather Alerts", value: stats?.activeWeatherAlerts ?? 0, color: "text-blue-500", bg: "bg-blue-500/10" },
          { icon: Globe, label: "GDELT (24h)", value: stats?.gdeltEvents24h ?? 0, color: "text-purple-500", bg: "bg-purple-500/10" },
          { icon: Radio, label: "Correlations", value: stats?.activeCorrelations ?? 0, color: "text-rose-500", bg: "bg-rose-500/10" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5">
                <div className={`p-1 rounded ${s.bg}`}><s.icon className={`w-3 h-3 ${s.color}`} /></div>
                <div>
                  <p className="text-base font-bold">{s.value}</p>
                  <p className="text-[8px] text-muted-foreground">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Correlations (highlighted) */}
      {correlations && correlations.correlations.length > 0 && (
        <Card className="border-rose-500/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-500" /> Active Threat Correlations</CardTitle>
            <CardDescription>Multi-source events correlating within geographic proximity — compound threat indicators</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {correlations.correlations.map((c, i) => (
                <div key={c.id ?? i} className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{c.description}</span>
                    <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[10px]">Score: {c.score}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.sources.map(s => <Badge key={s} className="bg-muted text-muted-foreground text-[10px]">{s}</Badge>)}
                  </div>
                  <div className="mt-2 space-y-1">
                    {c.events.slice(0, 3).map((ev, j) => (
                      <p key={j} className="text-xs text-muted-foreground">• [{ev.source}] {ev.summary}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="aircraft">
        <TabsList>
          <TabsTrigger value="aircraft"><Plane className="w-3.5 h-3.5 mr-1" />Aircraft</TabsTrigger>
          <TabsTrigger value="vessels"><Ship className="w-3.5 h-3.5 mr-1" />Vessels</TabsTrigger>
          <TabsTrigger value="seismic"><Activity className="w-3.5 h-3.5 mr-1" />Seismic</TabsTrigger>
          <TabsTrigger value="fires"><Flame className="w-3.5 h-3.5 mr-1" />Fires</TabsTrigger>
          <TabsTrigger value="weather"><Cloud className="w-3.5 h-3.5 mr-1" />Weather</TabsTrigger>
          <TabsTrigger value="gdelt"><Globe className="w-3.5 h-3.5 mr-1" />GDELT</TabsTrigger>
        </TabsList>

        <TabsContent value="aircraft" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-lg">Aircraft Tracking (ADS-B)</CardTitle><CardDescription>Nigerian airspace — commercial, private, military, cargo</CardDescription></CardHeader>
            <CardContent>{!aircraft?.aircraft.length ? <EmptyState title="No aircraft data" description="Connect SIGINT ADS-B feed" /> : (
              <Table><TableHeader><TableRow><TableHead>Callsign</TableHead><TableHead>Type</TableHead><TableHead>Altitude</TableHead><TableHead>Speed</TableHead><TableHead>Operator</TableHead><TableHead>Category</TableHead></TableRow></TableHeader>
                <TableBody>{aircraft.aircraft.slice(0, 20).map((a, i) => (
                  <TableRow key={a.hex ?? i}>
                    <TableCell className="font-mono font-medium">{a.callsign || a.hex}</TableCell>
                    <TableCell className="text-xs">{a.type ?? "—"}</TableCell>
                    <TableCell>{a.altitude.toLocaleString()} ft</TableCell>
                    <TableCell>{a.speed} kn</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.operator ?? "—"}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${a.isMilitary ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>{a.category}</Badge></TableCell>
                  </TableRow>
                ))}</TableBody></Table>
            )}</CardContent></Card>
        </TabsContent>

        <TabsContent value="vessels" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-lg">AIS Vessel Tracking</CardTitle></CardHeader>
            <CardContent>{!vessels?.vessels.length ? <EmptyState title="No vessel data" description="Connect SIGINT AIS stream" /> : (
              <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>MMSI</TableHead><TableHead>Type</TableHead><TableHead>Flag</TableHead><TableHead>Speed</TableHead></TableRow></TableHeader>
                <TableBody>{vessels.vessels.slice(0, 20).map((v, i) => (
                  <TableRow key={v.mmsi ?? i}><TableCell className="font-medium">{v.name}</TableCell><TableCell className="font-mono text-xs">{v.mmsi}</TableCell><TableCell className="text-xs">{v.type}</TableCell><TableCell>{v.flag}</TableCell><TableCell>{v.speed} kn</TableCell></TableRow>
                ))}</TableBody></Table>
            )}</CardContent></Card>
        </TabsContent>

        <TabsContent value="seismic" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-lg">Seismic Events (USGS)</CardTitle></CardHeader>
            <CardContent>{!seismic?.events.length ? <EmptyState title="No seismic events" description="No events above threshold" /> : (
              <Table><TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Magnitude</TableHead><TableHead>Depth</TableHead><TableHead>Time</TableHead><TableHead>Tsunami</TableHead></TableRow></TableHeader>
                <TableBody>{seismic.events.slice(0, 15).map((e, i) => (
                  <TableRow key={e.id ?? i}><TableCell className="text-sm">{e.place}</TableCell><TableCell className="font-bold">{e.magnitude}</TableCell><TableCell>{e.depth} km</TableCell><TableCell className="text-xs text-muted-foreground">{e.time?.slice(0, 16).replace("T", " ")}</TableCell><TableCell>{e.tsunami ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 text-[10px]">YES</Badge> : "—"}</TableCell></TableRow>
                ))}</TableBody></Table>
            )}</CardContent></Card>
        </TabsContent>

        <TabsContent value="fires" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-lg">Fire Hotspots (NASA FIRMS)</CardTitle></CardHeader>
            <CardContent>{!fires?.hotspots.length ? <EmptyState title="No fire data" description="No hotspots in region" /> : (
              <Table><TableHeader><TableRow><TableHead>Lat</TableHead><TableHead>Lng</TableHead><TableHead>Brightness</TableHead><TableHead>Confidence</TableHead><TableHead>FRP</TableHead><TableHead>Satellite</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>{fires.hotspots.slice(0, 15).map((f, i) => (
                  <TableRow key={i}><TableCell>{f.lat.toFixed(3)}</TableCell><TableCell>{f.lng.toFixed(3)}</TableCell><TableCell>{f.brightness}</TableCell><TableCell><Badge className={`text-[10px] ${f.confidence === "high" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>{f.confidence}</Badge></TableCell><TableCell>{f.frp}</TableCell><TableCell className="text-xs">{f.satellite}</TableCell><TableCell className="text-xs text-muted-foreground">{f.acqDate}</TableCell></TableRow>
                ))}</TableBody></Table>
            )}</CardContent></Card>
        </TabsContent>

        <TabsContent value="weather" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-lg">Weather Alerts (NOAA)</CardTitle></CardHeader>
            <CardContent>{!weather?.alerts.length ? <EmptyState title="No weather alerts" description="No active severe weather" /> : (
              <div className="space-y-2">{weather.alerts.map((a, i) => (
                <div key={a.id ?? i} className="p-3 rounded-lg border bg-card flex items-start gap-3">
                  <Cloud className={`w-4 h-4 mt-0.5 ${a.severity === "extreme" ? "text-red-500" : a.severity === "severe" ? "text-orange-500" : "text-yellow-500"}`} />
                  <div className="min-w-0"><p className="text-sm font-medium">{a.event}</p><p className="text-xs text-muted-foreground">{a.headline}</p><p className="text-[10px] text-muted-foreground mt-1">{a.areaDesc}</p></div>
                  <Badge className={`shrink-0 text-[10px] ${a.severity === "extreme" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-orange-500/15 text-orange-600 dark:text-orange-400"}`}>{a.severity}</Badge>
                </div>
              ))}</div>
            )}</CardContent></Card>
        </TabsContent>

        <TabsContent value="gdelt" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-lg">GDELT Event Intelligence (Nigeria)</CardTitle><CardDescription>Global Database of Events, Language, and Tone — Nigerian events</CardDescription></CardHeader>
            <CardContent>{!gdelt?.events.length ? <EmptyState title="No GDELT events" description="Connect SIGINT GDELT feed" /> : (
              <Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Tone</TableHead><TableHead>Goldstein</TableHead><TableHead>Articles</TableHead><TableHead>Actor 1</TableHead><TableHead>Actor 2</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>{gdelt.events.slice(0, 15).map((e, i) => (
                  <TableRow key={e.id ?? i}><TableCell className="text-sm max-w-[250px] truncate">{e.title}</TableCell><TableCell className={`font-bold ${e.tone < -3 ? "text-red-500" : e.tone > 3 ? "text-emerald-500" : ""}`}>{e.tone.toFixed(1)}</TableCell><TableCell>{e.goldsteinScale.toFixed(1)}</TableCell><TableCell>{e.numArticles}</TableCell><TableCell className="text-xs">{e.actor1Country}</TableCell><TableCell className="text-xs">{e.actor2Country}</TableCell><TableCell className="text-xs text-muted-foreground">{e.dateAdded?.slice(0, 10)}</TableCell></TableRow>
                ))}</TableBody></Table>
            )}</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
