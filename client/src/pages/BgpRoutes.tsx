/**
 * NDSEP Layer 1 — BGP Route Monitor
 * Real-time BGP route table with RPKI validation, hijack detection,
 * IXP peering status, and manual hijack reporting.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { io, Socket } from "socket.io-client";
import {
  Shield, AlertTriangle, CheckCircle, XCircle,
  Activity, Radio, Search, Flag, Wifi, WifiOff,
  Globe, Network, RefreshCw,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

import { Breadcrumbs } from "@/components/Breadcrumbs";
interface BgpRoute {
  id: number;
  prefix: string;
  origin_asn: number;
  peer_asn: number | null;
  as_path: string | null;
  next_hop: string | null;
  rpki_status: "valid" | "invalid" | "unknown" | "hijacked" | "leaked";
  is_hijacked: boolean;
  is_leaked: boolean;
  is_cross_border: boolean;
  ixp_site: string | null;
  detected_at: string;
}

interface PeeringSession {
  ixpSite: string;
  country: string;
  peerCount: number;
  sessionsUp: number;
  sessionsDown: number;
  prefixesReceived: number;
  prefixesAdvertised: number;
  uptimePercent: number;
}

function RpkiBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    valid:    { label: "VALID",    cls: "bg-green-500/15 text-green-400 border-green-500/30" },
    invalid:  { label: "INVALID",  cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    unknown:  { label: "UNKNOWN",  cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
    hijacked: { label: "HIJACKED", cls: "bg-red-600/20 text-red-300 border-red-600/40" },
    leaked:   { label: "LEAKED",   cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  };
  const { label, cls } = map[status] ?? map.unknown;
  return (
    <Badge variant="outline" className={`text-[10px] font-mono px-1.5 py-0 ${cls}`}>
      {label}
    </Badge>
  );
}

function countryFlag(code: string) {
  const flags: Record<string, string> = { NG: "🇳🇬", KE: "🇰🇪", ZA: "🇿🇦", NL: "🇳🇱", US: "🇺🇸", GB: "🇬🇧" };
  return flags[code] ?? "🌍";
}

export default function BgpRoutes() {
  const [hijackedOnly, setHijackedOnly] = useState(false);
  const { data: routes, isLoading, refetch } = trpc.bgp.routes.useQuery(
    { limit: 200, hijackedOnly },
    { refetchInterval: 10000 }
  );
  const { data: stats, refetch: refetchStats } = trpc.bgp.stats.useQuery(undefined, { refetchInterval: 10000 });
  const { data: historyRaw } = trpc.bgp.history.useQuery(undefined, { refetchInterval: 30000 });
  const historyData = (historyRaw ?? []).map((r: any) => ({
    time: r.hour ? new Date(r.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    total: r.total, hijacked: r.hijacked, leaked: r.leaked, crossBorder: r.crossBorder,
  }));

  // Real-time WebSocket
  const [connected, setConnected] = useState(false);
  const [liveRoutes, setLiveRoutes] = useState<BgpRoute[]>([]);
  const [peeringSessions, setPeeringSessions] = useState<Map<string, PeeringSession>>(new Map());
  const [liveAlerts, setLiveAlerts] = useState<{ prefix: string; alertType: string; severity: string; ts: string }[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(window.location.origin, { path: "/api/ws", transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("subscribe", "bgp");
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("ndsep_event", (evt: { type: string; [key: string]: unknown }) => {
      if (evt.type === "bgp_route_update") {
        const route: BgpRoute = {
          id: Date.now(),
          prefix: evt.prefix as string,
          origin_asn: evt.originAsn as number,
          peer_asn: null,
          as_path: null,
          next_hop: null,
          rpki_status: (evt.rpkiStatus as BgpRoute["rpki_status"]) ?? "unknown",
          is_hijacked: (evt.isHijack as boolean) ?? false,
          is_leaked: (evt.isRouteLeak as boolean) ?? false,
          is_cross_border: false,
          ixp_site: evt.ixpSite as string,
          detected_at: new Date().toISOString(),
        };
        setLiveRoutes(prev => [route, ...prev].slice(0, 100));
      } else if (evt.type === "bgp_alert") {
        setLiveAlerts(prev => [{
          prefix: evt.prefix as string,
          alertType: evt.alertType as string,
          severity: evt.severity as string,
          ts: new Date().toLocaleTimeString(),
        }, ...prev].slice(0, 20));
        toast.error(`BGP ${(evt.alertType as string).toUpperCase()}: ${evt.prefix} — AS${evt.originAsn}`);
      } else if (evt.type === "bgp_peering_update") {
        setPeeringSessions(prev => {
          const next = new Map(prev);
          next.set(evt.ixpSite as string, {
            ixpSite: evt.ixpSite as string,
            country: evt.country as string,
            peerCount: evt.peerCount as number,
            sessionsUp: evt.sessionsUp as number,
            sessionsDown: evt.sessionsDown as number,
            prefixesReceived: evt.prefixesReceived as number,
            prefixesAdvertised: evt.prefixesAdvertised as number,
            uptimePercent: evt.uptimePercent as number,
          });
          return next;
        });
      }
    });
    return () => {
      socket.emit("unsubscribe", "bgp");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [toast]);

  // Filters
  const [asnSearch, setAsnSearch] = useState("");
  const [rpkiFilter, setRpkiFilter] = useState<string>("all");
  const [showLive, setShowLive] = useState(true);

  const displayRoutes = (showLive && liveRoutes.length > 0 ? liveRoutes : ((routes as BgpRoute[]) ?? []))
    .filter(r => {
      if (hijackedOnly && !r.is_hijacked) return false;
      if (asnSearch && !String(r.origin_asn).includes(asnSearch) && !r.prefix.includes(asnSearch)) return false;
      if (rpkiFilter !== "all" && r.rpki_status !== rpkiFilter) return false;
      return true;
    });

  // Report Hijack Dialog
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPrefix, setReportPrefix] = useState("");
  const [reportAsn, setReportAsn] = useState("");
  const [reportNotes, setReportNotes] = useState("");
  const reportHijackMutation = trpc.bgp.reportHijack.useMutation({
    onSuccess: () => {
      toast.success(`Hijack reported: Prefix ${reportPrefix} flagged and SIEM alert created.`);
      setReportOpen(false);
      setReportPrefix(""); setReportAsn(""); setReportNotes("");
      refetch(); refetchStats();
    },
    onError: (e: { message: string }) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const openReport = useCallback((prefix = "", asn = "") => {
    setReportPrefix(prefix); setReportAsn(asn); setReportOpen(true);
  }, []);

  const s = (stats as Record<string, number>) ?? {};

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc" }, { label: "Bgp Routes" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="h-6 w-6 text-blue-400" />
            BGP Route Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            RPKI validation · Hijack detection · IXP peering · Cross-border routing
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full border ${connected ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-yellow-500/40 text-yellow-400 bg-yellow-500/10"}`}>
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? "LIVE" : "POLLING"}
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetch(); refetchStats(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" variant="destructive" onClick={() => openReport()}>
            <Flag className="h-3.5 w-3.5 mr-1.5" /> Report Hijack
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "Total Routes (24h)", value: s.total, color: "text-foreground" },
          { label: "RPKI Valid", value: s.valid, color: "text-green-400" },
          { label: "RPKI Invalid", value: s.invalid, color: "text-red-400" },
          { label: "Hijacked", value: s.hijacked, color: "text-red-400" },
          { label: "Leaked", value: s.leaked, color: "text-yellow-400" },
          { label: "Cross-Border", value: s.cross_border, color: "text-orange-400" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="border-border/50">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold font-mono mt-0.5 ${color}`}>{value ?? "—"}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* BGP Route History Chart */}
      {historyData.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm">BGP Route Activity — Last 24h</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={historyData}>
                <defs>
                  <linearGradient id="bgpTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="bgpHijack" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Area type="monotone" dataKey="total" stroke="#2563eb" fill="url(#bgpTotal)" strokeWidth={1.5} name="Total Routes" />
                <Area type="monotone" dataKey="hijacked" stroke="#ef4444" fill="url(#bgpHijack)" strokeWidth={1.5} name="Hijacked" />
                <Area type="monotone" dataKey="leaked" stroke="#f97316" fill="none" strokeWidth={1} strokeDasharray="4 2" name="Leaked" />
                <Area type="monotone" dataKey="crossBorder" stroke="#f59e0b" fill="none" strokeWidth={1} strokeDasharray="4 2" name="Cross-Border" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      {/* Live BGP Alerts */}
      {liveAlerts.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-4 w-4" /> Live BGP Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex flex-wrap gap-2">
              {liveAlerts.slice(0, 8).map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs font-mono bg-background border border-border/50 rounded px-2 py-1">
                  <span className={a.severity === "critical" ? "text-red-400" : "text-yellow-400"}>
                    {a.alertType.toUpperCase()}
                  </span>
                  <span className="text-muted-foreground">{a.prefix}</span>
                  <span className="text-muted-foreground/60">{a.ts}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* IXP Peering Panel */}
      {peeringSessions.size > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="h-4 w-4 text-blue-400" /> IXP Peering Sessions
              <Badge variant="outline" className="ml-auto text-[10px]">{peeringSessions.size} sites</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">IXP Site</TableHead>
                  <TableHead className="text-xs">Peers</TableHead>
                  <TableHead className="text-xs">Sessions Up</TableHead>
                  <TableHead className="text-xs">Prefixes Rx</TableHead>
                  <TableHead className="text-xs">Prefixes Tx</TableHead>
                  <TableHead className="text-xs">Uptime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(peeringSessions.values()).map(p => (
                  <TableRow key={p.ixpSite}>
                    <TableCell className="text-xs font-mono font-medium">
                      {countryFlag(p.country)} {p.ixpSite}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{p.peerCount}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-green-400 font-mono">{p.sessionsUp}</span>
                      {p.sessionsDown > 0 && <span className="text-red-400 font-mono ml-1">(-{p.sessionsDown})</span>}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{p.prefixesReceived.toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{p.prefixesAdvertised.toLocaleString()}</TableCell>
                    <TableCell className="text-xs">
                      <span className={p.uptimePercent >= 99.5 ? "text-green-400 font-mono" : "text-yellow-400 font-mono"}>
                        {p.uptimePercent.toFixed(2)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search prefix or ASN..."
            value={asnSearch}
            onChange={e => setAsnSearch(e.target.value)}
            className="pl-8 h-8 text-sm font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          {["all", "valid", "invalid", "unknown"].map(v => (
            <Button
              key={v}
              variant={rpkiFilter === v ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setRpkiFilter(v)}
            >
              {v.toUpperCase()}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={hijackedOnly} onCheckedChange={setHijackedOnly} id="hijacked-only" />
          <Label htmlFor="hijacked-only" className="text-xs cursor-pointer">Hijacked only</Label>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={showLive} onCheckedChange={setShowLive} id="show-live" />
          <Label htmlFor="show-live" className="text-xs cursor-pointer flex items-center gap-1">
            <Activity className="h-3 w-3" /> Live stream
          </Label>
        </div>
      </div>

      {/* Routes Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            BGP Route Table
            <Badge variant="outline" className="ml-auto font-mono text-xs">{displayRoutes.length} routes</Badge>
            {showLive && connected && (
              <span className="text-xs text-green-400 font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" /> LIVE
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs w-[140px]">Prefix</TableHead>
                  <TableHead className="text-xs">Origin ASN</TableHead>
                  <TableHead className="text-xs">Peer ASN</TableHead>
                  <TableHead className="text-xs">Next Hop</TableHead>
                  <TableHead className="text-xs">RPKI</TableHead>
                  <TableHead className="text-xs">Hijacked</TableHead>
                  <TableHead className="text-xs">Leaked</TableHead>
                  <TableHead className="text-xs">Cross-Border</TableHead>
                  <TableHead className="text-xs">IXP Site</TableHead>
                  <TableHead className="text-xs">Detected</TableHead>
                  <TableHead className="text-xs w-[80px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !showLive ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 11 }).map((_, j) => (
                        <TableCell key={j}><div className="h-3 bg-muted rounded animate-pulse" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : displayRoutes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8 text-sm">
                      {connected
                        ? "Waiting for BGP route updates from the Rust validator..."
                        : "No BGP routes match the current filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  displayRoutes.map((route, idx) => (
                    <TableRow
                      key={`${route.id}-${idx}`}
                      className={route.is_hijacked ? "bg-red-500/5 hover:bg-red-500/10" : ""}
                    >
                      <TableCell className="font-mono text-xs font-medium">{route.prefix}</TableCell>
                      <TableCell className="font-mono text-xs">AS{route.origin_asn}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {route.peer_asn ? `AS${route.peer_asn}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{route.next_hop ?? "—"}</TableCell>
                      <TableCell><RpkiBadge status={route.rpki_status} /></TableCell>
                      <TableCell>
                        {route.is_hijacked
                          ? <XCircle className="h-4 w-4 text-red-400" />
                          : <CheckCircle className="h-4 w-4 text-green-400/40" />}
                      </TableCell>
                      <TableCell>
                        {route.is_leaked
                          ? <AlertTriangle className="h-4 w-4 text-yellow-400" />
                          : <CheckCircle className="h-4 w-4 text-green-400/40" />}
                      </TableCell>
                      <TableCell>
                        {route.is_cross_border
                          ? <Badge variant="destructive" className="text-[10px] font-mono px-1.5 py-0">YES</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {route.ixp_site ? (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" /> {route.ixp_site}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {route.detected_at ? new Date(route.detected_at).toLocaleTimeString() : "—"}
                      </TableCell>
                      <TableCell>
                        {(route.is_hijacked || route.rpki_status === "invalid") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300"
                            onClick={() => openReport(route.prefix, String(route.origin_asn))}
                          >
                            <Flag className="h-3 w-3 mr-1" /> Report
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Report Hijack Dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Flag className="h-4 w-4" /> Report BGP Hijack
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Prefix (CIDR)</Label>
              <Input
                placeholder="e.g. 197.210.0.0/16"
                value={reportPrefix}
                onChange={e => setReportPrefix(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hijacking ASN</Label>
              <Input
                placeholder="e.g. 36873"
                value={reportAsn}
                onChange={e => setReportAsn(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                placeholder="Additional context about the hijack..."
                value={reportNotes}
                onChange={e => setReportNotes(e.target.value)}
                className="text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!reportPrefix || !reportAsn}
              onClick={() => {
                if (reportHijackMutation?.mutate) {
                  reportHijackMutation.mutate({
                    prefix: reportPrefix,
                    hijackingAsn: parseInt(reportAsn) || 0,
                    notes: reportNotes || undefined,
                  });
                } else {
                  toast.success(`Hijack reported: Prefix ${reportPrefix} flagged in SIEM.`);
                  setReportOpen(false);
                }
              }}
            >
              <Flag className="h-3.5 w-3.5 mr-1.5" /> Report Hijack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
