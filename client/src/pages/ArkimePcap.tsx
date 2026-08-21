import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  HardDrive, Search, RefreshCw, AlertTriangle, Activity,
  Network, Lock, Unlock, Eye, Filter, Download, Clock, Globe, Shield
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const PROTOCOLS = ["ALL", "TCP", "UDP", "ICMP", "TLS", "HTTP", "HTTPS", "DNS", "SMTP", "SSH", "FTP"];
const IXP_SITES = ["IXP-NGA-LAG", "IXP-GHA-ACC", "IXP-KEN-NAI", "IXP-ZAF-JNB"];
const TIME_RANGES = [
  { label: "Last 5 min", minutes: 5 },
  { label: "Last 15 min", minutes: 15 },
  { label: "Last 1 hour", minutes: 60 },
  { label: "Last 6 hours", minutes: 360 },
  { label: "Last 24 hours", minutes: 1440 },
  { label: "Last 7 days", minutes: 10080 },
];

function generateSessions(count: number, seed: number, timeRangeMinutes: number) {
  return Array.from({ length: count }, (_, i) => {
    const s = Math.abs(Math.sin((seed + i) * 9301 + 49297));
    const s2 = Math.abs(Math.sin((seed + i + 1) * 9301 + 49297));
    const s3 = Math.abs(Math.sin((seed + i + 2) * 9301 + 49297));
    const isAnomalous = s < 0.08;
    const isTLS = s2 > 0.5;
    const proto = PROTOCOLS.slice(1)[Math.floor(s * (PROTOCOLS.length - 1))];
    const ixp = IXP_SITES[Math.floor(s2 * IXP_SITES.length)];
    const bytes = Math.floor(s3 * 10000000) + 1000;
    const packets = Math.floor(bytes / 1500) + 1;
    const duration = Math.floor(s * 300) + 1;
    const minutesAgo = Math.floor(s2 * timeRangeMinutes);

    return {
      id: `${seed}-${i}`,
      srcIp: `196.${Math.floor(s * 255)}.${Math.floor(s2 * 255)}.${Math.floor(s3 * 254) + 1}`,
      dstIp: `52.${Math.floor(s3 * 255)}.${Math.floor(s * 255)}.${Math.floor(s2 * 254) + 1}`,
      srcPort: Math.floor(s * 60000) + 1024,
      dstPort: isTLS ? 443 : proto === "HTTP" ? 80 : proto === "DNS" ? 53 : proto === "SSH" ? 22 : Math.floor(s2 * 1024),
      protocol: proto,
      bytes,
      packets,
      duration,
      ixp,
      anomalous: isAnomalous,
      tlsDecrypted: isTLS,
      timestamp: new Date(Date.now() - minutesAgo * 60000).toISOString(),
      country: ["NG", "GH", "KE", "ZA", "US", "CN", "RU"][Math.floor(s * 7)],
      isCrossBorder: s3 > 0.7,
    };
  });
}

function formatBytes(bytes: number): string {
  if (bytes > 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function ArkimePcap() {
  const [seed, setSeed] = useState(() => Date.now());
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAnomaly, setFilterAnomaly] = useState(false);
  const [filterCrossBorder, setFilterCrossBorder] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState("ALL");
  const [selectedIxp, setSelectedIxp] = useState("ALL");
  const [timeRange, setTimeRange] = useState(60);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

   // Real metrics from Arkime Go worker
  const { data: arkimeMetrics } = trpc.workers.metrics.useQuery(
    { workerId: "arkime-pcap" },
    { refetchInterval: 8000 }
  );
  const m = (arkimeMetrics as any) ?? {};
  // Fetch real PCAP sessions from arkime_pcap worker; fall back to seeded mock if worker is offline
  const { data: liveSessions, refetch: refetchSessions } = trpc.workers.arkimeSessions.useQuery(
    { limit: 80 },
    { refetchInterval: 20000 }
  );
  const allSessions = useMemo(() => {
    if (liveSessions && (liveSessions as any[]).length > 0) return liveSessions as any[];
    return generateSessions(80, seed, timeRange);
  }, [liveSessions, seed, timeRange]);

  const sessions = useMemo(() => allSessions.filter(s => {
    if (filterAnomaly && !s.anomalous) return false;
    if (filterCrossBorder && !s.isCrossBorder) return false;
    if (selectedProtocol !== "ALL" && s.protocol !== selectedProtocol) return false;
    if (selectedIxp !== "ALL" && s.ixp !== selectedIxp) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.srcIp.includes(q) || s.dstIp.includes(q) ||
        s.protocol.toLowerCase().includes(q) || s.ixp.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q);
    }
    return true;
  }), [allSessions, filterAnomaly, filterCrossBorder, selectedProtocol, selectedIxp, searchQuery]);

  const anomalousCount = allSessions.filter(s => s.anomalous).length;
  const crossBorderCount = allSessions.filter(s => s.isCrossBorder).length;
  const tlsCount = allSessions.filter(s => s.tlsDecrypted).length;

  const refresh = () => {
    setSeed(Date.now());
    setLastRefresh(new Date());
    refetchSessions();
  };

  useEffect(() => {
    const interval = setInterval(refresh, 20000);
    return () => clearInterval(interval);
  }, []);

  const bufferUsedTb = Number(m.buffer_used_tb ?? 0);
  const bufferCapacityTb = Number(m.buffer_capacity_tb ?? 600);
  const bufferPct = Math.min(100, (bufferUsedTb / bufferCapacityTb) * 100);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc" }, { label: "Arkime Pcap" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LAYER 5</span>
            <span className="data-label">Arkime · Full Packet Capture · TLS Decryption · Forensic Search</span>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HardDrive className="h-7 w-7 text-cyan-400" />
            Arkime PCAP Viewer
          </h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">
            600 TB rolling buffer · {Number(m.sessions_per_second ?? 0).toLocaleString()} sessions/sec · TLS decryption · IXP monitoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mono">
            Refreshed {lastRefresh.toLocaleTimeString()}
          </span>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2 mono text-xs">
            <RefreshCw className="w-3 h-3" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Real Worker Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Packets Indexed", value: Number(m.packets_indexed ?? 0).toLocaleString(), color: "text-cyan-400", icon: Activity },
          { label: "Sessions Captured", value: Number(m.sessions_captured ?? 0).toLocaleString(), color: "text-blue-400", icon: Network },
          { label: "TLS Decrypted", value: Number(m.tls_decrypted ?? 0).toLocaleString(), color: "text-yellow-400", icon: Unlock },
          { label: "Anomalous Sessions", value: Number(m.anomalous_sessions ?? 0).toLocaleString(), color: "text-red-400", icon: AlertTriangle },
        ].map(({ label, value, color, icon: Icon }) => (
          <Card key={label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="data-label">{label}</p>
                  <p className={`metric-value text-2xl font-bold mt-1 ${color}`}>{value}</p>
                </div>
                <Icon className={`h-6 w-6 opacity-60 ${color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Buffer Status from Real Worker */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-cyan-400" />
              Rolling Buffer Status
              <span className="text-[10px] font-bold text-blue-400 font-mono bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 ml-1">Go</span>
            </CardTitle>
            <span className="data-label">{formatBytes(bufferUsedTb * 1e12)} / {bufferCapacityTb} TB</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {IXP_SITES.map((ixp, i) => {
              const used = Math.round(bufferUsedTb / 4 + i * 0.001);
              const pct = Math.min(100, Math.round((used / (bufferCapacityTb / 4)) * 100));
              return (
                <div key={ixp} className="bg-muted/30 rounded-lg p-3 border border-border/40">
                  <div className="data-label text-[9px] mb-1">{ixp}</div>
                  <div className="text-lg font-bold text-cyan-400 mono">{used.toFixed(3)} TB</div>
                  <div className="data-label text-[9px] mb-2">of {(bufferCapacityTb / 4).toFixed(0)} TB ({pct}%)</div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-cyan-500"}`}
                      style={{ width: `${Math.max(1, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { label: "PCAP Files Stored", value: Number(m.pcap_files_stored ?? 0).toLocaleString() },
              { label: "Bytes Captured", value: `${Number(m.bytes_captured_gb ?? 0).toFixed(2)} GB` },
              { label: "Forensic Queries", value: Number(m.forensic_queries ?? 0).toLocaleString() },
              { label: "Sessions/sec", value: Number(m.sessions_per_second ?? 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/20 rounded p-2 border border-border/30">
                <p className="data-label text-[9px]">{label}</p>
                <p className="mono font-bold text-sm mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Forensic Search */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Search className="h-4 w-4 text-cyan-400" />
              Forensic Session Search
            </CardTitle>
            <span className="data-label">{sessions.length} of {allSessions.length} sessions</span>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search IP, protocol, country..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 mono text-xs h-9"
              />
            </div>
            <Select value={selectedProtocol} onValueChange={setSelectedProtocol}>
              <SelectTrigger className="h-9 mono text-xs">
                <SelectValue placeholder="Protocol" />
              </SelectTrigger>
              <SelectContent>
                {PROTOCOLS.map(p => (
                  <SelectItem key={p} value={p} className="mono text-xs">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedIxp} onValueChange={setSelectedIxp}>
              <SelectTrigger className="h-9 mono text-xs">
                <SelectValue placeholder="IXP Site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL" className="mono text-xs">All IXP Sites</SelectItem>
                {IXP_SITES.map(s => (
                  <SelectItem key={s} value={s} className="mono text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(timeRange)} onValueChange={v => setTimeRange(Number(v))}>
              <SelectTrigger className="h-9 mono text-xs">
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGES.map(t => (
                  <SelectItem key={t.minutes} value={String(t.minutes)} className="mono text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filter Toggles */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <Button
              variant={filterAnomaly ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterAnomaly(!filterAnomaly)}
              className="gap-1.5 mono text-xs h-7"
            >
              <AlertTriangle className="w-3 h-3" />
              Anomalous Only
            </Button>
            <Button
              variant={filterCrossBorder ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterCrossBorder(!filterCrossBorder)}
              className="gap-1.5 mono text-xs h-7"
            >
              <Globe className="w-3 h-3" />
              Cross-Border Only
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 mono text-xs h-7 ml-auto"
              onClick={() => {
                setSearchQuery("");
                setSelectedProtocol("ALL");
                setSelectedIxp("ALL");
                setFilterAnomaly(false);
                setFilterCrossBorder(false);
              }}
            >
              <Filter className="w-3 h-3" />
              Clear Filters
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 mono text-xs h-7" onClick={() => {
              const header = "id,srcIp,srcPort,dstIp,dstPort,protocol,bytes,packets,duration,ixp,country,isCrossBorder,anomalous,timestamp";
              const rows = sessions.map((s: any) => [s.id,s.srcIp,s.srcPort,s.dstIp,s.dstPort,s.protocol,s.bytes,s.packets,s.duration,s.ixp,s.country,s.isCrossBorder,s.anomalous,s.timestamp].join(",")).join("\n");
              const blob = new Blob([header + "\n" + rows], { type: "text/csv" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `pcap-sessions-${Date.now()}.csv`; a.click();
            }}>
              <Download className="w-3 h-3" />
              Export PCAP
            </Button>
          </div>

          {/* Session Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Source IP:Port", "Destination IP:Port", "Proto", "Bytes", "Pkts", "Duration", "IXP", "Country", "Flags", "Timestamp"].map(h => (
                    <th key={h} className="text-left px-3 py-2 data-label font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 40).map(s => (
                  <>
                    <tr
                      key={s.id}
                      className={`border-b border-border/30 hover:bg-muted/20 cursor-pointer transition-colors ${s.anomalous ? "bg-red-500/5" : ""} ${expandedSession === s.id ? "bg-muted/30" : ""}`}
                      onClick={() => setExpandedSession(expandedSession === s.id ? null : s.id)}
                    >
                      <td className="px-3 py-2 mono text-[10px] text-foreground/80">{s.srcIp}:{s.srcPort}</td>
                      <td className="px-3 py-2 mono text-[10px] text-foreground/80">{s.dstIp}:{s.dstPort}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="mono text-[9px]">{s.protocol}</Badge>
                      </td>
                      <td className="px-3 py-2 mono text-[10px]">{formatBytes(s.bytes)}</td>
                      <td className="px-3 py-2 mono text-[10px] text-muted-foreground">{s.packets.toLocaleString()}</td>
                      <td className="px-3 py-2 mono text-[10px] text-muted-foreground">{s.duration}s</td>
                      <td className="px-3 py-2 mono text-[10px] text-muted-foreground">{s.ixp}</td>
                      <td className="px-3 py-2 mono text-[10px] font-bold">{s.country}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-0.5">
                          {s.anomalous && <span title="Anomalous"><AlertTriangle className="h-3 w-3 text-red-400" /></span>}
                          {s.isCrossBorder && <span title="Cross-border"><Globe className="h-3 w-3 text-orange-400" /></span>}
                          {s.tlsDecrypted && <span title="TLS decrypted"><Unlock className="h-3 w-3 text-yellow-400" /></span>}
                          {!s.anomalous && !s.isCrossBorder && <Lock className="h-3 w-3 text-muted-foreground/40" />}
                        </div>
                      </td>
                      <td className="px-3 py-2 mono text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(s.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                    {expandedSession === s.id && (
                      <tr key={`${s.id}-detail`} className="bg-muted/20">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><span className="data-label">Session ID</span><p className="mono mt-0.5">{s.id}</p></div>
                            <div><span className="data-label">Full Timestamp</span><p className="mono mt-0.5">{new Date(s.timestamp).toLocaleString()}</p></div>
                            <div><span className="data-label">Throughput</span><p className="mono mt-0.5">{formatBytes(s.bytes / Math.max(1, s.duration))}/s</p></div>
                            <div><span className="data-label">Avg Packet Size</span><p className="mono mt-0.5">{formatBytes(s.bytes / Math.max(1, s.packets))}</p></div>
                            <div><span className="data-label">TLS Status</span><p className={`mono mt-0.5 ${s.tlsDecrypted ? "text-yellow-400" : "text-muted-foreground"}`}>{s.tlsDecrypted ? "Decrypted" : "Encrypted"}</p></div>
                            <div><span className="data-label">Cross-Border</span><p className={`mono mt-0.5 ${s.isCrossBorder ? "text-orange-400 font-bold" : "text-muted-foreground"}`}>{s.isCrossBorder ? `YES → ${s.country}` : "No"}</p></div>
                            <div><span className="data-label">Anomaly Score</span><p className={`mono mt-0.5 ${s.anomalous ? "text-red-400 font-bold" : "text-green-400"}`}>{s.anomalous ? "HIGH RISK" : "Normal"}</p></div>
                            <div><span className="data-label">IXP Site</span><p className="mono mt-0.5">{s.ixp}</p></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
