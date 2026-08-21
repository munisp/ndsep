import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity, Shield, AlertTriangle, Cpu, Network, Radio, Eye,
  Play, Square, RotateCcw, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";

type PacketData = {
  id: number;
  timestamp: string;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string;
  length: number;
  application_protocol: string | null;
  payload_preview: string | null;
  dns_query: string | null;
  tls_sni: string | null;
};
type ThreatData = {
  id: string;
  timestamp: string;
  threat_type: string;
  severity: string;
  source_ip: string | null;
  destination_ip: string | null;
  description: string;
  confidence: number;
  mitre_tactic: string | null;
  mitre_technique: string | null;
};
type IoTDeviceData = {
  ip: string;
  mac: string | null;
  device_type: string;
  manufacturer: string | null;
  risk_score: number;
  risk_factors: string[];
  protocols_used: string[];
  open_ports: number[];
};
type CaptureStatsData = {
  packets_captured: number;
  packets_per_second: number;
  bytes_captured: number;
  bytes_per_second: number;
  threats_detected: number;
  anomalies_detected: number;
  unique_sources: number;
  unique_destinations: number;
  capture_duration_secs: number;
  protocols: { tcp: number; udp: number; icmp: number; arp: number; other: number; total: number };
};
type AnomalyStatsData = {
  total_analyzed: number;
  anomalies_found: number;
  model_trained: boolean;
  training_samples: number;
  z_score_threshold: number;
  isolation_threshold: number;
  profiles_tracked: number;
};

function severityColor(sev: string): string {
  switch (sev?.toLowerCase()) {
    case "critical": return "bg-red-600 text-white";
    case "high": return "bg-orange-500 text-white";
    case "medium": return "bg-yellow-500 text-black";
    case "low": return "bg-blue-400 text-white";
    default: return "bg-muted-foreground text-white";
  }
}

export default function NetworkIntelligencePage() {
  const [tab, setTab] = useState("overview");

  const { data: statusData } = trpc.wiredigg.status.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: statsRaw } = trpc.wiredigg.captureStats.useQuery(undefined, { refetchInterval: 5_000 });
  const { data: packetsRaw } = trpc.wiredigg.packets.useQuery({ limit: 50 }, { refetchInterval: 3_000 });
  const { data: threatsRaw } = trpc.wiredigg.threats.useQuery({ limit: 50 }, { refetchInterval: 5_000 });
  const { data: anomalyRaw } = trpc.wiredigg.anomalyStats.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: iotRaw } = trpc.wiredigg.iotDevices.useQuery(undefined, { refetchInterval: 15_000 });
  const { data: protocolRaw } = trpc.wiredigg.protocolStats.useQuery(undefined, { refetchInterval: 5_000 });
  const { data: topSrc } = trpc.wiredigg.topSources.useQuery({ limit: 10 }, { refetchInterval: 10_000 });
  const { data: interfacesRaw } = trpc.wiredigg.interfaces.useQuery();
  const { data: threatSummaryRaw } = trpc.wiredigg.threatSummary.useQuery(undefined, { refetchInterval: 10_000 });

  const startM = trpc.wiredigg.startCapture.useMutation();
  const stopM = trpc.wiredigg.stopCapture.useMutation();
  const resetM = trpc.wiredigg.resetCapture.useMutation();
  const analyzeM = trpc.wiredigg.analyzeBatch.useMutation();

  const stats = (statsRaw as CaptureStatsData | null) ?? null;
  const packets = ((packetsRaw as { packets?: PacketData[] } | null)?.packets ?? []) as PacketData[];
  const threats = ((threatsRaw as { threats?: ThreatData[] } | null)?.threats ?? []) as ThreatData[];
  const anomalyStats = (anomalyRaw as AnomalyStatsData | null) ?? null;
  const iotDevices = ((iotRaw as { devices?: IoTDeviceData[] } | null)?.devices ?? []) as IoTDeviceData[];
  const interfaces = ((interfacesRaw as { interfaces?: { name: string; ips: string[] }[] } | null)?.interfaces ?? []);
  const protocolStats = (protocolRaw as { protocols?: CaptureStatsData["protocols"] } | null)?.protocols;
  const threatSummary = (threatSummaryRaw as { summary?: Record<string, number>; total?: number } | null);
  const topSources = ((topSrc as { sources?: { ip: string; packets: number }[] } | null)?.sources ?? []);
  const status = statusData as { status?: string; version?: string; capabilities?: string[] } | null;

  const isOnline = !!status?.status;

  return (
    <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "NOC", href: "/noc" }, { label: "Network Intelligence" }]} />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/network"><Button variant="ghost" size="icon" aria-label="Go back"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <Radio className="h-7 w-7 text-emerald-500" />
        <div>
          <h1 className="text-2xl font-bold">Network Intelligence Engine</h1>
          <p className="text-muted-foreground text-sm">Real-time packet capture, ML anomaly detection, threat classification & IoT fingerprinting</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Badge variant={isOnline ? "default" : "destructive"}>
            {isOnline ? "Online" : "Offline"}
          </Badge>
          {status?.version && <Badge variant="outline">v{status.version}</Badge>}
        </div>
      </div>

      {/* Capture controls */}
      <div className="flex gap-2 items-center">
        {interfaces.length > 0 ? (
          <Button size="sm" variant="default" onClick={() => startM.mutate({ interface: interfaces[0].name })} disabled={startM.isPending}>
            <Play className="h-3 w-3 mr-1" /> Start Capture ({interfaces[0]?.name})
          </Button>
        ) : (
          <Button size="sm" variant="default" disabled>
            <Play className="h-3 w-3 mr-1" /> No Interfaces
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => stopM.mutate()} disabled={stopM.isPending}>
          <Square className="h-3 w-3 mr-1" /> Stop
        </Button>
        <Button size="sm" variant="outline" onClick={() => resetM.mutate()} disabled={resetM.isPending}>
          <RotateCcw className="h-3 w-3 mr-1" /> Reset
        </Button>
        <Button size="sm" variant="outline" onClick={() => analyzeM.mutate()} disabled={analyzeM.isPending}>
          <Cpu className="h-3 w-3 mr-1" /> Run ML Analysis
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview"><Activity className="h-3 w-3 mr-1" /> Overview</TabsTrigger>
          <TabsTrigger value="packets"><Network className="h-3 w-3 mr-1" /> Packets</TabsTrigger>
          <TabsTrigger value="threats"><Shield className="h-3 w-3 mr-1" /> Threats</TabsTrigger>
          <TabsTrigger value="anomalies"><AlertTriangle className="h-3 w-3 mr-1" /> Anomalies</TabsTrigger>
          <TabsTrigger value="iot"><Cpu className="h-3 w-3 mr-1" /> IoT Devices</TabsTrigger>
          <TabsTrigger value="intel"><Eye className="h-3 w-3 mr-1" /> Threat Intel</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Packets Captured" value={stats?.packets_captured ?? 0} sub={`${(stats?.packets_per_second ?? 0).toFixed(1)} pkt/s`} />
            <StatCard title="Bytes Captured" value={formatBytes(stats?.bytes_captured ?? 0)} sub={`${formatBytes(stats?.bytes_per_second ?? 0)}/s`} />
            <StatCard title="Threats Detected" value={stats?.threats_detected ?? 0} sub="active threats" color="text-red-500" />
            <StatCard title="IoT Devices" value={iotDevices.length} sub="on network" />
          </div>

          {/* Protocol distribution */}
          {protocolStats && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Protocol Distribution</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-3">
                  <ProtoBar label="TCP" count={protocolStats.tcp} total={protocolStats.total} color="bg-blue-500" />
                  <ProtoBar label="UDP" count={protocolStats.udp} total={protocolStats.total} color="bg-green-500" />
                  <ProtoBar label="ICMP" count={protocolStats.icmp} total={protocolStats.total} color="bg-yellow-500" />
                  <ProtoBar label="ARP" count={protocolStats.arp} total={protocolStats.total} color="bg-purple-500" />
                  <ProtoBar label="Other" count={protocolStats.other} total={protocolStats.total} color="bg-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top sources */}
          {topSources.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Top Source IPs</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {topSources.slice(0, 10).map((s: { ip: string; packets: number }) => (
                    <div key={s.ip} className="flex justify-between text-sm border rounded px-2 py-1">
                      <span className="font-mono text-xs">{s.ip}</span>
                      <Badge variant="outline" className="ml-1 text-xs">{s.packets}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Threat summary */}
          {threatSummary?.summary && Object.keys(threatSummary.summary).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Threat Summary ({threatSummary.total ?? 0} total)</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(threatSummary.summary).map(([type, count]) => (
                    <Badge key={type} variant="secondary">{type.replace(/([A-Z])/g, " $1").trim()}: {count as number}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Packets Tab ── */}
        <TabsContent value="packets">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Live Packet Capture</CardTitle>
              <CardDescription>{packets.length} packets (most recent first)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead className="w-[60px]">Len</TableHead>
                      <TableHead>Info</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packets.map((p) => (
                      <TableRow key={p.id} className="text-xs font-mono">
                        <TableCell>{p.id}</TableCell>
                        <TableCell>{p.src_ip}{p.src_port ? `:${p.src_port}` : ""}</TableCell>
                        <TableCell>{p.dst_ip}{p.dst_port ? `:${p.dst_port}` : ""}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{p.application_protocol ?? p.protocol}</Badge>
                        </TableCell>
                        <TableCell>{p.length}</TableCell>
                        <TableCell className="max-w-[300px] truncate">{p.dns_query ?? p.tls_sni ?? p.payload_preview ?? ""}</TableCell>
                      </TableRow>
                    ))}
                    {packets.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No packets captured. Start a capture to see live data.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Threats Tab ── */}
        <TabsContent value="threats">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Detected Threats</CardTitle>
              <CardDescription>{threats.length} threats with MITRE ATT&CK mapping</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severity</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>MITRE</TableHead>
                      <TableHead>Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {threats.map((t) => (
                      <TableRow key={t.id} className="text-xs">
                        <TableCell><Badge className={severityColor(t.severity)}>{t.severity}</Badge></TableCell>
                        <TableCell className="font-mono">{t.threat_type}</TableCell>
                        <TableCell className="font-mono">{t.source_ip ?? "—"}</TableCell>
                        <TableCell className="max-w-[250px] truncate">{t.description}</TableCell>
                        <TableCell className="text-xs">
                          {t.mitre_technique && <Badge variant="outline" className="text-[10px]">{t.mitre_technique}</Badge>}
                        </TableCell>
                        <TableCell>{(t.confidence * 100).toFixed(0)}%</TableCell>
                      </TableRow>
                    ))}
                    {threats.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No threats detected. Run a capture and analysis to see threats.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Anomalies Tab ── */}
        <TabsContent value="anomalies" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total Analyzed" value={anomalyStats?.total_analyzed ?? 0} />
            <StatCard title="Anomalies Found" value={anomalyStats?.anomalies_found ?? 0} color="text-orange-500" />
            <StatCard title="Model Trained" value={anomalyStats?.model_trained ? "Yes" : "No"} sub={`${anomalyStats?.training_samples ?? 0} samples`} />
            <StatCard title="IP Profiles" value={anomalyStats?.profiles_tracked ?? 0} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">ML Configuration</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Z-Score Threshold:</span> {anomalyStats?.z_score_threshold ?? "—"}</div>
              <div><span className="text-muted-foreground">Isolation Threshold:</span> {anomalyStats?.isolation_threshold ?? "—"}</div>
              <div><span className="text-muted-foreground">Algorithm:</span> Isolation Forest + Z-Score (Rust native)</div>
              <div><span className="text-muted-foreground">Feature Dimensions:</span> 8</div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── IoT Tab ── */}
        <TabsContent value="iot">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Discovered IoT Devices</CardTitle>
              <CardDescription>{iotDevices.length} devices identified on the network</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Manufacturer</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Protocols</TableHead>
                      <TableHead>Risk Factors</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {iotDevices.map((d) => (
                      <TableRow key={d.ip} className="text-xs">
                        <TableCell className="font-mono">{d.ip}</TableCell>
                        <TableCell><Badge variant="outline">{d.device_type.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell>{d.manufacturer ?? "Unknown"}</TableCell>
                        <TableCell>
                          <Badge className={d.risk_score >= 50 ? "bg-red-500 text-white" : d.risk_score >= 25 ? "bg-yellow-500 text-black" : "bg-green-500 text-white"}>
                            {d.risk_score.toFixed(0)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{d.protocols_used.slice(0, 4).join(", ")}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{d.risk_factors.join("; ") || "None"}</TableCell>
                      </TableRow>
                    ))}
                    {iotDevices.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No IoT devices discovered. Start a capture to detect devices.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Threat Intel Tab ── */}
        <TabsContent value="intel" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Engine Capabilities</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <h4 className="font-semibold mb-1">Protocols (40+)</h4>
                  <p className="text-xs text-muted-foreground">TCP, UDP, ICMP, ARP, DNS, HTTP, TLS/HTTPS, SSH, SMTP, FTP, DHCP, NTP, SNMP, SSDP, mDNS, LLMNR, SMB, MQTT, CoAP, Modbus, OPC-UA, SIP, RTSP</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Threat Types (27)</h4>
                  <p className="text-xs text-muted-foreground">Port Scan, SYN Flood, DNS Exfiltration, ARP Spoofing, Brute Force, C2 Beacon, Ransomware, DDoS, MITM, Crypto Mining, Lateral Movement, TLS Downgrade, NDPA PII Violation</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">ML Models</h4>
                  <p className="text-xs text-muted-foreground">Isolation Forest (100 estimators, 256 samples), Z-Score statistical analysis, 8-dimensional feature extraction, incremental training</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">IoT Fingerprinting</h4>
                  <p className="text-xs text-muted-foreground">30+ OUI manufacturers, port-based classification, protocol-based detection (MQTT, CoAP, Modbus), risk scoring</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">NDPA Compliance</h4>
                  <p className="text-xs text-muted-foreground">Unencrypted PII detection (NIN, BVN, credentials), Article 24 enforcement, real-time DPO alerting</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">MITRE ATT&CK</h4>
                  <p className="text-xs text-muted-foreground">13 tactics mapped: Discovery, Impact, Exfiltration, Credential Access, C2, Lateral Movement, Privilege Escalation, Collection</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ title, value, sub, color }: { title: string; value: number | string; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className={`text-2xl font-bold ${color ?? ""}`}>{typeof value === "number" ? value.toLocaleString() : value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ProtoBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">{count.toLocaleString()}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
