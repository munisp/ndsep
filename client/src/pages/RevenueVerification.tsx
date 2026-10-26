/**
 * Revenue Verification Console (Round-12 W3)
 * ===========================================
 * UI for the previously orphaned `revenueVerification` router:
 *   - TIN verification + filed-revenue lookup (FIRS adapter, fail-closed)
 *   - RC-number corporate record lookup (CAC adapter, fail-closed)
 *   - Manual dual-attested filings: submit, second attestation, NDPC verify/dispute
 *   - Verified-revenue register with status-machine transitions
 *   - NDPA s.48 penalty preview + fine recomputation + computation ledger
 *   - Integration status / audit trail
 *
 * The FIRS/CAC adapters report status "unconfigured" when env credentials are
 * absent — the UI surfaces that state instead of implying a real verification.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SimilarPrecedentsPanel } from "@/components/SimilarPrecedentsPanel";
import { PenaltyCalibrationBadge } from "@/components/PenaltyCalibrationBadge";
import {
  Banknote, Building2, Calculator, CheckCircle2, FileCheck2, Landmark,
  Loader2, RefreshCw, Search, ShieldCheck, AlertTriangle,
} from "lucide-react";

const REVENUE_STATUSES = ["unverified", "pending", "verified", "disputed", "superseded"] as const;
const STATUS_COLORS: Record<string, string> = {
  unverified: "bg-muted text-muted-foreground border-border",
  pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  verified: "bg-green-500/20 text-green-300 border-green-500/40",
  disputed: "bg-red-500/20 text-red-300 border-red-500/40",
  superseded: "bg-muted text-muted-foreground border-border line-through",
};
const OUTCOME_COLORS: Record<string, string> = {
  success: "bg-green-500/20 text-green-300 border-green-500/40",
  unconfigured: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  unavailable: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  error: "bg-red-500/20 text-red-300 border-red-500/40",
};

const fmtNGN = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(n));

function OutcomeBadge({ status }: { status?: string }) {
  return <Badge variant="outline" className={OUTCOME_COLORS[status ?? ""] ?? ""}>{status ?? "—"}</Badge>;
}

// ─── Lookups tab ────────────────────────────────────────────────────────────

function LookupsTab() {
  const [tin, setTin] = useState("");
  const [tinResult, setTinResult] = useState<any>(null);
  const [revTin, setRevTin] = useState("");
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear() - 1));
  const [revOrgId, setRevOrgId] = useState("");
  const [persist, setPersist] = useState(false);
  const [revResult, setRevResult] = useState<any>(null);
  const [rcNumber, setRcNumber] = useState("");
  const [rcSubmitted, setRcSubmitted] = useState("");

  const verifyTin = trpc.revenueVerification.verifyTin.useMutation({
    onSuccess: (data) => setTinResult(data),
    onError: (e) => toast.error(e.message),
  });
  const lookupRevenue = trpc.revenueVerification.lookupFiledRevenue.useMutation({
    onSuccess: (data) => {
      setRevResult(data);
      if (data.record) toast.success("Filed revenue recorded as verified revenue");
    },
    onError: (e) => toast.error(e.message),
  });
  const corporate = trpc.revenueVerification.lookupCorporateRecord.useQuery(
    { rcNumber: rcSubmitted },
    { enabled: rcSubmitted.length >= 2, retry: false },
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Landmark className="h-5 w-5" /> FIRS — TIN verification</CardTitle>
          <CardDescription>Verify a Tax Identification Number against FIRS e-services (fails closed when unconfigured).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="e.g. 12345678-0001" className="font-mono" />
            <Button
              disabled={verifyTin.isPending || !/^\d[\d-]{7,19}$/.test(tin.trim())}
              onClick={() => verifyTin.mutate({ tin: tin.trim() })}>
              {verifyTin.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
            </Button>
          </div>
          {tinResult && (
            <div className="border rounded-lg p-3 space-y-1 text-sm">
              <div className="flex items-center gap-2"><OutcomeBadge status={tinResult.status} />{tinResult.active != null && <Badge variant="outline">{tinResult.active ? "active" : "inactive"}</Badge>}</div>
              {tinResult.registeredName && <p><span className="text-muted-foreground">Registered name:</span> {tinResult.registeredName}</p>}
              {tinResult.evidenceHash && <p className="font-mono text-xs text-muted-foreground">evidence: {String(tinResult.evidenceHash).slice(0, 16)}…</p>}
              {tinResult.message && <p className="text-xs text-muted-foreground">{tinResult.message}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Banknote className="h-5 w-5" /> FIRS — filed revenue lookup</CardTitle>
          <CardDescription>Look up filed gross revenue for a TIN + fiscal year; optionally persist as verified revenue (NDPA s.48 basis).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>TIN</Label>
              <Input value={revTin} onChange={(e) => setRevTin(e.target.value)} className="font-mono" placeholder="12345678-0001" />
            </div>
            <div>
              <Label>Fiscal year</Label>
              <Input type="number" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} />
            </div>
            <div>
              <Label>Organisation ID (for persistence)</Label>
              <Input type="number" value={revOrgId} onChange={(e) => setRevOrgId(e.target.value)} placeholder="org id" />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm cursor-pointer">
              <Checkbox checked={persist} onCheckedChange={(v) => setPersist(!!v)} /> Persist as verified revenue
            </label>
          </div>
          <Button
            disabled={lookupRevenue.isPending || revTin.trim().length < 8 || (persist && !revOrgId)}
            onClick={() => lookupRevenue.mutate({
              tin: revTin.trim(),
              fiscalYear: Number(fiscalYear),
              orgId: revOrgId ? Number(revOrgId) : undefined,
              persist,
            })}>
            {lookupRevenue.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Look up revenue
          </Button>
          {revResult && (
            <div className="border rounded-lg p-3 space-y-1 text-sm">
              <OutcomeBadge status={revResult.result?.status} />
              {revResult.result?.amount != null && <p><span className="text-muted-foreground">Filed revenue ({revResult.result.fiscalYear}):</span> <span className="font-semibold">{fmtNGN(revResult.result.amount)}</span> {revResult.result.currency}</p>}
              {revResult.record && <p className="text-green-400 text-xs">Persisted as verified revenue record #{revResult.record.id}</p>}
              {revResult.result?.message && <p className="text-xs text-muted-foreground">{revResult.result.message}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-5 w-5" /> CAC — corporate record lookup</CardTitle>
          <CardDescription>Resolve an RC/BN number to the CAC corporate record (fails closed when unconfigured).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 max-w-md">
            <Input value={rcNumber} onChange={(e) => setRcNumber(e.target.value)} placeholder="RC1234567" className="font-mono" />
            <Button variant="secondary" disabled={corporate.isFetching || !/^(RC|BN)?\s?\d+$/i.test(rcNumber.trim())}
              onClick={() => setRcSubmitted(rcNumber.trim())}>
              {corporate.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
            </Button>
          </div>
          {corporate.data && (
            <div className="border rounded-lg p-3 space-y-1 text-sm">
              <div className="flex items-center gap-2"><OutcomeBadge status={(corporate.data as any).status} />{(corporate.data as any).companyStatus && <Badge variant="outline">{(corporate.data as any).companyStatus}</Badge>}</div>
              {(corporate.data as any).companyName && <p><span className="text-muted-foreground">Company:</span> {(corporate.data as any).companyName} ({(corporate.data as any).companyType ?? "type n/a"})</p>}
              {(corporate.data as any).registrationDate && <p><span className="text-muted-foreground">Registered:</span> {(corporate.data as any).registrationDate}</p>}
              {(corporate.data as any).message && <p className="text-xs text-muted-foreground">{(corporate.data as any).message}</p>}
            </div>
          )}
          {corporate.isError && <p className="text-sm text-red-400">{corporate.error.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Revenue records & manual filings tab ───────────────────────────────────

function RecordsTab() {
  const [orgId, setOrgId] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const orgNum = Number(orgId);
  const enabled = Number.isInteger(orgNum) && orgNum > 0;

  const records = trpc.revenueVerification.listVerifiedRevenues.useQuery(
    { orgId: orgNum, status: (statusFilter || undefined) as (typeof REVENUE_STATUSES)[number] | undefined },
    { enabled },
  );
  const history = trpc.revenueVerification.getRevenueHistory.useQuery({ orgId: orgNum }, { enabled });

  const attest = trpc.revenueVerification.attestManualFiling.useMutation({
    onSuccess: () => { toast.success("Second attestation recorded"); records.refetch(); history.refetch(); setAttestFor(null); },
    onError: (e) => toast.error(e.message),
  });
  const verifyManual = trpc.revenueVerification.verifyManualFiling.useMutation({
    onSuccess: () => { toast.success("Filing decision recorded"); records.refetch(); history.refetch(); setVerifyFor(null); setVerifyReason(""); },
    onError: (e) => toast.error(e.message),
  });
  const transition = trpc.revenueVerification.transitionRevenueStatus.useMutation({
    onSuccess: () => { toast.success("Status updated"); records.refetch(); history.refetch(); setTransitionFor(null); },
    onError: (e) => toast.error(e.message),
  });
  const submitManual = trpc.revenueVerification.submitManualFiling.useMutation({
    onSuccess: () => { toast.success("Manual filing submitted (pending dual attestation)"); records.refetch(); history.refetch(); setShowFiling(false); },
    onError: (e) => toast.error(e.message),
  });

  const [attestFor, setAttestFor] = useState<any>(null);
  const [officerName, setOfficerName] = useState("");
  const [officerRole, setOfficerRole] = useState("");
  const [verifyFor, setVerifyFor] = useState<any>(null);
  const [verifyDecision, setVerifyDecision] = useState<"verified" | "disputed">("verified");
  const [verifyReason, setVerifyReason] = useState("");
  const [transitionFor, setTransitionFor] = useState<any>(null);
  const [transitionTo, setTransitionTo] = useState<(typeof REVENUE_STATUSES)[number]>("disputed");
  const [transitionReason, setTransitionReason] = useState("");
  const [supersededBy, setSupersededBy] = useState("");
  const [showFiling, setShowFiling] = useState(false);
  const [filing, setFiling] = useState({
    amount: "", fiscalYear: String(new Date().getFullYear() - 1), documentHash: "",
    cfoName: "", cfoTitle: "", cfoAttestedAt: "", auditorName: "", auditorFirm: "", auditorAttestedAt: "",
  });

  const best: any = history.data?.bestAvailable ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><FileCheck2 className="h-5 w-5" /> Verified revenue register</CardTitle>
          <CardDescription>Per-organisation verified revenue records with the s.48 status machine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label>Organisation ID</Label>
              <Input type="number" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-40" placeholder="org id" />
            </div>
            <div>
              <Label>Status filter</Label>
              <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {REVENUE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" disabled={!enabled} onClick={() => { records.refetch(); history.refetch(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="sm" disabled={!enabled} onClick={() => setShowFiling((v) => !v)}>
              Submit manual filing
            </Button>
          </div>

          {best && (
            <div className="border border-green-500/40 rounded-lg p-3 text-sm flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-green-400" />
              <span>Best available verified revenue: <strong>{fmtNGN(best.amount)}</strong> ({best.source}, FY{best.fiscalYear})</span>
            </div>
          )}

          {showFiling && (
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-medium text-sm">Manual dual-attested filing (CFO + external auditor)</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><Label>Amount (NGN)</Label><Input type="number" value={filing.amount} onChange={(e) => setFiling((f) => ({ ...f, amount: e.target.value }))} /></div>
                <div><Label>Fiscal year</Label><Input type="number" value={filing.fiscalYear} onChange={(e) => setFiling((f) => ({ ...f, fiscalYear: e.target.value }))} /></div>
                <div><Label>Document SHA-256 hash</Label><Input value={filing.documentHash} onChange={(e) => setFiling((f) => ({ ...f, documentHash: e.target.value }))} className="font-mono" placeholder="64 hex chars" /></div>
                <div><Label>CFO name</Label><Input value={filing.cfoName} onChange={(e) => setFiling((f) => ({ ...f, cfoName: e.target.value }))} /></div>
                <div><Label>CFO title</Label><Input value={filing.cfoTitle} onChange={(e) => setFiling((f) => ({ ...f, cfoTitle: e.target.value }))} /></div>
                <div><Label>CFO attested at</Label><Input type="datetime-local" value={filing.cfoAttestedAt} onChange={(e) => setFiling((f) => ({ ...f, cfoAttestedAt: e.target.value }))} /></div>
                <div><Label>External auditor name</Label><Input value={filing.auditorName} onChange={(e) => setFiling((f) => ({ ...f, auditorName: e.target.value }))} /></div>
                <div><Label>Auditor firm</Label><Input value={filing.auditorFirm} onChange={(e) => setFiling((f) => ({ ...f, auditorFirm: e.target.value }))} /></div>
                <div><Label>Auditor attested at</Label><Input type="datetime-local" value={filing.auditorAttestedAt} onChange={(e) => setFiling((f) => ({ ...f, auditorAttestedAt: e.target.value }))} /></div>
              </div>
              <Button
                disabled={submitManual.isPending || !filing.amount || !/^[a-f0-9]{64}$/i.test(filing.documentHash) || !filing.cfoName || !filing.cfoTitle || !filing.cfoAttestedAt || !filing.auditorName || !filing.auditorFirm || !filing.auditorAttestedAt}
                onClick={() => submitManual.mutate({
                  orgId: orgNum,
                  amount: Number(filing.amount),
                  fiscalYear: Number(filing.fiscalYear),
                  documentHash: filing.documentHash,
                  cfoName: filing.cfoName,
                  cfoTitle: filing.cfoTitle,
                  cfoAttestedAt: new Date(filing.cfoAttestedAt).toISOString(),
                  auditorName: filing.auditorName,
                  auditorFirm: filing.auditorFirm,
                  auditorAttestedAt: new Date(filing.auditorAttestedAt).toISOString(),
                })}>
                {submitManual.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Submit filing
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>FY</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attestations</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(records.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                  <TableCell>{r.source}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNGN(r.amount)}</TableCell>
                  <TableCell>{r.fiscal_year}</TableCell>
                  <TableCell><Badge variant="outline" className={STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.source === "manual_filing" ? `${r.attested_by_1 ? "1st ✓" : "1st —"} / ${r.attested_by_2 ? "2nd ✓" : "2nd —"}` : "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {r.source === "manual_filing" && r.attested_by_1 != null && r.attested_by_2 == null && (
                      <Button size="sm" variant="outline" onClick={() => { setAttestFor(r); setOfficerName(""); setOfficerRole(""); }}>2nd attest</Button>
                    )}
                    {r.source === "manual_filing" && r.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => { setVerifyFor(r); setVerifyDecision("verified"); setVerifyReason(""); }}>Verify</Button>
                    )}
                    {(r.status === "verified" || r.status === "disputed") && (
                      <Button size="sm" variant="ghost" onClick={() => { setTransitionFor(r); setTransitionTo("disputed"); setTransitionReason(""); setSupersededBy(""); }}>Transition</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {enabled && (records.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No revenue records for this organisation.</TableCell></TableRow>
              )}
              {!enabled && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Enter an organisation ID to load the register.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {attestFor && (
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-medium text-sm">Second attestation for filing #{attestFor.id}</h3>
              <p className="text-xs text-muted-foreground">Must be performed by a different officer than the first attestation, from their own session.</p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <div><Label>Officer name</Label><Input value={officerName} onChange={(e) => setOfficerName(e.target.value)} /></div>
                <div><Label>Officer role</Label><Input value={officerRole} onChange={(e) => setOfficerRole(e.target.value)} /></div>
              </div>
              <div className="flex gap-2">
                <Button disabled={attest.isPending || officerName.trim().length < 2 || officerRole.trim().length < 2}
                  onClick={() => attest.mutate({ id: attestFor.id, officerName: officerName.trim(), officerRole: officerRole.trim() })}>Confirm attestation</Button>
                <Button variant="ghost" onClick={() => setAttestFor(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {verifyFor && (
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-medium text-sm">NDPC decision on filing #{verifyFor.id}</h3>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <div>
                  <Label>Decision</Label>
                  <Select value={verifyDecision} onValueChange={(v) => setVerifyDecision(v as "verified" | "disputed")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="verified">Verify</SelectItem>
                      <SelectItem value="disputed">Dispute</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Reason {verifyDecision === "disputed" && "(required)"}</Label><Input value={verifyReason} onChange={(e) => setVerifyReason(e.target.value)} /></div>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={verifyManual.isPending || (verifyDecision === "disputed" && !verifyReason.trim())}
                  onClick={() => verifyManual.mutate({ id: verifyFor.id, decision: verifyDecision, reason: verifyReason.trim() || undefined })}>
                  Record decision
                </Button>
                <Button variant="ghost" onClick={() => setVerifyFor(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {transitionFor && (
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-medium text-sm">Transition record #{transitionFor.id} (currently {transitionFor.status})</h3>
              <div className="grid grid-cols-3 gap-3 max-w-2xl">
                <div>
                  <Label>New status</Label>
                  <Select value={transitionTo} onValueChange={(v) => setTransitionTo(v as (typeof REVENUE_STATUSES)[number])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REVENUE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Reason</Label><Input value={transitionReason} onChange={(e) => setTransitionReason(e.target.value)} /></div>
                <div><Label>Superseded by (record id)</Label><Input type="number" value={supersededBy} onChange={(e) => setSupersededBy(e.target.value)} /></div>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={transition.isPending}
                  onClick={() => transition.mutate({
                    id: transitionFor.id,
                    to: transitionTo,
                    reason: transitionReason.trim() || undefined,
                    supersededBy: supersededBy ? Number(supersededBy) : undefined,
                  })}>
                  Apply transition
                </Button>
                <Button variant="ghost" onClick={() => setTransitionFor(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Penalty preview tab (NDPA s.48) ────────────────────────────────────────

interface FactorForm {
  natureGravityDuration: string;
  categoriesOfData: string;
  dataSubjectCount: string;
  intent: "intentional" | "negligent" | "unintentional";
  priorInfringements: string;
  cooperationDegree: string;
  remediation: "none" | "partial" | "full";
}

const EMPTY_FACTORS: FactorForm = {
  natureGravityDuration: "0.5",
  categoriesOfData: "0.5",
  dataSubjectCount: "1000",
  intent: "negligent",
  priorInfringements: "0",
  cooperationDegree: "0.5",
  remediation: "partial",
};

function FactorsFields({ value, onChange }: { value: FactorForm; onChange: (f: FactorForm) => void }) {
  const set = (k: keyof FactorForm, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div><Label>Nature/gravity/duration (0-1)</Label><Input type="number" step="0.05" min={0} max={1} value={value.natureGravityDuration} onChange={(e) => set("natureGravityDuration", e.target.value)} /></div>
      <div><Label>Data categories (0-1)</Label><Input type="number" step="0.05" min={0} max={1} value={value.categoriesOfData} onChange={(e) => set("categoriesOfData", e.target.value)} /></div>
      <div><Label>Data subjects</Label><Input type="number" min={0} value={value.dataSubjectCount} onChange={(e) => set("dataSubjectCount", e.target.value)} /></div>
      <div>
        <Label>Intent</Label>
        <Select value={value.intent} onValueChange={(v) => set("intent", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="intentional">Intentional</SelectItem>
            <SelectItem value="negligent">Negligent</SelectItem>
            <SelectItem value="unintentional">Unintentional</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label>Prior infringements</Label><Input type="number" min={0} value={value.priorInfringements} onChange={(e) => set("priorInfringements", e.target.value)} /></div>
      <div><Label>Cooperation (0-1)</Label><Input type="number" step="0.05" min={0} max={1} value={value.cooperationDegree} onChange={(e) => set("cooperationDegree", e.target.value)} /></div>
      <div>
        <Label>Remediation</Label>
        <Select value={value.remediation} onValueChange={(v) => set("remediation", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="full">Full</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function toFactors(f: FactorForm) {
  return {
    natureGravityDuration: Math.min(1, Math.max(0, Number(f.natureGravityDuration) || 0)),
    categoriesOfData: Math.min(1, Math.max(0, Number(f.categoriesOfData) || 0)),
    dataSubjectCount: Math.max(0, Math.floor(Number(f.dataSubjectCount) || 0)),
    intent: f.intent,
    priorInfringements: Math.max(0, Math.floor(Number(f.priorInfringements) || 0)),
    cooperationDegree: Math.min(1, Math.max(0, Number(f.cooperationDegree) || 0)),
    remediation: f.remediation,
  };
}

function PenaltyTab() {
  const [orgId, setOrgId] = useState("");
  const [isDcpmi, setIsDcpmi] = useState(false);
  const [factors, setFactors] = useState<FactorForm>(EMPTY_FACTORS);
  const [preview, setPreview] = useState<any>(null);
  const [fineRef, setFineRef] = useState("");
  const [recomputeFactors, setRecomputeFactors] = useState<FactorForm>(EMPTY_FACTORS);
  const [recomputeResult, setRecomputeResult] = useState<any>(null);
  const [ledgerOrgId, setLedgerOrgId] = useState("");

  const compute = trpc.revenueVerification.computePenaltyPreview.useMutation({
    onSuccess: (data) => setPreview(data),
    onError: (e) => toast.error(e.message),
  });
  const recompute = trpc.revenueVerification.recomputeFine.useMutation({
    onSuccess: (data) => { setRecomputeResult(data); toast.success("Fine recomputed"); ledger.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const ledger = trpc.revenueVerification.listPenaltyComputations.useQuery(
    { orgId: ledgerOrgId ? Number(ledgerOrgId) : undefined },
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Calculator className="h-5 w-5" /> Section 48 penalty preview</CardTitle>
          <CardDescription>Dry-run computation against the best verified revenue on record. Nothing is persisted.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div><Label>Organisation ID</Label><Input type="number" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-36" /></div>
            <label className="flex items-center gap-2 pb-2 text-sm cursor-pointer">
              <Checkbox checked={isDcpmi} onCheckedChange={(v) => setIsDcpmi(!!v)} /> Data controller of major importance
            </label>
          </div>
          <FactorsFields value={factors} onChange={setFactors} />
          <Button
            disabled={compute.isPending || !Number(orgId)}
            onClick={() => compute.mutate({ orgId: Number(orgId), isDcpmi, factors: toFactors(factors) })}>
            {compute.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calculator className="h-4 w-4 mr-2" />}
            Compute preview
          </Button>
          {preview && (
            <div className="border rounded-lg p-4 text-sm space-y-1">
              {preview.revenueSource === "none" && (
                <p className="flex items-center gap-2 text-yellow-400"><AlertTriangle className="h-4 w-4" /> No verified revenue on record — computation falls back to the statutory floor.</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(preview).filter(([, v]) => typeof v === "number" || typeof v === "string" || v === null).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1")}</p>
                    <p className="font-mono font-medium">{typeof v === "number" && /amount|penalty|revenue|floor|cap/i.test(k) ? fmtNGN(v as number) : String(v ?? "—")}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {preview && (
            /* Similar decided cases for this penalty posture (round 12 W6, roadmap §4.3) */
            <SimilarPrecedentsPanel
              caseType="enforcement"
              queryText={`NDPA s.48 administrative penalty preview: ${factors.intent} infringement affecting ${factors.dataSubjectCount} data subjects, ${isDcpmi ? "data controller of major importance" : "standard controller"}, remediation ${factors.remediation}, prior infringements ${factors.priorInfringements}.`}
              title="Similar precedents"
            />
          )}
          {preview && typeof preview.finalAmount === "number" && (
            /* Advisory appeal-survival calibration badge (round 12 W8, roadmap P2).
               NEVER alters the s.48 amount — feedback flows to
               decision_feedback (surface='penalty_calibration'). */
            <PenaltyCalibrationBadge
              penaltyAmount={preview.finalAmount}
              legalBasisSection="s.48"
              orgId={Number(orgId) || undefined}
              queryText={`NDPA s.48 administrative penalty preview: ${factors.intent} infringement affecting ${factors.dataSubjectCount} data subjects, ${isDcpmi ? "data controller of major importance" : "standard controller"}, remediation ${factors.remediation}, prior infringements ${factors.priorInfringements}.`}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recompute an existing fine</CardTitle>
          <CardDescription>Re-runs the s.48 computation for an enforcement fine (id or reference) and appends a penalty_computations ledger row.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs"><Label>Fine ID or reference</Label><Input value={fineRef} onChange={(e) => setFineRef(e.target.value)} className="font-mono" placeholder="123 or NDSEP-PEN-000123" /></div>
          <FactorsFields value={recomputeFactors} onChange={setRecomputeFactors} />
          <Button
            disabled={recompute.isPending || !fineRef.trim()}
            onClick={() => recompute.mutate({ fineRef: /^\d+$/.test(fineRef.trim()) ? Number(fineRef.trim()) : fineRef.trim(), factors: toFactors(recomputeFactors) })}>
            {recompute.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Recompute fine
          </Button>
          {recomputeResult && (
            <div className="border rounded-lg p-3 text-sm space-y-1">
              <p><span className="text-muted-foreground">Fine:</span> {recomputeResult.fineReference} (#{recomputeResult.fineId})</p>
              <p><span className="text-muted-foreground">Prior amount:</span> {fmtNGN(recomputeResult.priorAmount)} → <span className="text-muted-foreground">New amount:</span> <strong>{fmtNGN(recomputeResult.newAmount)}</strong></p>
              <p className="text-xs text-muted-foreground">Computation ledger entry #{recomputeResult.computationId}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Penalty computation ledger</CardTitle>
          <CardDescription>Audit trail of s.48 computations (appeal defence). Filter by organisation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div><Label>Organisation ID (optional)</Label><Input type="number" value={ledgerOrgId} onChange={(e) => setLedgerOrgId(e.target.value)} className="w-40" /></div>
            <Button variant="ghost" size="sm" onClick={() => ledger.refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead><TableHead>Fine</TableHead><TableHead>Org</TableHead>
                <TableHead className="text-right">Prior</TableHead><TableHead className="text-right">New</TableHead><TableHead>Computed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ledger.data ?? []).map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">#{c.id}</TableCell>
                  <TableCell className="font-mono text-xs">{c.fine_id}</TableCell>
                  <TableCell>{c.org_id}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNGN(c.prior_amount)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNGN(c.new_amount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.created_at ? new Date(c.created_at).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
              {(ledger.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No computations recorded yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Integration tab ────────────────────────────────────────────────────────

function IntegrationTab() {
  const status = trpc.revenueVerification.integrationStatus.useQuery();
  const [service, setService] = useState<string>("");
  const audit = trpc.revenueVerification.listIntegrationAudit.useQuery({
    service: (service || undefined) as "firs" | "cac" | undefined,
    limit: 100,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(["firs", "cac"] as const).map((svc) => {
          const s: any = status.data?.[svc];
          return (
            <Card key={svc}>
              <CardHeader className="pb-2">
                <CardDescription className="uppercase font-mono text-xs">{svc} adapter</CardDescription>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {s?.configured
                    ? <><CheckCircle2 className="h-5 w-5 text-green-400" /> Configured</>
                    : <><AlertTriangle className="h-5 w-5 text-yellow-400" /> Unconfigured (fails closed)</>}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>Endpoint: {s?.endpoint ?? "—"}</p>
                <p>Credential fingerprint: {s?.credentialFingerprint ?? "—"}</p>
                {!s?.configured && <p className="text-yellow-400">Set {svc.toUpperCase()}_API_BASE / {svc.toUpperCase()}_API_KEY to enable live lookups.</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Integration credential audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={service || "all"} onValueChange={(v) => setService(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              <SelectItem value="firs">FIRS</SelectItem>
              <SelectItem value="cac">CAC</SelectItem>
            </SelectContent>
          </Select>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Time</TableHead><TableHead>Service</TableHead><TableHead>Operation</TableHead><TableHead>Outcome</TableHead><TableHead>Actor</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(audit.data ?? []).map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs text-muted-foreground">{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</TableCell>
                  <TableCell className="uppercase font-mono text-xs">{a.service}</TableCell>
                  <TableCell className="text-sm">{a.operation}</TableCell>
                  <TableCell><OutcomeBadge status={a.outcome} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.actor ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(audit.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No integration audit entries.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page shell ─────────────────────────────────────────────────────────────

export default function RevenueVerification() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Enforcement", href: "/enforcement" }, { label: "Revenue Verification" }]} />
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Landmark className="h-6 w-6" /> Revenue Verification — NDPA s.48
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          FIRS TIN/filed-revenue verification, CAC corporate records, dual-attested manual filings, and the
          s.48 penalty computation engine. External adapters fail closed when unconfigured.
        </p>
      </div>
      <Tabs defaultValue="lookups">
        <TabsList>
          <TabsTrigger value="lookups">TIN / CAC lookups</TabsTrigger>
          <TabsTrigger value="records">Revenue register</TabsTrigger>
          <TabsTrigger value="penalty">Penalty preview</TabsTrigger>
          <TabsTrigger value="integration">Integration</TabsTrigger>
        </TabsList>
        <TabsContent value="lookups" className="mt-4"><LookupsTab /></TabsContent>
        <TabsContent value="records" className="mt-4"><RecordsTab /></TabsContent>
        <TabsContent value="penalty" className="mt-4"><PenaltyTab /></TabsContent>
        <TabsContent value="integration" className="mt-4"><IntegrationTab /></TabsContent>
      </Tabs>
    </div>
  );
}
