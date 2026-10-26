import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useRbac } from "@/hooks/useRbac";
import { Fingerprint, RefreshCw, ShieldCheck, ShieldX, EyeOff, Server } from "lucide-react";

/**
 * NIN Identity Verification Console (Round-16 W2).
 * Wires the full ninIdentity router (7 procedures) — the privacy-preserving
 * NIMC adapter.
 *
 * PRIVACY HARD RULES:
 *  - The raw NIN is NEVER displayed after entry — any confirmation shows only
 *    the masked form (last 3 digits).
 *  - Subject references are keyed-HMAC pseudonyms server-side; this UI only
 *    ever renders assurance levels, statuses and audit metadata — never raw
 *    subject identifiers in results.
 */
function maskNin(nin: string): string {
  const digits = nin.replace(/\s+/g, "");
  if (digits.length < 3) return "***********";
  return `********${digits.slice(-3)}`;
}

const SUBJECT_TYPES = ["complainant", "dsar_requester", "user"] as const;
type SubjectType = (typeof SUBJECT_TYPES)[number];

const LEVEL_COLORS: Record<string, string> = {
  nin_verified: "bg-green-500/20 text-green-300 border-green-500/40",
  basic: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  none: "bg-muted text-muted-foreground border-border",
};
const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-300 border-green-500/40",
  expired: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  revoked: "bg-red-500/20 text-red-300 border-red-500/40",
  none: "bg-muted text-muted-foreground border-border",
};

function fmtTs(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function NinIdentity() {
  const { isAdmin, isGovernmentStaff } = useRbac();

  // ── Provider (NIMC adapter) status ─────────────────────────────────────────
  const adapter = trpc.ninIdentity.adapterStatus.useQuery();

  // ── NIN verification request ───────────────────────────────────────────────
  const [ninForm, setNinForm] = useState({ nin: "", subjectType: "complainant" as SubjectType, subjectRef: "", possessionProof: "", consent: false });
  const [ninResult, setNinResult] = useState<any | null>(null);
  const verifyNin = trpc.ninIdentity.verifyNin.useMutation({
    onSuccess: (r: any) => {
      if (r?.verified) {
        toast.success("NIMC verification succeeded — subject is NIN-verified");
      } else {
        toast.error(`NIMC verification failed: ${r?.reason ?? "no match"}`);
      }
      // Display the result with a masked NIN (last-3 only) — the raw NIN is
      // discarded from component state immediately after the mutation.
      setNinResult({ ...r, ninMasked: maskNin(ninForm.nin) });
      setNinForm({ ...ninForm, nin: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Basic self-attestation ─────────────────────────────────────────────────
  const [basicForm, setBasicForm] = useState({ subjectType: "complainant" as SubjectType, subjectRef: "", possessionProof: "", consent: false });
  const verifyBasic = trpc.ninIdentity.verifyBasic.useMutation({
    onSuccess: (r: any) => { toast.success(`Basic attestation recorded (verification #${r.verificationId})`); setBasicForm({ ...basicForm, subjectRef: "", possessionProof: "", consent: false }); },
    onError: (err) => toast.error(err.message),
  });

  // ── Status check (staff) ───────────────────────────────────────────────────
  const [checkForm, setCheckForm] = useState({ subjectType: "complainant" as SubjectType, subjectRef: "" });
  const [checkActive, setCheckActive] = useState<{ subjectType: SubjectType; subjectRef: string } | null>(null);
  const check = trpc.ninIdentity.checkVerification.useQuery(
    { subjectType: checkActive?.subjectType as SubjectType, subjectRef: checkActive?.subjectRef as string },
    { enabled: !!checkActive && isGovernmentStaff, retry: false }
  );

  // ── Revoke (admin) ─────────────────────────────────────────────────────────
  const [revokeForm, setRevokeForm] = useState({ subjectType: "complainant" as SubjectType, subjectRef: "", reason: "" });
  const revoke = trpc.ninIdentity.revoke.useMutation({
    onSuccess: () => { toast.success("Verification revoked"); setRevokeForm({ subjectType: "complainant", subjectRef: "", reason: "" }); check.refetch(); audit.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Audit trail / verification history (admin) ─────────────────────────────
  const [auditForm, setAuditForm] = useState({ subjectType: "complainant" as SubjectType, subjectRef: "" });
  const [auditActive, setAuditActive] = useState<{ subjectType: SubjectType; subjectRef: string } | null>(null);
  const audit = trpc.ninIdentity.auditTrail.useQuery(
    { subjectType: auditActive?.subjectType as SubjectType, subjectRef: auditActive?.subjectRef as string, limit: 50 },
    { enabled: !!auditActive && isAdmin, retry: false }
  );

  // ── Biometric (explicitly NOT_IMPLEMENTED adapter seam) ────────────────────
  const [bioForm, setBioForm] = useState({ subjectType: "complainant" as SubjectType, subjectRef: "" });
  const verifyBiometric = trpc.ninIdentity.verifyBiometric.useMutation({
    onSuccess: (r: any) => toast.info(r?.note ?? "Biometric verification is not implemented.", { duration: 10000 }),
    onError: (err) => toast.error(err.message),
  });

  const adapterData: any = adapter.data;
  const checkData: any = check.data;
  const auditRows: any[] = (audit.data as any[]) ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "NIN Identity" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Fingerprint className="h-6 w-6" /> NIN Identity Verification</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Privacy-preserving NIMC verification under NDPA 2023 data-minimisation: the raw NIN is never persisted,
            never logged, and never displayed — only keyed HMACs and opaque adapter tokens exist server-side.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { adapter.refetch(); check.refetch(); audit.refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* Provider status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" /> NIMC adapter status</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3 flex-wrap items-center">
          <Badge variant="outline" className={adapterData?.status === "configured" ? "bg-green-500/20 text-green-300 border-green-500/40" : "bg-red-500/20 text-red-300 border-red-500/40"}>
            {adapterData?.status ?? "…"}
          </Badge>
          <Badge variant="outline">adapter: {adapterData?.adapter ?? "nimc"}</Badge>
          <Badge variant="outline">verification TTL: {adapterData?.ttlDays ?? "—"} days</Badge>
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">biometric: NOT_IMPLEMENTED</Badge>
          {adapterData?.status === "UNCONFIGURED" && (
            <span className="text-xs text-muted-foreground">{adapterData?.reason} — verification attempts fail explicitly; no silent mock responses.</span>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="verify">
        <TabsList className="flex-wrap">
          <TabsTrigger value="verify">Verify (NIN)</TabsTrigger>
          <TabsTrigger value="basic">Basic attestation</TabsTrigger>
          <TabsTrigger value="status">Status check</TabsTrigger>
          <TabsTrigger value="history">Verification history</TabsTrigger>
          <TabsTrigger value="revoke">Revoke</TabsTrigger>
          <TabsTrigger value="biometric">Biometric</TabsTrigger>
        </TabsList>

        {/* ── NIN verification ──────────────────────────────────────────── */}
        <TabsContent value="verify" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Verification request (NIMC-backed)</CardTitle>
              <CardDescription>
                The 11-digit NIN is used in-memory for the adapter call and its HMAC, then discarded. Per-IP and
                per-subject rate limits apply. Biometric/liveness is not performed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>NIN (11 digits — never stored or displayed)</Label>
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={11}
                    value={ninForm.nin}
                    onChange={(e) => setNinForm({ ...ninForm, nin: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                    placeholder="•••••••••••"
                  />
                </div>
                <div>
                  <Label>Subject type</Label>
                  <Select value={ninForm.subjectType} onValueChange={(v) => setNinForm({ ...ninForm, subjectType: v as SubjectType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SUBJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject reference (hashed server-side)</Label>
                  <Input value={ninForm.subjectRef} onChange={(e) => setNinForm({ ...ninForm, subjectRef: e.target.value })} placeholder="Complaint/DSAR tracking ref" />
                </div>
                <div>
                  <Label>Possession proof (tracking secret / email challenge)</Label>
                  <Input value={ninForm.possessionProof} onChange={(e) => setNinForm({ ...ninForm, possessionProof: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input id="nin-consent" type="checkbox" checked={ninForm.consent} onChange={(e) => setNinForm({ ...ninForm, consent: e.target.checked })} className="h-4 w-4" />
                <Label htmlFor="nin-consent">Subject consent to NIMC verification confirmed</Label>
              </div>
              <Button
                disabled={ninForm.nin.length !== 11 || !ninForm.subjectRef.trim() || ninForm.possessionProof.length < 8 || !ninForm.consent || verifyNin.isPending}
                onClick={() => verifyNin.mutate({
                  nin: ninForm.nin,
                  subjectType: ninForm.subjectType,
                  subjectRef: ninForm.subjectRef.trim(),
                  possessionProof: ninForm.possessionProof,
                  consent: true,
                })}
              >Verify with NIMC</Button>
            </CardContent>
          </Card>

          {ninResult && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  {ninResult.verified ? <ShieldCheck className="h-4 w-4 text-green-400" /> : <ShieldX className="h-4 w-4 text-red-400" />}
                  Verification result — {ninResult.ninMasked}
                </CardTitle>
                <CardDescription className="flex items-center gap-1"><EyeOff className="h-3 w-3" /> NIN masked to last-3; the raw value was discarded immediately.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2 flex-wrap items-center">
                  <Badge variant="outline" className={ninResult.verified ? "bg-green-500/20 text-green-300 border-green-500/40" : "bg-red-500/20 text-red-300 border-red-500/40"}>
                    {ninResult.verified ? "MATCH" : "NO MATCH"}
                  </Badge>
                  <Badge variant="outline" className={LEVEL_COLORS[ninResult.assuranceLevel] ?? ""}>assurance: {ninResult.assuranceLevel}</Badge>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Attribute</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm">NIN registry match (NIMC)</TableCell>
                      <TableCell className="text-sm">{ninResult.verified ? "matched" : (ninResult.reason ?? "not matched")}</TableCell>
                    </TableRow>
                    {ninResult.verified && (
                      <>
                        <TableRow><TableCell className="text-sm">Verification ID</TableCell><TableCell className="font-mono text-xs">#{ninResult.verificationId}</TableCell></TableRow>
                        <TableRow><TableCell className="text-sm">Verified at</TableCell><TableCell className="text-xs">{fmtTs(ninResult.verifiedAt)}</TableCell></TableRow>
                        <TableRow><TableCell className="text-sm">Expires at</TableCell><TableCell className="text-xs">{fmtTs(ninResult.expiresAt)}</TableCell></TableRow>
                        <TableRow><TableCell className="text-sm">Opaque verification token (shown once)</TableCell><TableCell className="font-mono text-xs break-all">{ninResult.verificationToken}</TableCell></TableRow>
                      </>
                    )}
                    <TableRow>
                      <TableCell className="text-sm">Biographic attributes</TableCell>
                      <TableCell className="text-xs text-muted-foreground">Attribute-level breakdown is not returned by the adapter — data minimisation (NDPA); only the aggregate match verdict is surfaced.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Basic attestation ─────────────────────────────────────────── */}
        <TabsContent value="basic" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Basic self-attestation (no NIMC call)</CardTitle>
              <CardDescription>
                Attaches a minimum 'basic' assurance level when a subject declares identity without document proof.
                A basic attestation can never supersede an active NIN-verified identity.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <Label>Subject type</Label>
                  <Select value={basicForm.subjectType} onValueChange={(v) => setBasicForm({ ...basicForm, subjectType: v as SubjectType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SUBJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject reference</Label>
                  <Input value={basicForm.subjectRef} onChange={(e) => setBasicForm({ ...basicForm, subjectRef: e.target.value })} />
                </div>
                <div>
                  <Label>Possession proof</Label>
                  <Input value={basicForm.possessionProof} onChange={(e) => setBasicForm({ ...basicForm, possessionProof: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input id="basic-consent" type="checkbox" checked={basicForm.consent} onChange={(e) => setBasicForm({ ...basicForm, consent: e.target.checked })} className="h-4 w-4" />
                <Label htmlFor="basic-consent">Subject consent confirmed</Label>
              </div>
              <Button
                disabled={!basicForm.subjectRef.trim() || basicForm.possessionProof.length < 8 || !basicForm.consent || verifyBasic.isPending}
                onClick={() => verifyBasic.mutate({ subjectType: basicForm.subjectType, subjectRef: basicForm.subjectRef.trim(), possessionProof: basicForm.possessionProof, consent: true })}
              >Record basic attestation</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Status check (staff) ──────────────────────────────────────── */}
        <TabsContent value="status" className="mt-4">
          {!isGovernmentStaff && <p className="text-sm text-muted-foreground">Assurance status checks are staff-only — assurance status is operational metadata, not public information.</p>}
          {isGovernmentStaff && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Check verification status</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-3 gap-3">
                  <div>
                    <Label>Subject type</Label>
                    <Select value={checkForm.subjectType} onValueChange={(v) => setCheckForm({ ...checkForm, subjectType: v as SubjectType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SUBJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Subject reference</Label>
                    <Input value={checkForm.subjectRef} onChange={(e) => setCheckForm({ ...checkForm, subjectRef: e.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button disabled={!checkForm.subjectRef.trim() || check.isFetching} onClick={() => setCheckActive({ subjectType: checkForm.subjectType, subjectRef: checkForm.subjectRef.trim() })}>Check</Button>
                  </div>
                </div>
                {checkActive && checkData && (
                  <div className="rounded-md border p-4 flex gap-2 flex-wrap items-center">
                    <Badge variant="outline">{checkData.subjectType}</Badge>
                    <Badge variant="outline" className={LEVEL_COLORS[checkData.assuranceLevel] ?? ""}>assurance: {checkData.assuranceLevel}</Badge>
                    <Badge variant="outline" className={STATUS_COLORS[checkData.status] ?? ""}>status: {checkData.status}</Badge>
                    {checkData.verifiedAt && <span className="text-xs text-muted-foreground">verified {fmtTs(checkData.verifiedAt)}</span>}
                    {checkData.expiresAt && <span className="text-xs text-muted-foreground">expires {fmtTs(checkData.expiresAt)}</span>}
                  </div>
                )}
                {checkActive && check.error && <p className="text-sm text-red-400">{check.error.message}</p>}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Verification history / audit trail (admin) ────────────────── */}
        <TabsContent value="history" className="mt-4">
          {!isAdmin && <p className="text-sm text-muted-foreground">The verification audit trail is restricted to admins and auditors.</p>}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Verification history (audit trail)</CardTitle>
                <CardDescription>Every verify/check/revoke is logged. Audit details never contain a raw NIN — the server refuses to persist 11-digit values.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-3 gap-3">
                  <div>
                    <Label>Subject type</Label>
                    <Select value={auditForm.subjectType} onValueChange={(v) => setAuditForm({ ...auditForm, subjectType: v as SubjectType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SUBJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Subject reference</Label>
                    <Input value={auditForm.subjectRef} onChange={(e) => setAuditForm({ ...auditForm, subjectRef: e.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button disabled={!auditForm.subjectRef.trim() || audit.isFetching} onClick={() => setAuditActive({ subjectType: auditForm.subjectType, subjectRef: auditForm.subjectRef.trim() })}>Load history</Button>
                  </div>
                </div>
                {auditActive && (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>ID</TableHead><TableHead>Verification</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Details</TableHead><TableHead>At</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditRows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                          <TableCell className="font-mono text-xs">{r.verification_id != null ? `#${r.verification_id}` : "—"}</TableCell>
                          <TableCell><Badge variant="outline">{r.action}</Badge></TableCell>
                          <TableCell className="text-xs">{r.actor ?? "system/public"}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[320px] truncate" title={typeof r.details === "string" ? r.details : JSON.stringify(r.details)}>
                            {typeof r.details === "string" ? r.details : JSON.stringify(r.details)}
                          </TableCell>
                          <TableCell className="text-xs">{fmtTs(r.created_at)}</TableCell>
                        </TableRow>
                      ))}
                      {auditRows.length === 0 && !audit.isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No audit entries for this subject.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                )}
                {auditActive && audit.error && <p className="text-sm text-red-400">{audit.error.message}</p>}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Revoke (admin) ────────────────────────────────────────────── */}
        <TabsContent value="revoke" className="mt-4">
          {!isAdmin && <p className="text-sm text-muted-foreground">Revoking verifications is admin-only.</p>}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Revoke verification</CardTitle>
                <CardDescription>e.g. NIMC revocation notice or fraud flag. Revocation is audit-logged.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-3 gap-3">
                  <div>
                    <Label>Subject type</Label>
                    <Select value={revokeForm.subjectType} onValueChange={(v) => setRevokeForm({ ...revokeForm, subjectType: v as SubjectType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SUBJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Subject reference</Label>
                    <Input value={revokeForm.subjectRef} onChange={(e) => setRevokeForm({ ...revokeForm, subjectRef: e.target.value })} />
                  </div>
                  <div>
                    <Label>Reason (min 4 chars)</Label>
                    <Input value={revokeForm.reason} onChange={(e) => setRevokeForm({ ...revokeForm, reason: e.target.value })} />
                  </div>
                </div>
                <Button
                  variant="destructive"
                  disabled={!revokeForm.subjectRef.trim() || revokeForm.reason.trim().length < 4 || revoke.isPending}
                  onClick={() => revoke.mutate({ subjectType: revokeForm.subjectType, subjectRef: revokeForm.subjectRef.trim(), reason: revokeForm.reason.trim() })}
                >Revoke verification</Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Biometric (adapter seam) ──────────────────────────────────── */}
        <TabsContent value="biometric" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Biometric / liveness verification</CardTitle>
              <CardDescription>
                EXPLICITLY NOT IMPLEMENTED — this is the adapter interface seam only. No biometric capture, matching,
                or storage exists on this platform. Calls return NOT_IMPLEMENTED and are audit-logged.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>Subject type</Label>
                  <Select value={bioForm.subjectType} onValueChange={(v) => setBioForm({ ...bioForm, subjectType: v as SubjectType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SUBJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject reference</Label>
                  <Input value={bioForm.subjectRef} onChange={(e) => setBioForm({ ...bioForm, subjectRef: e.target.value })} />
                </div>
              </div>
              <Button
                variant="outline"
                disabled={!bioForm.subjectRef.trim() || verifyBiometric.isPending}
                onClick={() => verifyBiometric.mutate({ subjectType: bioForm.subjectType, subjectRef: bioForm.subjectRef.trim() })}
              >Probe biometric adapter (returns NOT_IMPLEMENTED)</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
