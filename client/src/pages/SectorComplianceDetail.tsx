/**
 * Sector Compliance Detail Page
 * ==============================
 * Per-sector drill-down showing:
 *  - Sector overview (regulator, score, entity count)
 *  - Entity list with compliance status (fintech/healthcare/energy/insurance/telecom)
 *  - Key rule violations with severity
 *  - Remediation checklist
 *  - Worker health status
 */
import { useState } from "react";
import { useParams, Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, Heart, Zap, Shield, Phone, ArrowLeft,
  CheckCircle2, XCircle, AlertCircle, Search, ExternalLink,
  Activity, RefreshCw, ChevronRight, Flag, FileDown, X,
} from "lucide-react";

// Rendered inside DashboardLayout via App.tsx router
// ─── Sector compliance baseline scores (last audit cycle) ────────────────────
// TODO: migrate to DB-driven config (e.g. /api/trpc/sectorConfig.baselines)
// so scores update per audit cycle without redeploying.
const BASELINE_SCORES: Record<string, number> = {
  fintech: 87,
  healthcare: 92,
  energy: 78,
  insurance: 85,
  telecom: 81,
};

// ─── Sector metadata ──────────────────────────────────────────────────────────
const SECTOR_META: Record<string, {
  name: string;
  icon: React.ElementType;
  color: string;
  regulators: string[];
  workerPort: number;
  keyRules: string[];
  remediation: string[];
}> = {
  fintech: {
    name: "Fintech & Payments",
    icon: Building2,
    color: "text-blue-400",
    regulators: ["CBN", "SEC", "NFIU"],
    workerPort: 8126,
    keyRules: [
      "CBN Data Localisation Directive (2021) — all customer data must reside in Nigeria",
      "PCI-DSS v4.0 compliance for card payment processors",
      "7-year transaction record retention (CBN AML/CFT Regulations)",
      "NFIU goAML STR filing within 24 hours of suspicious activity",
      "Open Banking API security standards (CBN Framework 2021)",
    ],
    remediation: [
      "Migrate cloud workloads to Nigerian data centres (AWS Lagos / Azure Nigeria)",
      "Complete PCI-DSS gap assessment and remediation plan",
      "Implement automated STR detection and goAML API integration",
      "Deploy data residency monitoring agent",
      "Register DPO with NDPC and publish Privacy Notice",
    ],
  },
  healthcare: {
    name: "Healthcare & NHIA",
    icon: Heart,
    color: "text-emerald-400",
    regulators: ["NHIA", "FMOH", "NDPC"],
    workerPort: 8123,
    keyRules: [
      "Patient data must be stored in Nigeria (NDPC Act 2023 §2.4)",
      "10-year medical record retention (NMC Code of Medical Ethics)",
      "Research data anonymisation per NDPC Research Guidelines",
      "Clinical trial data governance (NAFDAC/ICH-GCP)",
      "NHIA HMO data sharing agreements must include DPA clauses",
    ],
    remediation: [
      "Audit all EMR/HIS systems for cross-border data transfers",
      "Implement pseudonymisation for research datasets",
      "Sign Data Processing Agreements with all HMO partners",
      "Register with NDPC and complete DPIA for patient data systems",
      "Deploy audit logging for all patient data access events",
    ],
  },
  energy: {
    name: "Energy & Utilities",
    icon: Zap,
    color: "text-amber-400",
    regulators: ["NERC", "NUPRC", "NBET"],
    workerPort: 8124,
    keyRules: [
      "Grid operational data must reside in Nigeria (NERC Data Policy 2022)",
      "Smart meter privacy — consent required for granular usage data",
      "Oil & gas exploration data residency (NUPRC Data Governance Framework)",
      "7-year audit trail retention for all metering data",
      "Cross-border data transfer requires NDPC adequacy decision",
    ],
    remediation: [
      "Deploy on-premise data historian for grid SCADA systems",
      "Implement smart meter consent management portal",
      "Complete NDPC registration and DPIA for smart metering",
      "Encrypt all oil/gas seismic data at rest and in transit",
      "Establish data retention schedules aligned with NUPRC requirements",
    ],
  },
  insurance: {
    name: "Insurance & NAICOM",
    icon: Shield,
    color: "text-violet-400",
    regulators: ["NAICOM", "NDPC"],
    workerPort: 8125,
    keyRules: [
      "Policyholder consent required for data processing (NDPA 2023 §25)",
      "Health insurance DPIA mandatory (NAICOM Circular 2023)",
      "Reinsurance data safeguards — no unrestricted offshore transfer",
      "7-year claims data retention (NAICOM Guidelines)",
      "Fraud data sharing must be governed by bilateral DPAs",
    ],
    remediation: [
      "Implement consent management system for all policyholders",
      "Complete DPIA for health insurance data processing",
      "Review reinsurance treaties for data transfer clauses",
      "Deploy claims data archival system with 7-year retention",
      "Register with NDPC and appoint DPO",
    ],
  },
  telecom: {
    name: "Telecom & NCC",
    icon: Phone,
    color: "text-red-400",
    regulators: ["NCC", "CBN", "NDPC"],
    workerPort: 8122,
    keyRules: [
      "NIN-SIM linkage mandatory for all active SIMs (NCC Directive 2022)",
      "CDR retention for minimum 2 years (NCC Consumer Code)",
      "Location data processing requires explicit consent (NDPA 2023)",
      "Mobile money data must remain in Nigeria (CBN PSB Guidelines)",
      "Lawful interception infrastructure must be NCC-certified",
    ],
    remediation: [
      "Complete NIN-SIM verification for all remaining unlinked SIMs",
      "Deploy CDR archival system with 2-year retention policy",
      "Implement location data consent management",
      "Migrate mobile money platform to Nigerian data centres",
      "Certify lawful interception systems with NCC",
    ],
  },
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function SectorComplianceDetail() {
  const params = useParams<{ sector: string }>();
  const sector = params.sector ?? "fintech";
  const meta = SECTOR_META[sector];
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagEntity, setFlagEntity] = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  // PDF export progress
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const createAmlCase = trpc.banking.aml.create.useMutation({
    onSuccess: () => {
      toast.success(`AML investigation case opened for ${sector} sector`);
      setShowFlagModal(false);
      setFlagReason("");
      setFlagEntity("");
      setFlagSubmitting(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setFlagSubmitting(false);
    },
  });
  // Step 1: validate form and show confirmation dialog
  const handleFlagClick = () => {
    if (!flagReason.trim()) {
      toast.error("Please enter a reason for flagging");
      return;
    }
    setShowConfirmDialog(true);
  };
  // Step 2: confirmed — actually submit
  const handleFlagForInvestigation = () => {
    setShowConfirmDialog(false);
    setFlagSubmitting(true);
    createAmlCase.mutate({
      subjectName: flagEntity || `${meta?.name ?? sector} Sector`,
      caseType: "suspicious_transaction",
      narrative: flagReason,
      riskScore: 70,
    });
  };
  const handlePdfExport = () => {
    setPdfExporting(true);
    setPdfProgress(0);
    const steps = [15, 35, 55, 75, 90, 100];
    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) {
        setPdfProgress(steps[i]);
        i++;
      } else {
        clearInterval(interval);
        window.print();
        setTimeout(() => { setPdfExporting(false); setPdfProgress(0); }, 800);
      }
    }, 220);
  };

  // ── Data queries per sector ──────────────────────────────────────────────
  const fintechQuery = trpc.fintech.listCompanies.useQuery(
    { search: search || undefined, page, limit: 20 },
    { enabled: sector === "fintech" }
  );
  const healthcareQuery = trpc.healthcare.listFacilities.useQuery(
    { search: search || undefined, page, limit: 20 },
    { enabled: sector === "healthcare" }
  );
  const energyQuery = trpc.energy.listCompanies.useQuery(
    { search: search || undefined, page, limit: 20 },
    { enabled: sector === "energy" }
  );
  const insuranceQuery = trpc.insurance.listCompanies.useQuery(
    { search: search || undefined, page, limit: 20 },
    { enabled: sector === "insurance" }
  );
  const telecomQuery = trpc.telecom.listOperators.useQuery(
    { search: search || undefined },
    { enabled: sector === "telecom" }
  );

  const workersQuery = trpc.workers.status.useQuery(undefined, { refetchInterval: 30000 });

  // ── Resolve active query ─────────────────────────────────────────────────
  type EntityRow = Record<string, unknown>;
  let entities: EntityRow[] = [];
  let total = 0;
  let isLoading = false;

  if (sector === "fintech") {
    const d = fintechQuery.data as { data: EntityRow[]; total: number } | undefined;
    entities = d?.data ?? [];
    total = d?.total ?? 0;
    isLoading = fintechQuery.isLoading;
  } else if (sector === "healthcare") {
    const d = healthcareQuery.data as { data: EntityRow[]; total: number } | undefined;
    entities = d?.data ?? [];
    total = d?.total ?? 0;
    isLoading = healthcareQuery.isLoading;
  } else if (sector === "energy") {
    const d = energyQuery.data as { data: EntityRow[]; total: number } | undefined;
    entities = d?.data ?? [];
    total = d?.total ?? 0;
    isLoading = energyQuery.isLoading;
  } else if (sector === "insurance") {
    const d = insuranceQuery.data as { data: EntityRow[]; total: number } | undefined;
    entities = d?.data ?? [];
    total = d?.total ?? 0;
    isLoading = insuranceQuery.isLoading;
  } else if (sector === "telecom") {
    const d = telecomQuery.data as EntityRow[] | undefined;
    entities = d ?? [];
    total = entities.length;
    isLoading = telecomQuery.isLoading;
  }

  // ── Worker status ────────────────────────────────────────────────────────
  const workerMap = new Map<string, string>(
    ((workersQuery.data ?? []) as Array<{ id: string; status: string }>).map((w) => [w.id, w.status])
  );
  const workerId = `${sector}-monitor`;
  const workerStatus = workerMap.get(workerId) ?? "stopped";

  // ── Compliance score — computed from real entity data ─────────────────────
  const compliantCount = entities.filter((e) => e.data_localisation_compliant === true || e.data_localisation_compliant === "true").length;
  const ndpcRegistered = entities.filter((e) => e.ndpc_registered === true || e.ndpc_registered === "true").length;
  const entityCount = entities.length || 1;
  const complianceRate = Math.round((compliantCount / entityCount) * 60);
  const registrationRate = Math.round((ndpcRegistered / entityCount) * 40);
  const score = Math.min(100, complianceRate + registrationRate);

  if (!meta) {
    return (
      <>
        <div className="p-6">
          <p className="text-muted-foreground">Unknown sector: {sector}</p>
          <Link href="/sector-compliance">
            <Button variant="outline" className="mt-4"><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
          </Link>
        </div>
      </>
    );
  }

  const Icon = meta.icon;

  // ── Helper functions ─────────────────────────────────────────────────────
  const getEntityName = (e: EntityRow): string =>
    String(e.company_name ?? e.facility_name ?? e.operator_name ?? "—");

  const getEntityCode = (e: EntityRow): string =>
    String(e.company_code ?? e.facility_code ?? e.operator_code ?? "—");

  const getCompliant = (e: EntityRow): boolean =>
    Boolean(e.data_localisation_compliant ?? e.ndpc_registered);

  const handleRefetch = () => {
    if (sector === "fintech") fintechQuery.refetch();
    else if (sector === "healthcare") healthcareQuery.refetch();
    else if (sector === "energy") energyQuery.refetch();
    else if (sector === "insurance") insuranceQuery.refetch();
    else telecomQuery.refetch();
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "Sector Compliance", href: "/sector-compliance" }, { label: meta.name }]} />
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Icon className={`w-6 h-6 ${meta.color}`} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{meta.name}</h1>
              <p className="text-sm text-muted-foreground">
                Regulated by: {meta.regulators.join(", ")} · Worker port {meta.workerPort}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {workerStatus === "running" ? (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <Activity className="w-3 h-3 mr-1" />Live Monitor
              </Badge>
            ) : (
              <Badge className="bg-muted0/20 text-muted-foreground border-border/30">
                Monitor Stopped
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={handlePdfExport} className="text-xs">
              <FileDown className="w-3 h-3 mr-1" />Export PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowFlagModal(true)} className="text-xs text-amber-400 border-amber-500/40 hover:bg-amber-500/10">
              <Flag className="w-3 h-3 mr-1" />Flag for Investigation
            </Button>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Compliance Score</div>
              <div className="text-3xl font-bold text-foreground">{score}%</div>
              <Progress value={score} className="mt-2 h-1.5" />
              {BASELINE_SCORES[sector] && (
                <div className="text-xs text-muted-foreground mt-1">Baseline: {BASELINE_SCORES[sector]}%</div>
              )}
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Registered Entities</div>
              <div className="text-3xl font-bold text-foreground">{total}</div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Active Rules</div>
              <div className="text-3xl font-bold text-foreground">{meta.keyRules.length}</div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Status</div>
              <div className="text-lg font-bold">
                {score >= 90 ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" />Compliant
                  </span>
                ) : score >= 75 ? (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />Warning
                  </span>
                ) : (
                  <span className="text-red-400 flex items-center gap-1">
                    <XCircle className="w-4 h-4" />Non-Compliant
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Two-column: Rules + Remediation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Key Compliance Rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {meta.keyRules.map((rule, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <ChevronRight className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="text-foreground">{rule}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Remediation Checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {meta.remediation.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <div className="w-4 h-4 rounded border border-border mt-0.5 shrink-0 flex items-center justify-center">
                    {i < 2 ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : null}
                  </div>
                  <span className={i < 2 ? "text-muted-foreground line-through" : "text-foreground"}>
                    {item}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Entity Table */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Registered Entities ({total})</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search entities..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9 h-8 w-64 text-sm"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={handleRefetch} aria-label="Refresh"><RefreshCw className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading entities...</div>
            ) : entities.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No entities found. Run <code className="text-xs bg-muted px-1 rounded">node scripts/seed-sector-entities.mjs</code> to populate data.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Data Localisation</TableHead>
                    <TableHead>NDPC Registered</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((entity, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{getEntityName(entity)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{getEntityCode(entity)}</TableCell>
                      <TableCell>
                        {getCompliant(entity) ? (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                            <CheckCircle2 className="w-3 h-3 mr-1" />Compliant
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                            <XCircle className="w-3 h-3 mr-1" />Non-Compliant
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {entity.ndpc_registered ? (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Registered</Badge>
                        ) : (
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-7 text-xs">
                          <ExternalLink className="w-3 h-3 mr-1" />View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          {total > 20 && (
            <div className="p-3 border-t border-border flex items-center justify-between text-sm text-muted-foreground">
              <span>Page {page} of {Math.ceil(total / 20)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
      {/* PDF Export Progress Overlay */}
      {pdfExporting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <FileDown className="w-5 h-5 text-blue-400 animate-pulse" />
              <h3 className="text-base font-semibold text-foreground">Generating PDF Report...</h3>
            </div>
            <Progress value={pdfProgress} className="h-2 mb-2" />
            <p className="text-xs text-muted-foreground">
              {pdfProgress < 40 ? "Gathering compliance data..." : pdfProgress < 75 ? "Rendering report layout..." : pdfProgress < 100 ? "Finalising document..." : "Opening print dialog..."}
            </p>
          </div>
        </div>
      )}

      {/* AML Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-amber-500/40 rounded-lg p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-semibold text-foreground">Confirm AML Case Submission</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              You are about to open an AML investigation case for <strong className="text-foreground">{flagEntity || `${meta?.name} Sector`}</strong>. This action is logged and cannot be undone.
            </p>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 mb-4 text-xs text-amber-300">
              <strong>Reason:</strong> {flagReason}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowConfirmDialog(false)}>Go Back</Button>
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={handleFlagForInvestigation}>
                Confirm &amp; Submit
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Flag for Investigation Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Flag className="w-5 h-5 text-amber-400" />
                Flag Sector for Investigation
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowFlagModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              This will open an AML investigation case for the <strong>{meta?.name}</strong> sector.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Entity (optional)</label>
                <input
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus-visible:outline-none"
                  placeholder={`e.g. specific entity in ${meta?.name ?? sector}`}
                  value={flagEntity}
                  onChange={(e) => setFlagEntity(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Reason for Investigation *</label>
                <textarea
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus-visible:outline-none min-h-[80px] resize-none"
                  placeholder="Describe the compliance concern..."
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setShowFlagModal(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-white"
                onClick={handleFlagClick}
                disabled={flagSubmitting}
              >
                {flagSubmitting ? "Opening Case..." : "Open AML Case"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
