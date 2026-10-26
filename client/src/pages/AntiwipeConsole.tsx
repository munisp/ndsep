/**
 * Anti-Wipe Integrity Operations Console (round 16, wave 3)
 * ==========================================================
 * Operator console for the `antiwipe` tRPC router (server/antiwipe/router.ts,
 * mounted as `antiwipe` in server/routers.ts). Wires all 15 procedures:
 *
 *   Ledger:   append (admin), publicIntegrityStatus (public), verify,
 *             anchor (admin), status
 *   Vault:    vaultPut, vaultList, vaultVerify, vaultVerifyRecent,
 *             vaultSeal (admin)
 *   Backups:  backupRegister (admin), backupVerify (admin), backupList
 *   Canaries: canaryWrite (admin), canaryCheck
 *
 * Domain (see server/antiwipe/ledger.ts + externalAnchor.ts):
 *  - audit_ledger is a sha256 hash-chained, append-only table
 *    (entry_hash = sha256(prev_hash || canonical(payload) || created_at));
 *    UPDATE/DELETE/TRUNCATE are blocked by DB triggers
 *    (drizzle/migrations/0061_antiwipe_audit_ledger.sql).
 *  - anchorLedger() folds a day's entry hashes into a merkle root stored in
 *    ledger_anchors and best-effort mirrors it to an external sink
 *    (Rust audit_chain worker / S3 Object-Lock WORM store in COMPLIANCE mode,
 *    default 7-year retention) so a fully wiped local Postgres stays
 *    detectable.
 *  - Canaries are ransomware tripwires dropped into the vault/backup/
 *    quarantine directories; modification or deletion is a critical alert.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Anchor as AnchorIcon,
  Bell,
  CheckCircle2,
  Database,
  FileLock2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const aw = trpc.antiwipe;

function shortHash(h: string | null | undefined): string {
  if (!h) return "—";
  return `${h.slice(0, 12)}…${h.slice(-8)}`;
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

function StatusBadge({ ok, okText = "ok", badText = "FAILED" }: { ok: boolean; okText?: string; badText?: string }) {
  return ok ? (
    <Badge className="bg-green-500/20 text-green-300 border-green-500/40">
      <CheckCircle2 className="h-3 w-3 mr-1" />{okText}
    </Badge>
  ) : (
    <Badge className="bg-red-500/20 text-red-300 border-red-500/40">
      <XCircle className="h-3 w-3 mr-1" />{badText}
    </Badge>
  );
}

export default function AntiwipeConsole() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  // ── Queries ───────────────────────────────────────────────────────────
  const status = aw.status.useQuery(undefined, { refetchInterval: 30_000 });
  const publicIntegrity = aw.publicIntegrityStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const canaries = aw.canaryCheck.useQuery(undefined, { refetchInterval: 60_000 });
  const vault = aw.vaultList.useQuery({ limit: 50 });
  const backups = aw.backupList.useQuery({ limit: 50 });

  // verifyChain: run-on-demand (full walk from genesis by default)
  const [verifyWindow, setVerifyWindow] = useState<{ fromSeq: string; limit: string }>({ fromSeq: "", limit: "" });
  const verifyInput = useMemo(() => {
    const fromSeq = verifyWindow.fromSeq ? Number(verifyWindow.fromSeq) : undefined;
    const limit = verifyWindow.limit ? Number(verifyWindow.limit) : undefined;
    return { ...(fromSeq ? { fromSeq } : {}), ...(limit ? { limit } : {}) };
  }, [verifyWindow]);
  const verify = aw.verify.useQuery(verifyInput, { enabled: false });

  // vaultVerify: run-on-demand single-hash verification
  const [verifyHash, setVerifyHash] = useState("");
  const vaultVerify = aw.vaultVerify.useQuery(
    { hash: verifyHash.trim().toLowerCase() },
    { enabled: false },
  );

  // vaultVerifyRecent: run-on-demand sweep
  const [recentLimit, setRecentLimit] = useState("25");
  const vaultVerifyRecent = aw.vaultVerifyRecent.useQuery(
    { limit: Math.max(1, Math.min(1000, Number(recentLimit) || 25)) },
    { enabled: false },
  );

  // ── Mutations ─────────────────────────────────────────────────────────
  const refreshAll = () => {
    status.refetch();
    publicIntegrity.refetch();
    canaries.refetch();
    vault.refetch();
    backups.refetch();
    utils.antiwipe.invalidate();
  };

  const anchor = aw.anchor.useMutation({
    onSuccess: (r) => {
      toast.success(
        r?.alreadyAnchored
          ? `Anchor for ${r.anchorDate} already exists (idempotent) — root ${shortHash(r.rootHash)}.`
          : `Daily anchor created for ${r?.anchorDate} — root ${shortHash(r?.rootHash)}, ${r?.entryCount} entries.`,
      );
      refreshAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const append = aw.append.useMutation({
    onSuccess: (r) => {
      toast.success(`Ledger entry #${r?.seq} appended (${shortHash(r?.entryHash)}).`);
      setAppendForm({ action: "", payload: "" });
      refreshAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const vaultPut = aw.vaultPut.useMutation({
    onSuccess: (r) => {
      toast.success(
        r?.deduplicated
          ? `Evidence already stored (deduplicated) — hash ${shortHash(r?.entry?.hash)}.`
          : `Evidence stored — hash ${shortHash(r?.entry?.hash)}.`,
      );
      setPutForm({ caseRef: "", contentType: "", file: null });
      vault.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const vaultSeal = aw.vaultSeal.useMutation({
    onSuccess: (r) => {
      if (r) toast.success(`Evidence ${shortHash(r.hash)} sealed (irreversible).`);
      else toast.info("Entry not found or already sealed.");
      vault.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const backupRegister = aw.backupRegister.useMutation({
    onSuccess: (r) => {
      toast.success(`Backup ${r?.backupId} registered.`);
      setBackupForm({ backupId: "", type: "", path: "", sha256: "", sizeBytes: "", notes: "" });
      backups.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const backupVerify = aw.backupVerify.useMutation({
    onSuccess: (r) => {
      if (r?.ok) toast.success(`Backup ${r.backupId} verified — sha256 ${shortHash(r.recomputedHash)}.`);
      else toast.error(`Backup ${r?.backupId} verification failed: ${r?.reason ?? "unknown"}.`);
      backups.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const canaryWrite = aw.canaryWrite.useMutation({
    onSuccess: (r) => {
      toast.success(`${r?.length ?? 0} canary file(s) (re)written — tripwires re-armed.`);
      canaries.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Local form state ──────────────────────────────────────────────────
  const [appendForm, setAppendForm] = useState({ action: "", payload: "" });
  const [putForm, setPutForm] = useState<{ caseRef: string; contentType: string; file: File | null }>({
    caseRef: "",
    contentType: "",
    file: null,
  });
  const [backupForm, setBackupForm] = useState({
    backupId: "",
    type: "",
    path: "",
    sha256: "",
    sizeBytes: "",
    notes: "",
  });
  const [anchorDate, setAnchorDate] = useState("");

  const ledger = status.data?.ledger;
  const vaultEntries = useMemo(() => vault.data?.entries ?? [], [vault.data]);
  const backupRows = useMemo(() => backups.data ?? [], [backups.data]);
  const canaryFailures = useMemo(() => canaries.data?.failed ?? [], [canaries.data]);
  const verifyResult = verify.data;
  const lastAnchorMirror = anchor.data?.externalAnchor as
    | { mirrored?: boolean; error?: string; status?: number; base?: string }
    | null
    | undefined;

  const submitAppend = () => {
    let payload: unknown = appendForm.payload;
    try {
      payload = JSON.parse(appendForm.payload);
    } catch {
      // keep as plain string — the ledger stores any JSON-serialisable payload
    }
    append.mutate({ action: appendForm.action.trim(), payload });
  };

  const submitVaultPut = () => {
    const file = putForm.file;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      vaultPut.mutate({
        contentBase64: base64,
        ...(putForm.contentType.trim() ? { contentType: putForm.contentType.trim() } : file.type ? { contentType: file.type } : {}),
        ...(putForm.caseRef.trim() ? { caseRef: putForm.caseRef.trim() } : {}),
      });
    };
    reader.onerror = () => toast.error("Failed to read file.");
    reader.readAsDataURL(file);
  };

  const submitBackupRegister = () => {
    backupRegister.mutate({
      backupId: backupForm.backupId.trim(),
      path: backupForm.path.trim(),
      ...(backupForm.type.trim() ? { type: backupForm.type.trim() } : {}),
      ...(backupForm.sha256.trim() ? { sha256: backupForm.sha256.trim().toLowerCase() } : {}),
      ...(backupForm.sizeBytes.trim() ? { sizeBytes: Number(backupForm.sizeBytes) } : {}),
      ...(backupForm.notes.trim() ? { notes: backupForm.notes.trim() } : {}),
    });
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Breadcrumbs items={[{ label: "Anti-Wipe Integrity Console" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" /> Anti-Wipe Integrity Console
          </h1>
          <p className="text-muted-foreground text-sm">
            Evidence-vault integrity operations — hash-chained audit ledger, daily merkle anchors with external
            WORM corroboration, append-only evidence vault, backup manifest verification, ransomware canaries.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {!isAdmin && (
        <Card className="border-yellow-500/40">
          <CardContent className="py-3 text-sm text-yellow-300">
            Read-only view — ledger appends, anchoring, evidence sealing, backup registration/verification and
            canary writes require an admin role.
          </CardContent>
        </Card>
      )}

      {/* ── Tamper alerts ─────────────────────────────────────────────── */}
      {canaryFailures.length > 0 && (
        <Card className="border-red-500/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-red-300">
              <ShieldAlert className="h-5 w-5" /> Tamper alerts — canary tripwires triggered
            </CardTitle>
            <CardDescription>
              A modified or missing canary is an early ransomware/wipe signal. Acknowledging re-writes the canary
              for that directory (new nonce + hash) and re-arms the tripwire; the alert itself stays in the
              audit trail (audit_logs + ledger append, performed server-side).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expected hash</TableHead>
                  <TableHead>Actual hash</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {canaryFailures.map((f) => (
                  <TableRow key={f.path}>
                    <TableCell className="font-mono text-xs max-w-md truncate">{f.path}</TableCell>
                    <TableCell>
                      <Badge className="bg-red-500/20 text-red-300 border-red-500/40">{f.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{shortHash(f.expected)}</TableCell>
                    <TableCell className="font-mono text-xs">{f.actual ? shortHash(f.actual) : "—"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isAdmin || canaryWrite.isPending}
                        onClick={() => {
                          const dir = f.path.slice(0, f.path.lastIndexOf("/"));
                          canaryWrite.mutate(dir ? { dirs: [dir] } : undefined);
                        }}
                      >
                        Acknowledge &amp; re-arm
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Ledger health + guards ────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" /> Ledger health
            </CardTitle>
            <CardDescription>Hash-chained audit ledger (audit_ledger).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Chain height</span><span className="font-mono">{ledger?.entryCount ?? publicIntegrity.data?.entryCount ?? "—"}</span></div>
            <div className="flex justify-between"><span>Head seq</span><span className="font-mono">{ledger?.headSeq ?? publicIntegrity.data?.headSeq ?? "—"}</span></div>
            <div className="flex justify-between"><span>Head hash</span><span className="font-mono text-xs">{shortHash(ledger?.headHash ?? publicIntegrity.data?.headHash)}</span></div>
            <div className="flex justify-between"><span>Genesis hash</span><span className="font-mono text-xs">{shortHash(ledger?.genesisHash ?? publicIntegrity.data?.genesisHash)}</span></div>
            <div className="flex justify-between items-center">
              <span>Tail window (last ≤100)</span>
              {ledger?.tailCheck
                ? <StatusBadge ok={ledger.tailCheck.valid} okText={`valid (${ledger.tailCheck.entriesChecked})`} />
                : publicIntegrity.data
                  ? <StatusBadge ok={publicIntegrity.data.tailValid} okText="valid" />
                  : <span className="text-muted-foreground">—</span>}
            </div>
            <div className="flex justify-between"><span>Vault dir</span><span className="font-mono text-xs max-w-[55%] truncate">{status.data?.vault?.dir ?? "—"}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <AnchorIcon className="h-5 w-5" /> Merkle anchors
            </CardTitle>
            <CardDescription>
              Daily merkle roots in ledger_anchors, mirrored best-effort to the external audit-chain worker and
              the S3 Object-Lock WORM sink (COMPLIANCE mode, ~7-year retention) by the scheduler.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Stored anchors</span><span className="font-mono">{ledger?.anchorCount ?? "—"}</span></div>
            <div className="flex justify-between"><span>Latest anchor date</span><span className="font-mono">{ledger?.latestAnchorDate ?? publicIntegrity.data?.latestAnchorDate ?? "—"}</span></div>
            {anchor.data && (
              <div className="rounded border border-border p-2 space-y-1">
                <div className="flex justify-between"><span>Anchored date</span><span className="font-mono">{anchor.data.anchorDate}</span></div>
                <div className="flex justify-between"><span>Root hash</span><span className="font-mono text-xs">{shortHash(anchor.data.rootHash)}</span></div>
                <div className="flex justify-between"><span>Entries</span><span className="font-mono">{anchor.data.entryCount}</span></div>
                <div className="flex justify-between"><span>Seq range</span><span className="font-mono">{anchor.data.firstSeq ?? "—"} → {anchor.data.lastSeq ?? "—"}</span></div>
                <div className="flex justify-between items-center">
                  <span>External mirror</span>
                  {anchor.data.alreadyAnchored ? (
                    <Badge className="bg-muted text-muted-foreground border-border">already anchored</Badge>
                  ) : lastAnchorMirror?.mirrored ? (
                    <StatusBadge ok okText="mirrored" />
                  ) : (
                    <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/40">
                      {lastAnchorMirror?.error ? "mirror failed" : "no mirror response"}
                    </Badge>
                  )}
                </div>
                {lastAnchorMirror?.error && (
                  <div className="text-xs text-orange-300">Mirror error: {lastAnchorMirror.error}</div>
                )}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Input
                placeholder="YYYY-MM-DD (default: today, UTC)"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                disabled={!isAdmin || anchor.isPending || (!!anchorDate && !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate))}
                onClick={() => anchor.mutate(anchorDate ? { date: anchorDate } : undefined)}
              >
                <AnchorIcon className="h-4 w-4 mr-1" /> Anchor now
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-5 w-5" /> Canaries &amp; guards
            </CardTitle>
            <CardDescription>Ransomware tripwires and destructive-SQL guards.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span>Canary status</span>
              {canaries.data ? (
                <StatusBadge ok={canaries.data.failed.length === 0} okText={`${canaries.data.ok}/${canaries.data.total} ok`} badText={`${canaries.data.failed.length} tripped`} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Watched directories</div>
              {(status.data?.canaries?.watchedDirs ?? []).map((d) => (
                <div key={d} className="font-mono text-xs truncate">{d}</div>
              ))}
              {(status.data?.canaries?.watchedDirs ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground">—</div>
              )}
            </div>
            <div className="rounded border border-border p-2 text-xs space-y-1">
              <div className="flex justify-between items-center">
                <span>UPDATE / DELETE / TRUNCATE / DROP guards</span>
                <Badge className="bg-green-500/20 text-green-300 border-green-500/40">enforced</Badge>
              </div>
              <div className="text-muted-foreground">
                Append-only invariants are enforced by database triggers
                (drizzle/migrations/0061_antiwipe_audit_ledger.sql); destructive statements against audit_ledger,
                ledger_anchors and evidence_vault_entries raise at the DB layer, not the app layer.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!isAdmin || canaryWrite.isPending}
              onClick={() => canaryWrite.mutate(undefined)}
            >
              Re-write all canaries
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Chain verification ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Chain verification
          </CardTitle>
          <CardDescription>
            Walk the chain and recompute every link; reports the first broken link. Full walk from genesis by
            default — set a window for incremental tail verification.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              placeholder="fromSeq (optional)"
              value={verifyWindow.fromSeq}
              onChange={(e) => setVerifyWindow({ ...verifyWindow, fromSeq: e.target.value.replace(/[^0-9]/g, "") })}
              className="w-40 font-mono text-xs"
            />
            <Input
              placeholder="limit (optional)"
              value={verifyWindow.limit}
              onChange={(e) => setVerifyWindow({ ...verifyWindow, limit: e.target.value.replace(/[^0-9]/g, "") })}
              className="w-40 font-mono text-xs"
            />
            <Button size="sm" disabled={verify.isFetching} onClick={() => verify.refetch()}>
              {verify.isFetching ? "Verifying…" : "Verify chain"}
            </Button>
          </div>
          {verifyResult && (
            <div className={`rounded border p-3 text-sm space-y-1 ${verifyResult.valid ? "border-green-500/40" : "border-red-500/60"}`}>
              <div className="flex items-center gap-2">
                <StatusBadge ok={verifyResult.valid} okText="CHAIN VALID" badText="CHAIN BROKEN" />
                <span className="text-muted-foreground">{verifyResult.entriesChecked} entries checked</span>
              </div>
              {!verifyResult.valid && (
                <div className="text-red-300">
                  First broken link at seq {verifyResult.brokenAtSeq ?? "?"} — reason: {verifyResult.reason ?? "unknown"}.
                </div>
              )}
              <div className="font-mono text-xs text-muted-foreground">head: {verifyResult.headHash ?? "—"}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="vault">
        <TabsList>
          <TabsTrigger value="vault"><FileLock2 className="h-4 w-4 mr-1" /> Evidence vault</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="append">Manual ledger append</TabsTrigger>
        </TabsList>

        {/* ── Evidence vault ──────────────────────────────────────────── */}
        <TabsContent value="vault" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Vault integrity sweeps</CardTitle>
              <CardDescription>
                Recompute SHA-256 of stored bytes and compare against the content address + recorded size.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  placeholder="64-char hex hash"
                  value={verifyHash}
                  onChange={(e) => setVerifyHash(e.target.value)}
                  className="w-96 font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!/^[0-9a-f]{64}$/i.test(verifyHash.trim()) || vaultVerify.isFetching}
                  onClick={() => vaultVerify.refetch()}
                >
                  Verify hash
                </Button>
                <Input
                  value={recentLimit}
                  onChange={(e) => setRecentLimit(e.target.value.replace(/[^0-9]/g, ""))}
                  className="w-24 font-mono text-xs"
                />
                <Button size="sm" variant="outline" disabled={vaultVerifyRecent.isFetching} onClick={() => vaultVerifyRecent.refetch()}>
                  Verify recent N
                </Button>
              </div>
              {vaultVerify.data && (
                <div className={`rounded border p-2 text-sm ${vaultVerify.data.ok ? "border-green-500/40" : "border-red-500/60"}`}>
                  <StatusBadge ok={vaultVerify.data.ok} okText="intact" badText={vaultVerify.data.reason ?? "failed"} />
                  <span className="ml-2 font-mono text-xs">{shortHash(vaultVerify.data.hash)}</span>
                  {vaultVerify.data.sealed && <Badge className="ml-2 bg-blue-500/20 text-blue-300 border-blue-500/40">sealed</Badge>}
                </div>
              )}
              {vaultVerifyRecent.data && (
                <div className={`rounded border p-2 text-sm ${vaultVerifyRecent.data.failures.length === 0 ? "border-green-500/40" : "border-red-500/60"}`}>
                  {vaultVerifyRecent.data.failures.length === 0 ? (
                    <span>{vaultVerifyRecent.data.checked} most-recent entries verified — no failures.</span>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-red-300">
                        {vaultVerifyRecent.data.failures.length} of {vaultVerifyRecent.data.checked} recent entries FAILED.
                      </div>
                      {vaultVerifyRecent.data.failures.map((f) => (
                        <div key={f.hash} className="font-mono text-xs">
                          {shortHash(f.hash)} — {f.reason ?? "failed"}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Store evidence</CardTitle>
              <CardDescription>Content-addressed, append-only. Max 32 MiB per blob via tRPC.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  type="file"
                  onChange={(e) => setPutForm({ ...putForm, file: e.target.files?.[0] ?? null })}
                  className="w-72"
                />
                <Input
                  placeholder="case ref (optional)"
                  value={putForm.caseRef}
                  onChange={(e) => setPutForm({ ...putForm, caseRef: e.target.value })}
                  className="w-48"
                />
                <Input
                  placeholder="content type (optional)"
                  value={putForm.contentType}
                  onChange={(e) => setPutForm({ ...putForm, contentType: e.target.value })}
                  className="w-48"
                />
                <Button size="sm" disabled={!putForm.file || vaultPut.isPending} onClick={submitVaultPut}>
                  {vaultPut.isPending ? "Uploading…" : "Store evidence"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Evidence entries ({vault.data?.total ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hash</TableHead>
                    <TableHead>Case</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploader</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Sealed</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vaultEntries.map((e) => (
                    <TableRow key={e.hash}>
                      <TableCell className="font-mono text-xs">{shortHash(e.hash)}</TableCell>
                      <TableCell className="text-sm">{e.caseRef ?? "—"}</TableCell>
                      <TableCell className="text-sm">{fmtBytes(e.sizeBytes)}</TableCell>
                      <TableCell className="text-sm">{e.uploaderName ?? (e.uploaderId != null ? `user:${e.uploaderId}` : "—")}</TableCell>
                      <TableCell className="text-xs">{fmtDate(e.createdAt)}</TableCell>
                      <TableCell>
                        {e.sealed ? (
                          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40">sealed</Badge>
                        ) : (
                          <Badge className="bg-muted text-muted-foreground border-border">open</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isAdmin || e.sealed || vaultSeal.isPending}
                          onClick={() => vaultSeal.mutate({ hash: e.hash })}
                        >
                          Seal
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {vaultEntries.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground text-sm">No evidence stored.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Backups ─────────────────────────────────────────────────── */}
        <TabsContent value="backups" className="space-y-4">
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Register backup</CardTitle>
                <CardDescription>Record a backup artifact in the manifest for later hash verification.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Input placeholder="backup id *" value={backupForm.backupId} onChange={(e) => setBackupForm({ ...backupForm, backupId: e.target.value })} className="w-48" />
                  <Input placeholder="type (e.g. pg_dump)" value={backupForm.type} onChange={(e) => setBackupForm({ ...backupForm, type: e.target.value })} className="w-40" />
                  <Input placeholder="artifact path *" value={backupForm.path} onChange={(e) => setBackupForm({ ...backupForm, path: e.target.value })} className="w-72 font-mono text-xs" />
                  <Input placeholder="sha256 (optional)" value={backupForm.sha256} onChange={(e) => setBackupForm({ ...backupForm, sha256: e.target.value })} className="w-64 font-mono text-xs" />
                  <Input placeholder="size bytes" value={backupForm.sizeBytes} onChange={(e) => setBackupForm({ ...backupForm, sizeBytes: e.target.value.replace(/[^0-9]/g, "") })} className="w-32 font-mono text-xs" />
                  <Input placeholder="notes" value={backupForm.notes} onChange={(e) => setBackupForm({ ...backupForm, notes: e.target.value })} className="w-64" />
                </div>
                <Button
                  size="sm"
                  disabled={!backupForm.backupId.trim() || !backupForm.path.trim() || backupRegister.isPending}
                  onClick={submitBackupRegister}
                >
                  Register backup
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Backup manifest</CardTitle>
              <CardDescription>Verify re-hashes the artifact and compares with the manifest; success marks it verified.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Backup ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>SHA-256</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backupRows.map((b) => (
                    <TableRow key={b.backupId}>
                      <TableCell className="font-mono text-xs">{b.backupId}</TableCell>
                      <TableCell className="text-sm">{b.type}</TableCell>
                      <TableCell className="font-mono text-xs max-w-xs truncate">{b.path}</TableCell>
                      <TableCell className="text-sm">{fmtBytes(b.sizeBytes)}</TableCell>
                      <TableCell className="font-mono text-xs">{shortHash(b.sha256)}</TableCell>
                      <TableCell>
                        {b.verified ? (
                          <Badge className="bg-green-500/20 text-green-300 border-green-500/40">verified {b.verifiedAt ? `· ${fmtDate(b.verifiedAt)}` : ""}</Badge>
                        ) : (
                          <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">unverified</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isAdmin || backupVerify.isPending}
                          onClick={() => backupVerify.mutate({ backupId: b.backupId })}
                        >
                          Verify
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {backupRows.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground text-sm">No backups registered.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Manual ledger append (admin) ────────────────────────────── */}
        <TabsContent value="append">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Append ledger entry</CardTitle>
              <CardDescription>
                Admin-only. The actor is always taken from the authenticated session (user:{user?.id ?? "?"}) and
                can never be supplied by the caller. Payload may be JSON or plain text.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="action (e.g. operator.note) — 1..128 chars"
                value={appendForm.action}
                onChange={(e) => setAppendForm({ ...appendForm, action: e.target.value })}
                className="font-mono"
              />
              <Textarea
                placeholder='payload — JSON (e.g. {"note":"…"}) or plain text'
                value={appendForm.payload}
                onChange={(e) => setAppendForm({ ...appendForm, payload: e.target.value })}
                rows={4}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                disabled={!isAdmin || !appendForm.action.trim() || append.isPending}
                onClick={submitAppend}
              >
                Append to ledger
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
