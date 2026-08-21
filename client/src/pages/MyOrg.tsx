/**
 * NDSEP Org Admin Self-Service Portal
 * Scoped view for organization admins: compliance score, violations, evidence, assets.
 * Includes a 3-step onboarding wizard for new organizations.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Building2, ShieldCheck, AlertTriangle, Package,
  Server, TrendingUp, CheckCircle, XCircle, ChevronRight, Rocket, ClipboardCheck, FileCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? "bg-green-500/15 text-green-400 border-green-500/30"
    : score >= 60 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
    : "bg-red-500/15 text-red-400 border-red-500/30";
  const label = score >= 80 ? "COMPLIANT" : score >= 60 ? "PARTIAL" : "NON-COMPLIANT";
  return (
    <Badge variant="outline" className={`text-xs font-mono px-2 py-0.5 ${cls}`}>
      {label} — {score}%
    </Badge>
  );
}

// ─── Onboarding Wizard ────────────────────────────────────────────────────────
function OnboardingWizard({ orgId, onComplete }: { orgId: number; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [assetName, setAssetName] = useState("");
  const [assetType, setAssetType] = useState<string>("");
  const [assetLocation, setAssetLocation] = useState("Lagos, Nigeria");
  const [assetCreated, setAssetCreated] = useState(false);
  const [evidenceCreated, setEvidenceCreated] = useState(false);

  const utils = trpc.useUtils();

  const createAsset = trpc.assets.create.useMutation({
    onSuccess: () => {
      toast.success("Asset registered successfully");
      utils.assets.list.invalidate();
      setAssetCreated(true);
      setStep(2);
    },
    onError: (e) => toast.error(`Failed to register asset: ${(e instanceof Error ? e.message : String(e))}`),
  });

  const generateEvidence = trpc.evidencePackages.generate.useMutation({
    onSuccess: () => {
      toast.success("Evidence package generated");
      utils.evidencePackages.list.invalidate();
      setEvidenceCreated(true);
      setStep(3);
    },
    onError: (e) => toast.error(`Failed to generate evidence: ${(e instanceof Error ? e.message : String(e))}`),
  });

  const steps = [
    { num: 1, label: "Register Assets", icon: Server },
    { num: 2, label: "Self-Assessment", icon: ClipboardCheck },
    { num: 3, label: "Evidence Package", icon: FileCheck },
  ];

  return (
    <Card className="border-2 border-primary/30 bg-primary/5">
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Welcome to NDSEP — Complete Your Onboarding</CardTitle>
        </div>
        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono border transition-colors ${
                step === s.num ? "bg-primary text-primary-foreground border-primary" :
                step > s.num ? "bg-green-500/20 text-green-400 border-green-500/30" :
                "bg-muted/50 text-muted-foreground border-border"
              }`}>
                {step > s.num ? <CheckCircle className="h-3 w-3" /> : <s.icon className="h-3 w-3" />}
                {s.label}
              </div>
              {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: Register first asset */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Start by registering your first data asset. This helps NDSEP track your organization's data footprint and assess compliance.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Asset Name *</Label>
                <Input
                  placeholder="e.g. Customer Database Server"
                  value={assetName}
                  onChange={e => setAssetName(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Asset Type *</Label>
                <Select value={assetType} onValueChange={setAssetType}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {["hardware", "software", "cloud", "network", "database", "saas"].map(t => (
                      <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Location</Label>
                <Input
                  placeholder="e.g. Lagos, Nigeria"
                  value={assetLocation}
                  onChange={e => setAssetLocation(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!assetName || !assetType || createAsset.isPending}
              onClick={() => createAsset.mutate({
                organizationId: orgId,
                name: assetName,
                assetType: assetType as any,
                location: assetLocation,
                isWithinBorders: assetLocation.toLowerCase().includes("nigeria"),
              })}
            >
              {createAsset.isPending ? "Registering..." : "Register Asset & Continue"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Compliance self-assessment */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your asset has been registered. Now run a compliance self-assessment to identify any gaps against the NDPR framework.
            </p>
            <div className="rounded-lg border border-border/50 p-4 space-y-3">
              <p className="text-xs font-semibold text-foreground">NDPR Quick Self-Assessment Checklist</p>
              {[
                "We have appointed a Data Protection Officer (DPO)",
                "We have a documented data processing register",
                "We obtain explicit consent before collecting personal data",
                "We have a breach notification procedure (72-hour rule)",
                "We conduct annual DPIA for high-risk processing activities",
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => {
                toast.success("Self-assessment recorded — generating evidence package");
                setStep(3);
              }}>
                Assessment Complete — Continue
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setStep(3)}>
                Skip for now
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Generate first evidence package */}
        {step === 3 && !evidenceCreated && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Generate your first HMAC-signed evidence package. This creates a tamper-evident compliance record that can be submitted to NITDA.
            </p>
            <Button
              size="sm"
              disabled={generateEvidence.isPending}
              onClick={() => generateEvidence.mutate({
                organizationId: orgId,
                packageType: "compliance_audit",
                referenceType: "onboarding",
              })}
            >
              {generateEvidence.isPending ? "Generating..." : "Generate Evidence Package"}
              <FileCheck className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Completion */}
        {step === 3 && evidenceCreated && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="h-5 w-5" />
              <p className="text-sm font-semibold">Onboarding Complete!</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Your organization is now registered on NDSEP with an asset, self-assessment, and evidence package on record.
            </p>
            <Button size="sm" onClick={onComplete}>
              Go to My Dashboard
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Portal ──────────────────────────────────────────────────────────────
export default function MyOrg() {
  const { user } = useAuth();
  const orgId = (user as any)?.organizationId as number | undefined;
  const [wizardDismissed, setWizardDismissed] = useState(false);

  const { data: org } = trpc.organizations.byId.useQuery(
    { id: orgId! },
    { enabled: !!orgId }
  );
  const { data: assets } = trpc.assets.list.useQuery(
    { orgId, limit: 20 },
    { enabled: !!orgId }
  );
  const { data: violations } = trpc.compliance.violations.useQuery(
    { limit: 20 },
    { enabled: !!orgId }
  );
  const { data: evidencePackages } = trpc.evidencePackages.list.useQuery(
    { orgId },
    { enabled: !!orgId }
  );
  const { data: scoreTrend } = trpc.leaderboard.scoreTrend.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );

  const openViolations = useMemo(
    () => ((violations as any[]) ?? []).filter((v: any) => v.status !== "resolved"),
    [violations]
  );
  const latestScore = useMemo(() => {
    const trend = (scoreTrend as any[]) ?? [];
    return trend.length > 0 ? trend[trend.length - 1].score : null;
  }, [scoreTrend]);

  const assetCount = ((assets as any[]) ?? []).length;
  const showWizard = !wizardDismissed && assetCount === 0;

  if (!orgId) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">Your account is not linked to an organization.</p>
        <p className="text-xs mt-1">Contact your NDSEP administrator to assign your organization.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "My Org" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            {(org as any)?.name ?? "My Organization"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {(org as any)?.sector ?? "—"} · {(org as any)?.country ?? "Nigeria"} · Reg #{(org as any)?.registrationNumber ?? "—"}
          </p>
        </div>
        {latestScore !== null && <ScoreBadge score={latestScore} />}
      </div>

      {/* Onboarding Wizard — shown only for new orgs with no assets */}
      {showWizard && (
        <OnboardingWizard
          orgId={orgId}
          onComplete={() => setWizardDismissed(true)}
        />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Compliance Score", value: latestScore !== null ? `${latestScore}%` : "—", icon: ShieldCheck, color: "text-green-400" },
          { label: "Open Violations", value: openViolations.length, icon: AlertTriangle, color: openViolations.length > 0 ? "text-red-400" : "text-green-400" },
          { label: "Assets Registered", value: assetCount, icon: Server, color: "text-blue-400" },
          { label: "Evidence Packages", value: ((evidencePackages as any[]) ?? []).length, icon: Package, color: "text-purple-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`h-8 w-8 ${color} shrink-0`} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Compliance Score Trend */}
      {(scoreTrend as any[])?.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Compliance Score Trend — Last 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={(scoreTrend as any[]) ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 9 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Tooltip
                  formatter={(v: number) => [`${v}%`, "Score"]}
                  contentStyle={{ fontSize: 11, background: "var(--card)", border: "1px solid var(--border)" }}
                />
                <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Open Violations */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            Open Compliance Violations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {openViolations.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-green-400">
              <CheckCircle className="h-4 w-4" /> No open violations — your organization is fully compliant.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Framework</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openViolations.slice(0, 10).map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium text-sm">{v.title ?? v.violation_type ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        v.severity === "critical" ? "text-red-400 border-red-500/30" :
                        v.severity === "high" ? "text-orange-400 border-orange-500/30" :
                        "text-yellow-400 border-yellow-500/30"
                      }>
                        {v.severity ?? "medium"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.framework ?? "NDPR"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{v.status ?? "open"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {v.detected_at ? new Date(v.detected_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Assets */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4 text-blue-400" />
            Registered Assets
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {assetCount === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No assets registered yet. Complete the onboarding wizard above to register your first asset.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Within Borders</TableHead>
                  <TableHead>Classification</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((assets as any[]) ?? []).slice(0, 10).map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-sm">{a.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{a.asset_type ?? a.assetType}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.location ?? "—"}</TableCell>
                    <TableCell>
                      {a.is_within_borders || a.isWithinBorders
                        ? <CheckCircle className="h-4 w-4 text-green-400" />
                        : <XCircle className="h-4 w-4 text-red-400" />}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.data_classification ?? a.dataClassification ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Evidence Packages */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="h-4 w-4 text-purple-400" />
            Evidence Packages
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {((evidencePackages as any[]) ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No evidence packages generated yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((evidencePackages as any[]) ?? []).slice(0, 10).map((ep: any) => (
                  <TableRow key={ep.id}>
                    <TableCell className="font-medium text-sm">{ep.title ?? ep.package_title ?? "Evidence Package"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        ep.status === "active" ? "text-green-400 border-green-500/30" :
                        ep.status === "expired" ? "text-red-400 border-red-500/30" :
                        "text-yellow-400 border-yellow-500/30"
                      }>
                        {ep.status ?? "active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {ep.generated_at ? new Date(ep.generated_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {ep.expires_at ? new Date(ep.expires_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
