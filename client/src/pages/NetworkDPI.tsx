import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Network, ArrowUpRight, ArrowDownLeft, Ban, Filter } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const PROTO_COLORS: Record<string, string> = {
  TCP: "#2563eb", UDP: "#8b5cf6", HTTP: "#10b981", HTTPS: "#06b6d4",
  DNS: "#f59e0b", SMTP: "#ec4899", FTP: "#ef4444", SSH: "#f97316",
};

export default function NetworkDPI() {
  const utils = trpc.useUtils();
  const [crossBorderOnly, setCrossBorderOnly] = useState(false);
  const [blockIpDialog, setBlockIpDialog] = useState<{ open: boolean; ip: string; orgId: number }>({ open: false, ip: "", orgId: 0 });
  const [blockReason, setBlockReason] = useState("");

  const { data: networkEvents } = trpc.network.events.useQuery({ limit: 50, crossBorderOnly });
  const { data: trafficRaw } = trpc.network.trafficByHour.useQuery();
  const { data: ixpRaw } = trpc.network.ixpSites.useQuery();
  const { data: orgsForSelect } = trpc.financial.orgsForSelect.useQuery();
  const orgMap = Object.fromEntries((orgsForSelect ?? []).map((o: any) => [o.id, o.name]));

  const blockIp = trpc.network.blockIp.useMutation({
    onSuccess: () => {
      utils.network.events.invalidate();
      setBlockIpDialog({ open: false, ip: "", orgId: 0 });
      setBlockReason("");
      toast.success("IP blocked and logged to audit trail");
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const trafficData = (trafficRaw ?? []).map((r: any) => ({
    time: r.time,
    inbound: Number(r.inbound ?? 0),
    outbound: Number(r.outbound ?? 0),
    blocked: Number(r.blocked ?? 0),
    crossBorder: Number(r.cross_border ?? 0),
  }));

  const ixpSites = (ixpRaw ?? []).map((r: any) => ({
    name: r.name,
    location: r.name,
    status: Number(r.blocked ?? 0) > 200 ? "degraded" : "active",
    throughput: `${((Number(r.bytes ?? 0)) / 1e9).toFixed(1)} GB`,
    blocked: Number(r.blocked ?? 0),
    events: Number(r.events ?? 0),
    crossBorder: Number(r.cross_border ?? 0),
  }));

  const blockedCount = (networkEvents ?? []).filter((e: any) => e.isBlocked).length;
  const crossBorderCount = (networkEvents ?? []).filter((e: any) => e.isCrossBorder).length;
  const allowedCount = (networkEvents ?? []).filter((e: any) => !e.isBlocked).length;

  const protoBreakdown = (networkEvents ?? []).reduce((acc: any, e: any) => {
    const p = e.protocol ?? "OTHER";
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});

  const protoChartData = Object.entries(protoBreakdown).map(([k, v]) => ({
    name: k, count: v as number, color: PROTO_COLORS[k] ?? "#6b7280"
  })).sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc" }, { label: "Network D P I" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LAYER 5</span>
            <span className="data-label">Suricata · nDPI · Zeek · APISIX · OpenAppSec</span>
          </div>
          <h1 className="text-2xl font-bold">Network DPI & Exfiltration Prevention</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Deep packet inspection · Traffic analysis · Signature & anomaly detection · IXP enforcement</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={crossBorderOnly ? "default" : "outline"} className="gap-1 text-xs mono h-7" onClick={() => setCrossBorderOnly(v => !v)}>
            <Filter className="h-3 w-3" />{crossBorderOnly ? "Cross-Border Only" : "All Events"}
          </Button>
          <span className="h-2 w-2 rounded-full bg-blue-500 inline-block animate-pulse" />
          <span className="data-label text-blue-600">DPI ACTIVE</span>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Events", value: networkEvents?.length ?? 0, icon: Network, color: "#2563eb" },
          { label: "Blocked", value: blockedCount, icon: Ban, color: "#ef4444" },
          { label: "Cross-Border", value: crossBorderCount, icon: ArrowUpRight, color: "#f59e0b" },
          { label: "Allowed", value: allowedCount, icon: ArrowDownLeft, color: "#10b981" },
        ].map((m) => (
          <Card key={m.label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="data-label">{m.label}</p>
                  <p className="metric-value text-2xl font-bold mt-1">{m.value.toLocaleString()}</p>
                </div>
                <m.icon className="h-6 w-6 opacity-60" style={{ color: m.color }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Traffic Chart + Protocol Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Network Traffic (24h) — IXP Aggregate</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trafficData}>
                <defs>
                  <linearGradient id="inbGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="blkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Area type="monotone" dataKey="inbound" stroke="#2563eb" fill="url(#inbGrad)" strokeWidth={1.5} name="Inbound (Mbps)" />
                <Area type="monotone" dataKey="outbound" stroke="#ec4899" fill="url(#outGrad)" strokeWidth={1.5} name="Outbound (Mbps)" />
                <Area type="monotone" dataKey="blocked" stroke="#ef4444" fill="url(#blkGrad)" strokeWidth={1.5} name="Blocked" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Protocol Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={protoChartData} layout="vertical" barSize={12}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} width={40} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {protoChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* IXP Sites */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">IXP Enforcement Sites</CardTitle>
            <span className="layer-badge">SURICATA · ZEEK · nDPI</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ixpSites.map((site) => (
              <div key={site.name} className={`p-3 rounded-lg border ${site.status === "active" ? "border-green-500/30 bg-green-500/5" : "border-yellow-500/30 bg-yellow-500/5"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="mono text-xs font-bold">{site.name}</span>
                  <span className={`h-2 w-2 rounded-full ${site.status === "active" ? "bg-green-500" : "bg-yellow-500"}`} />
                </div>
                <p className="data-label">{site.location}</p>
                <p className="mono text-sm font-semibold mt-1">{site.throughput}</p>
                <p className="data-label mt-1">{site.blocked.toLocaleString()} blocked today</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Network Events Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Network Events</CardTitle>
            <span className="data-label">{networkEvents?.length ?? 0} events{crossBorderOnly ? " (cross-border)" : ""}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Action", "Protocol", "Source IP", "Dest IP", "Port", "Organization", "Cross-Border", "Bytes", "Timestamp", ""].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(networkEvents ?? []).slice(0, 20).map((event: any) => (
                  <tr key={event.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px]" style={{
                        borderColor: event.action === "blocked" ? "#ef444460" : event.action === "allowed" ? "#10b98160" : "#f59e0b60",
                        color: event.action === "blocked" ? "#ef4444" : event.action === "allowed" ? "#10b981" : "#f59e0b"
                      }}>
                        {event.action?.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="mono text-[10px] font-semibold" style={{ color: PROTO_COLORS[event.protocol] ?? "#6b7280" }}>{event.protocol ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{event.sourceIp ?? "—"}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{event.destinationIp ?? "—"}</td>
                    <td className="px-4 py-2.5 mono">{event.destinationPort ?? "—"}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{orgMap[event.organizationId] ?? `Org #${event.organizationId}`}</td>
                    <td className="px-4 py-2.5">
                      {event.isCrossBorder ? (
                        <span className="text-red-500 mono text-[10px] font-bold">✗ CROSS</span>
                      ) : (
                        <span className="text-green-600 mono text-[10px]">✓ LOCAL</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{Number(event.bytesTransferred ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{event.timestamp ? new Date(event.timestamp).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2.5">
                      {!event.isBlocked && event.sourceIp && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] mono text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => { setBlockIpDialog({ open: true, ip: event.sourceIp, orgId: event.organizationId ?? 0 }); setBlockReason(""); }}>
                          <Ban className="h-2.5 w-2.5 mr-1" />Block
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Block IP Dialog */}
      <Dialog open={blockIpDialog.open} onOpenChange={(o) => setBlockIpDialog(d => ({ ...d, open: o }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm font-semibold mono">Block IP Address</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="data-label text-[10px]">IP ADDRESS</Label>
              <Input className="text-xs mono h-8" value={blockIpDialog.ip} onChange={(e) => setBlockIpDialog(d => ({ ...d, ip: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="data-label text-[10px]">ORGANIZATION</Label>
              <Select value={String(blockIpDialog.orgId)} onValueChange={(v) => setBlockIpDialog(d => ({ ...d, orgId: Number(v) }))}>
                <SelectTrigger className="text-xs mono h-8"><SelectValue placeholder="Select org" /></SelectTrigger>
                <SelectContent>{(orgsForSelect ?? []).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-xs mono">{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="data-label text-[10px]">REASON</Label>
              <Input className="text-xs mono h-8" placeholder="e.g. Exfiltration attempt detected" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="mono text-xs" onClick={() => setBlockIpDialog(d => ({ ...d, open: false }))}>Cancel</Button>
            <Button size="sm" variant="destructive" className="mono text-xs"
              disabled={!blockIpDialog.ip || !blockIpDialog.orgId || !blockReason || blockIp.isPending}
              onClick={() => blockIp.mutate({ orgId: blockIpDialog.orgId, ipAddress: blockIpDialog.ip, reason: blockReason })}>
              <Ban className="h-3 w-3 mr-1" />Block IP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
