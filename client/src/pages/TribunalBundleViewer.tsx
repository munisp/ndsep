import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CheckCircle2, Download, FileBox, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  assembling: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  sealed: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  exported: "bg-green-500/20 text-green-300 border-green-500/40",
};

export default function TribunalBundleViewer() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [caseRefFilter, setCaseRefFilter] = useState("");
  const bundles = trpc.tribunalBundle.listBundles.useQuery({
    status: (statusFilter || undefined) as "assembling" | "sealed" | "exported" | undefined,
    caseRef: caseRefFilter || undefined,
    limit: 50,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const detail = trpc.tribunalBundle.getBundle.useQuery({ bundleId: selected ?? 0 }, { enabled: selected != null });
  const accessLog = trpc.tribunalBundle.accessLog.useQuery({ bundleId: selected ?? 0 }, { enabled: selected != null });

  const [assembleCase, setAssembleCase] = useState("");
  const assemble = trpc.tribunalBundle.assembleBundle.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Bundle ${res.bundleId ?? ""} assembled for ${assembleCase}`);
      setAssembleCase("");
      bundles.refetch();
      if (res.bundleId) setSelected(Number(res.bundleId));
    },
    onError: (err) => toast.error(err.message),
  });

  const [exportTo, setExportTo] = useState("");
  const requestExport = trpc.tribunalBundle.requestExport.useMutation({
    onSuccess: (res: any) => { toast.success(`Export requested — dual-control approval required within ${res.expiresInHours}h`); detail.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const approveExport = trpc.tribunalBundle.approveExport.useMutation({
    onSuccess: () => { toast.success("Export approved"); detail.refetch(); bundles.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [merkleInput, setMerkleInput] = useState("");
  const [verifyRequested, setVerifyRequested] = useState(false);
  const verification = trpc.tribunalBundle.verifyBundle.useQuery(
    { bundleId: selected ?? 0, expectedMerkleRoot: merkleInput || undefined },
    { enabled: selected != null && verifyRequested }
  );
  const download = trpc.tribunalBundle.downloadBundle.useQuery(
    { bundleId: selected ?? 0 },
    { enabled: false }
  );

  const b: any = detail.data?.bundle;
  const artifacts: any[] = detail.data?.artifacts ?? [];
  const v: any = verification.data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Tribunal Bundles" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileBox className="h-6 w-6" /> Tribunal Evidence Bundles</h1>
        <Button variant="ghost" size="sm" onClick={() => { bundles.refetch(); if (selected) { detail.refetch(); accessLog.refetch(); } }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Assemble */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Assemble a new bundle</CardTitle>
          <CardDescription>Collects evidence-vault artifacts, due-process log entries and ledger anchors for an enforcement case into a Merkle-sealed bundle.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 items-end">
          <div className="flex-1 max-w-md">
            <Label htmlFor="tb-case">Case reference / fine reference</Label>
            <Input id="tb-case" value={assembleCase} onChange={(e) => setAssembleCase(e.target.value)} placeholder="e.g. ENF-2026-0001" />
          </div>
          <Button disabled={assemble.isPending || assembleCase.trim().length < 1} onClick={() => assemble.mutate({ caseId: assembleCase.trim() })}>
            {assemble.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Assemble bundle
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Bundle list */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Bundles</CardTitle>
            <div className="flex gap-2 pt-2">
              <Input value={caseRefFilter} onChange={(e) => setCaseRefFilter(e.target.value)} placeholder="Filter by case ref" className="max-w-[180px]" />
              <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {["assembling", "sealed", "exported"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(bundles.data?.rows ?? []).map((row: any) => (
              <button
                key={row.id}
                onClick={() => { setSelected(row.id); setVerifyRequested(false); }}
                className={`w-full text-left border rounded px-3 py-2 text-sm ${selected === row.id ? "border-primary" : "border-border"}`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">#{row.id} · {row.case_ref}</span>
                  <Badge variant="outline" className={STATUS_COLORS[row.status] ?? ""}>{row.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {row.artifact_count} artifact(s) · merkle {row.merkle_root ? `${String(row.merkle_root).slice(0, 16)}…` : "pending"}
                </p>
              </button>
            ))}
            {(bundles.data?.rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">No bundles found.</p>}
          </CardContent>
        </Card>

        {/* Detail */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Bundle detail</CardTitle>
            {b && (
              <CardDescription>
                #{b.id} · {b.case_ref} · merkle root <span className="font-mono">{b.merkle_root ?? "pending"}</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!b ? (
              <p className="text-sm text-muted-foreground">Select a bundle to inspect its artifacts and verification status.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">#</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>SHA-256</TableHead>
                      <TableHead className="text-right">Bytes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {artifacts.map((a: any) => (
                      <TableRow key={a.merkle_index}>
                        <TableCell className="text-right font-mono">{a.merkle_index}</TableCell>
                        <TableCell className="text-sm">{a.artifact_type}</TableCell>
                        <TableCell className="font-mono text-xs">{String(a.sha256 ?? a.ref).slice(0, 20)}…</TableCell>
                        <TableCell className="text-right text-sm">{a.size_bytes ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                    {artifacts.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No artifacts in this bundle.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>

                {/* Verification */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Independent verification</h3>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label htmlFor="tb-merkle">Expected merkle root (optional)</Label>
                      <Input id="tb-merkle" value={merkleInput} onChange={(e) => setMerkleInput(e.target.value)} placeholder="64-char hex" className="font-mono" />
                    </div>
                    <Button
                      variant="secondary"
                      disabled={verification.isFetching}
                      onClick={() => { setVerifyRequested(true); verification.refetch(); }}
                    >
                      {verification.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Verify bundle
                    </Button>
                  </div>
                  {verifyRequested && v && (
                    <div className="space-y-1 text-sm">
                      <p className={`font-medium flex items-center gap-2 ${v.ok ? "text-green-400" : "text-red-400"}`}>
                        {v.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        {v.ok ? "Bundle verified — all artifact hashes and the merkle root check out" : "Verification failed"}
                      </p>
                      {v.merkleRoot != null && (
                        <p className="text-xs font-mono text-muted-foreground">recomputed root: {v.recomputedRoot ?? v.merkleRoot}</p>
                      )}
                      {(v.checks ?? []).map((c: any, i: number) => (
                        <p key={i} className={`text-xs ${c.ok ? "text-muted-foreground" : "text-red-400"}`}>
                          {c.ok ? "✓" : "✗"} {c.name} — {c.detail}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Export (dual control) */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-medium flex items-center gap-2"><Download className="h-4 w-4" /> Export (dual control)</h3>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div>
                      <Label htmlFor="tb-export-to">Export destination</Label>
                      <Input id="tb-export-to" value={exportTo} onChange={(e) => setExportTo(e.target.value)} placeholder="e.g. Federal High Court, Lagos" className="w-64" />
                    </div>
                    <Button
                      variant="secondary"
                      disabled={requestExport.isPending || exportTo.trim().length < 2 || b.status !== "sealed"}
                      onClick={() => requestExport.mutate({ bundleId: b.id, exportedTo: exportTo.trim() })}
                    >Request export</Button>
                    <Button
                      variant="outline"
                      disabled={approveExport.isPending}
                      onClick={() => approveExport.mutate({ bundleId: b.id })}
                    >Approve export (admin)</Button>
                    <Button
                      variant="outline"
                      disabled={download.isFetching}
                      onClick={async () => {
                        try {
                          const res = await download.refetch();
                          const payload: any = res.data;
                          if (!payload) throw new Error("no data");
                          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `tribunal-bundle-${b.id}.json`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                          toast.success("Bundle JSON downloaded");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Download failed");
                        }
                      }}
                    >
                      {download.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Download JSON
                    </Button>
                  </div>
                </div>

                {/* Access log */}
                <div>
                  <h3 className="font-medium mb-2">Access log</h3>
                  <ul className="space-y-1 max-h-48 overflow-y-auto text-xs text-muted-foreground">
                    {(accessLog.data?.rows ?? []).map((l: any) => (
                      <li key={l.id}>
                        {new Date(l.accessed_at).toLocaleString()} — {l.accessor}: {l.action}{l.verdict ? ` (${l.verdict})` : ""}
                      </li>
                    ))}
                    {(accessLog.data?.rows ?? []).length === 0 && <li>No access events recorded.</li>}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
