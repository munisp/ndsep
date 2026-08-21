import { useState, useRef, useCallback } from "react";
import { useNdsepSocket } from "@/hooks/useNdsepSocket";
import type { NdsepEvent } from "@/hooks/useNdsepSocket";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Building2, Upload, FileText, CheckCircle2, ClipboardCheck, Shield,
  Award, ChevronRight, ChevronLeft, Globe, Phone, Mail, Hash, AlertCircle,
  Loader2, Database, HardDrive, Network, Server, Cloud, Cpu, Scale, ReceiptText, Copy, ExternalLink
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const SECTORS = [
  { value: "bank", label: "Commercial Bank", icon: "🏦" },
  { value: "telecom", label: "Telecommunications", icon: "📡" },
  { value: "healthcare", label: "Healthcare / Hospital", icon: "🏥" },
  { value: "government", label: "Government Agency", icon: "🏛️" },
  { value: "fintech", label: "Fintech / Payment Provider", icon: "💳" },
  { value: "energy", label: "Energy / Utilities", icon: "⚡" },
  { value: "insurance", label: "Insurance", icon: "🛡️" },
  { value: "education", label: "Education", icon: "🎓" },
];

const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Egypt", "Ethiopia",
  "Tanzania", "Rwanda", "Senegal", "Côte d'Ivoire", "Cameroon", "Uganda",
];

const ASSET_TYPES = [
  { value: "hardware", label: "Physical Hardware", icon: HardDrive },
  { value: "software", label: "Software Systems", icon: Cpu },
  { value: "cloud", label: "Cloud Infrastructure", icon: Cloud },
  { value: "network", label: "Network Devices", icon: Network },
  { value: "database", label: "Databases", icon: Database },
  { value: "saas", label: "SaaS Applications", icon: Server },
];

const SELF_ASSESSMENT_QUESTIONS = [
  { id: "q1", category: "Data Residency", question: "All citizen data is stored within national borders?", weight: 20 },
  { id: "q2", category: "Data Residency", question: "Cross-border transfers require pre-approval?", weight: 15 },
  { id: "q3", category: "Access Control", question: "Role-based access control (RBAC) is enforced on all systems?", weight: 15 },
  { id: "q4", category: "Access Control", question: "Multi-factor authentication is enabled for all admin accounts?", weight: 10 },
  { id: "q5", category: "Encryption", question: "All data at rest is encrypted (AES-256 or equivalent)?", weight: 10 },
  { id: "q6", category: "Encryption", question: "All data in transit uses TLS 1.2 or higher?", weight: 10 },
  { id: "q7", category: "Audit", question: "Immutable audit logs are maintained for all data access events?", weight: 10 },
  { id: "q8", category: "Incident Response", question: "An incident response plan is documented and tested?", weight: 5 },
  { id: "q9", category: "Incident Response", question: "Security incidents are reported within 72 hours?", weight: 5 },
];

const PHASES = [
  { id: 1, label: "Organization Details", icon: Building2, description: "Basic registration information" },
  { id: 2, label: "Asset Inventory", icon: HardDrive, description: "Declare your IT assets" },
  { id: 3, label: "Data Catalog", icon: Database, description: "Declare datasets and storage" },
  { id: 4, label: "Self-Assessment", icon: ClipboardCheck, description: "Compliance questionnaire" },
  { id: 5, label: "Review & Submit", icon: CheckCircle2, description: "Review and submit for audit" },
];

export default function OrgPortal() {
  // ── Real-time WebSocket alerts ─────────────────────────────────────────────
  const handleSocketEvent = useCallback((event: NdsepEvent) => {
    if (event.type === "org_portal_update") {
      const { orgName, newPhase, decision } = event.payload;
      const phaseLabel = decision === "certify"
        ? "Certified ✓"
        : decision === "reject"
        ? "Rejected"
        : `Phase: ${newPhase}`;
      toast.info(`Portal Update — ${orgName}`, {
        description: `Status changed to: ${phaseLabel}`,
        duration: 8000,
      });
    } else if (event.type === "penalty_issued") {
      const { orgName, penaltyId, amountUsd } = event.payload;
      toast.warning(`Penalty Issued — ${orgName}`, {
        description: `Penalty #${penaltyId}: $${amountUsd.toLocaleString()} USD`,
        duration: 10000,
      });
    } else if (event.type === "appeal_update") {
      const { appealId, decision, penaltyId } = event.payload;
      const decisionLabel = decision === "upheld" ? "Upheld" : decision === "dismissed" ? "Dismissed" : "Under Review";
      toast.info(`Appeal #${appealId} — ${decisionLabel}`, {
        description: `Penalty #${penaltyId} appeal decision: ${decisionLabel}`,
        duration: 8000,
      });
    }
  }, []);
  const { connected: wsConnected } = useNdsepSocket({
    rooms: ["org_portal"],
    onEvent: handleSocketEvent,
  });

  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [submissionToken, setSubmissionToken] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [orgDetails, setOrgDetails] = useState({
    orgName: "", orgSector: "", orgCountry: "", regulatoryId: "",
    contactName: "", contactEmail: "", contactPhone: "",
  });

  const [assets, setAssets] = useState<Array<{ type: string; name: string; count: number; location: string }>>([
    { type: "database", name: "", count: 1, location: "" },
  ]);

  const [datasets, setDatasets] = useState<Array<{
    name: string; classification: string; storageLocation: string;
    containsPii: boolean; crossBorder: boolean; recordCount: string;
  }>>([
    { name: "", classification: "tier2_financial", storageLocation: "", containsPii: false, crossBorder: false, recordCount: "" },
  ]);

  const [assessmentAnswers, setAssessmentAnswers] = useState<Record<string, boolean>>({});

  const registerMutation = trpc.portal.register.useMutation({
    onSuccess: (data: { submissionToken: string }) => {
      setSubmissionToken(data.submissionToken);
      setSubmitted(true);
      toast.success("Submission received", { description: `Reference: ${data.submissionToken}` });
    },
    onError: (err: { message: string }) => {
      toast.error("Submission failed", { description: err.message });
    },
  });

  const selfAssessmentScore = Math.round(
    SELF_ASSESSMENT_QUESTIONS.reduce((acc, q) => acc + (assessmentAnswers[q.id] ? q.weight : 0), 0)
  );

  const canProceed = () => {
    if (step === 1) {
      return orgDetails.orgName && orgDetails.orgSector && orgDetails.orgCountry &&
        orgDetails.contactName && orgDetails.contactEmail;
    }
    if (step === 2) return assets.every(a => a.name && a.type);
    if (step === 3) return datasets.every(d => d.name && d.storageLocation);
    return true;
  };

  const handleSubmit = () => {
    registerMutation.mutate({
      orgName: orgDetails.orgName,
      orgSector: orgDetails.orgSector,
      orgCountry: orgDetails.orgCountry,
      regulatoryId: orgDetails.regulatoryId,
      contactName: orgDetails.contactName,
      contactEmail: orgDetails.contactEmail,
      contactPhone: orgDetails.contactPhone,
      assets,
      datasets,
      selfAssessmentScore,
      assessmentAnswers,
    });
  };

  // ── Appeal form state ──────────────────────────────────────────────────────
  const [portalView, setPortalView] = useState<"register" | "appeal" | "pay" | "audit">("register");
  // ── Request Audit form state ──────────────────────────────────────────────
  const [auditForm, setAuditForm] = useState({ orgName: "", contactEmail: "", contactName: "", orgSector: "", orgCountry: "", reason: "" });
  const [auditSubmitted, setAuditSubmitted] = useState(false);
  const requestAuditMutation = trpc.portal.requestAudit.useMutation({
    onSuccess: () => { setAuditSubmitted(true); toast.success("Audit request submitted", { description: "Our compliance team will contact you within 5 business days to schedule your audit." }); },
    onError: (e: { message: string }) => toast.error("Submission failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });
  // ── Payment form state ────────────────────────────────────────────────────
  const [payForm, setPayForm] = useState({ penaltyId: "", orgId: "", paymentMethod: "bank_transfer" as "bank_transfer" | "card" | "ussd" | "crypto" | "other", paymentRef: "", contactEmail: "" });
  const [paySubmitted, setPaySubmitted] = useState(false);
  const payPenaltyMutation = trpc.financial.payPenalty.useMutation({
    onSuccess: () => { setPaySubmitted(true); toast.success("Payment submitted", { description: "Your payment reference has been logged. Status will update to \"processing\" within 24 hours." }); },
    onError: (e: { message: string }) => toast.error("Payment failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const [appealForm, setAppealForm] = useState({
    penaltyId: "", organizationId: "", submittedBy: "", contactEmail: "",
    groundsForAppeal: "", evidenceSummary: "", requestedOutcome: "reduction" as "full_waiver" | "reduction" | "payment_plan" | "extension",
  });
  const [appealSubmitted, setAppealSubmitted] = useState(false);
  const submitAppealMutation = trpc.portal.submitAppeal.useMutation({
    onSuccess: () => { setAppealSubmitted(true); toast.success("Appeal submitted", { description: "Your appeal has been logged and will be reviewed within 10 business days." }); },
    onError: (e: { message: string }) => toast.error("Appeal failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  if (submitted && submissionToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Org Portal" }]} className="mb-4" />
        <Card className="max-w-lg w-full border-primary/30 bg-card/80">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-6 text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Award className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Submission Received</h2>
              <p className="text-muted-foreground text-sm">
                Your organization has been registered for compliance audit. A government auditor will be assigned within 3 business days.
              </p>
            </div>
            <div className="w-full bg-muted/30 rounded-lg p-4 text-left">
              <p className="text-xs text-muted-foreground mono mb-1">REFERENCE TOKEN</p>
              <p className="font-mono text-sm font-bold text-primary break-all">{submissionToken}</p>
              <p className="text-xs text-muted-foreground mt-2">Save this token to track your onboarding status.</p>
              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs flex-1"
                  onClick={() => {
                    const url = `${window.location.origin}/status/${submissionToken}`;
                    navigator.clipboard.writeText(url).then(() => toast.success("Status link copied!"));
                  }}
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Copy Status Link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  onClick={() => window.open(`/status/${submissionToken}`, "_blank")}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open Tracker
                </Button>
              </div>
            </div>
            <div className="w-full space-y-2">
              {["Registration confirmed", "Asset inventory queued for DPI scan", "Data catalog submitted to Egeria", "Self-assessment score: " + selfAssessmentScore + "/100", "Auditor assignment: pending"].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full" onClick={() => { setSubmitted(false); setStep(1); setSubmissionToken(null); }}>
              Submit Another Organization
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Payment view ────────────────────────────────────────────────────
  if (portalView === "pay") {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"><ReceiptText className="h-4 w-4 text-primary" /></div>
              <div><span className="font-bold text-sm text-foreground">NDSEP</span><span className="text-xs text-muted-foreground ml-2">Penalty Payment Portal</span></div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPortalView("register")}>Back to Registration</Button>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          {paySubmitted ? (
            <Card className="border-primary/30">
              <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center"><CheckCircle2 className="h-7 w-7 text-primary" /></div>
                <h2 className="text-xl font-bold">Payment Reference Submitted</h2>
                <p className="text-muted-foreground text-sm">Your payment reference has been logged in the NDSEP TigerBeetle ledger. Status will update to \"processing\" within 24 hours. A confirmation email will be sent if provided.</p>
                <Button variant="outline" onClick={() => { setPaySubmitted(false); setPayForm({ penaltyId: "", orgId: "", paymentMethod: "bank_transfer", paymentRef: "", contactEmail: "" }); }}>Submit Another Payment</Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-primary" /> Pay a Compliance Penalty</CardTitle>
                <CardDescription>Submit your payment reference to update your penalty status. Accepted methods: bank transfer, card, USSD, and crypto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Penalty ID <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. 1042" value={payForm.penaltyId} onChange={e => setPayForm(f => ({ ...f, penaltyId: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Organization ID <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. 7" value={payForm.orgId} onChange={e => setPayForm(f => ({ ...f, orgId: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Payment Method <span className="text-destructive">*</span></Label>
                  <Select value={payForm.paymentMethod} onValueChange={v => setPayForm(f => ({ ...f, paymentMethod: v as typeof f.paymentMethod }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer (NEFT/RTGS)</SelectItem>
                      <SelectItem value="card">Debit / Credit Card</SelectItem>
                      <SelectItem value="ussd">USSD (*966#)</SelectItem>
                      <SelectItem value="crypto">Cryptocurrency</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Payment Reference / Transaction ID <span className="text-destructive">*</span></Label>
                  <Input placeholder="e.g. TXN-2026-XXXXXXXX" value={payForm.paymentRef} onChange={e => setPayForm(f => ({ ...f, paymentRef: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact Email (for confirmation)</Label>
                  <Input type="email" placeholder="finance@company.ng" value={payForm.contactEmail} onChange={e => setPayForm(f => ({ ...f, contactEmail: e.target.value }))} />
                </div>
                <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground">
                  Payment references are verified against the NDSEP TigerBeetle double-entry ledger. Fraudulent references will result in escalated enforcement action under Section 52 of the National Data Sovereignty Act.
                </div>
                <Button className="w-full" disabled={payPenaltyMutation.isPending || !payForm.penaltyId || !payForm.orgId || payForm.paymentRef.length < 4}
                  onClick={() => payPenaltyMutation.mutate({ penaltyId: parseInt(payForm.penaltyId), orgId: parseInt(payForm.orgId), paymentMethod: payForm.paymentMethod, paymentRef: payForm.paymentRef, contactEmail: payForm.contactEmail || undefined })}>
                  {payPenaltyMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</> : <><ReceiptText className="h-4 w-4 mr-1" /> Submit Payment Reference</>}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // ── Appeal view ────────────────────────────────────────────────────
  if (portalView === "appeal") {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"><Scale className="h-4 w-4 text-primary" /></div>
              <div><span className="font-bold text-sm text-foreground">NDSEP</span><span className="text-xs text-muted-foreground ml-2">Penalty Appeal Portal</span></div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPortalView("register")}>Back to Registration</Button>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          {appealSubmitted ? (
            <Card className="border-primary/30">
              <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center"><CheckCircle2 className="h-7 w-7 text-primary" /></div>
                <h2 className="text-xl font-bold">Appeal Submitted</h2>
                <p className="text-muted-foreground text-sm">Your appeal has been logged in the NDSEP dispute management system. A senior auditor will review your case within 10 business days. You will receive updates at the email address provided.</p>
                <Button variant="outline" onClick={() => { setAppealSubmitted(false); setAppealForm({ penaltyId: "", organizationId: "", submittedBy: "", contactEmail: "", groundsForAppeal: "", evidenceSummary: "", requestedOutcome: "reduction" }); }}>Submit Another Appeal</Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> Submit Penalty Appeal</CardTitle>
                <CardDescription>Contest a compliance penalty issued by NDSEP. Provide your penalty reference, grounds for appeal, and any supporting evidence.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Penalty ID <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. 1042" value={appealForm.penaltyId} onChange={e => setAppealForm(f => ({ ...f, penaltyId: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Organization ID <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. 7" value={appealForm.organizationId} onChange={e => setAppealForm(f => ({ ...f, organizationId: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Your Full Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="Legal representative" value={appealForm.submittedBy} onChange={e => setAppealForm(f => ({ ...f, submittedBy: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact Email <span className="text-destructive">*</span></Label>
                    <Input type="email" placeholder="legal@company.ng" value={appealForm.contactEmail} onChange={e => setAppealForm(f => ({ ...f, contactEmail: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Requested Outcome</Label>
                  <Select value={appealForm.requestedOutcome} onValueChange={v => setAppealForm(f => ({ ...f, requestedOutcome: v as typeof f.requestedOutcome }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_waiver">Full Waiver</SelectItem>
                      <SelectItem value="reduction">Penalty Reduction</SelectItem>
                      <SelectItem value="payment_plan">Payment Plan</SelectItem>
                      <SelectItem value="extension">Deadline Extension</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Grounds for Appeal <span className="text-destructive">*</span></Label>
                  <Textarea rows={4} placeholder="Describe why this penalty should be reconsidered. Include relevant facts, timeline, and regulatory context (minimum 20 characters)." value={appealForm.groundsForAppeal} onChange={e => setAppealForm(f => ({ ...f, groundsForAppeal: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Evidence Summary</Label>
                  <Textarea rows={3} placeholder="Summarize supporting evidence (audit reports, remediation records, third-party assessments)." value={appealForm.evidenceSummary} onChange={e => setAppealForm(f => ({ ...f, evidenceSummary: e.target.value }))} />
                </div>
                <div className="p-3 rounded-lg bg-muted/20 border border-border/40 text-xs text-muted-foreground">
                  Submitting a false or frivolous appeal may result in additional penalties under Section 47 of the National Data Sovereignty Act. All appeals are logged and auditable.
                </div>
                <Button className="w-full" disabled={submitAppealMutation.isPending || !appealForm.penaltyId || !appealForm.organizationId || !appealForm.submittedBy || !appealForm.contactEmail || appealForm.groundsForAppeal.length < 20}
                  onClick={() => submitAppealMutation.mutate({ penaltyId: parseInt(appealForm.penaltyId), organizationId: parseInt(appealForm.organizationId), submittedBy: appealForm.submittedBy, contactEmail: appealForm.contactEmail, groundsForAppeal: appealForm.groundsForAppeal, evidenceSummary: appealForm.evidenceSummary || undefined, requestedOutcome: appealForm.requestedOutcome })}>
                  {submitAppealMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</> : <><ReceiptText className="h-4 w-4 mr-1" /> Submit Appeal</>}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // ── Request Audit view ──────────────────────────────────────────────
  if (portalView === "audit") {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"><Shield className="h-4 w-4 text-primary" /></div>
              <div><span className="font-bold text-sm text-foreground">NDSEP</span><span className="text-xs text-muted-foreground ml-2">Request Compliance Audit</span></div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPortalView("register")}>Back to Registration</Button>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          {auditSubmitted ? (
            <Card className="border-primary/30">
              <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center"><CheckCircle2 className="h-7 w-7 text-primary" /></div>
                <h2 className="text-xl font-bold">Audit Request Submitted</h2>
                <p className="text-muted-foreground text-sm">Your compliance audit request has been received. A senior NDSEP auditor will contact you within 5 business days to schedule your assessment. You will receive a confirmation email shortly.</p>
                <Button variant="outline" onClick={() => { setAuditSubmitted(false); setAuditForm({ orgName: "", contactEmail: "", contactName: "", orgSector: "", orgCountry: "", reason: "" }); }}>Submit Another Request</Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Request Compliance Audit</CardTitle>
                <CardDescription>Submit a request for a compliance audit or re-audit. Use this form after completing remediation actions or when you need a fresh compliance assessment.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Organisation Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. Zenith Bank Plc" value={auditForm.orgName} onChange={e => setAuditForm(f => ({ ...f, orgName: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Sector <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. Financial Services" value={auditForm.orgSector} onChange={e => setAuditForm(f => ({ ...f, orgSector: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Contact Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="Full name" value={auditForm.contactName} onChange={e => setAuditForm(f => ({ ...f, contactName: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact Email <span className="text-destructive">*</span></Label>
                    <Input type="email" placeholder="compliance@org.ng" value={auditForm.contactEmail} onChange={e => setAuditForm(f => ({ ...f, contactEmail: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Country <span className="text-destructive">*</span></Label>
                  <Input placeholder="e.g. Nigeria" value={auditForm.orgCountry} onChange={e => setAuditForm(f => ({ ...f, orgCountry: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Reason for Audit Request <span className="text-destructive">*</span></Label>
                  <Textarea placeholder="Describe why you are requesting this audit (e.g. post-remediation re-assessment, new data processing activities, regulatory requirement)..." rows={4} value={auditForm.reason} onChange={e => setAuditForm(f => ({ ...f, reason: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">{auditForm.reason.length}/500 characters (minimum 10)</p>
                </div>
                <Button className="w-full" disabled={requestAuditMutation.isPending || !auditForm.orgName || !auditForm.contactEmail || !auditForm.contactName || !auditForm.orgSector || !auditForm.orgCountry || auditForm.reason.length < 10}
                  onClick={() => requestAuditMutation.mutate({ orgName: auditForm.orgName, contactEmail: auditForm.contactEmail, contactName: auditForm.contactName, orgSector: auditForm.orgSector, orgCountry: auditForm.orgCountry, reason: auditForm.reason })}>
                  {requestAuditMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</> : <><Shield className="h-4 w-4 mr-1" /> Submit Audit Request</>}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span className="font-bold text-sm text-foreground">NDSEP</span>
              <span className="text-xs text-muted-foreground ml-2">Organization Compliance Portal</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPortalView("pay")} className="text-xs">
              <ReceiptText className="h-3.5 w-3.5 mr-1" /> Pay a Penalty
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPortalView("appeal")} className="text-xs">
              <Scale className="h-3.5 w-3.5 mr-1" /> Appeal a Penalty
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPortalView("audit")} className="text-xs">
              <Shield className="h-3.5 w-3.5 mr-1" /> Request Audit
            </Button>
            <Link href="/engage-dpco">
              <Button size="sm" className="text-xs bg-cyan-600 hover:bg-cyan-500 text-white">
                <Shield className="h-3.5 w-3.5 mr-1" /> Engage a DPCO
              </Button>
            </Link>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-muted-foreground/40"}`} />
              <span className="text-xs text-muted-foreground mono hidden sm:inline">{wsConnected ? "Live" : "Offline"}</span>
            </div>
            <Badge variant="outline" className="text-xs mono">PUBLIC ACCESS</Badge>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Organization Compliance Registration</h1>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Register your organization for national data sovereignty compliance audit. This portal accepts submissions from banks, telecoms, healthcare providers, government agencies, fintechs, and energy companies.
          </p>
        </div>

        {/* Sector cards */}
        {step === 1 && !orgDetails.orgSector && (
          <div className="mb-8">
            <p className="text-sm font-medium text-muted-foreground mb-3 text-center">Select your organization type to begin</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {SECTORS.map(s => (
                <button
                  key={s.value}
                  onClick={() => setOrgDetails(d => ({ ...d, orgSector: s.value }))}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-center group"
                >
                  <span className="text-2xl">{s.icon}</span>
                  <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Progress steps */}
        <div className="flex items-center justify-between mb-8 overflow-x-auto pb-2">
          {PHASES.map((phase, idx) => {
            const isActive = step === phase.id;
            const isDone = step > phase.id;
            return (
              <div key={phase.id} className="flex items-center min-w-0">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${isActive ? "bg-primary/10 border border-primary/30" : isDone ? "opacity-60" : "opacity-40"}`}>
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${isActive ? "bg-primary text-primary-foreground" : isDone ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : <phase.icon className="h-3.5 w-3.5" />}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${isActive ? "text-primary" : "text-muted-foreground"}`}>{phase.label}</span>
                </div>
                {idx < PHASES.length - 1 && <div className="h-px w-4 bg-border mx-1 shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {(() => { const P = PHASES[step - 1]; return <P.icon className="h-5 w-5 text-primary" />; })()}
              {PHASES[step - 1].label}
            </CardTitle>
            <CardDescription>{PHASES[step - 1].description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Step 1: Organization Details */}
            {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label htmlFor="orgName">Organization Name *</Label>
                  <Input id="orgName" placeholder="e.g. First National Bank of Nigeria" value={orgDetails.orgName}
                    onChange={e => setOrgDetails(d => ({ ...d, orgName: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Sector *</Label>
                  <Select value={orgDetails.orgSector} onValueChange={v => setOrgDetails(d => ({ ...d, orgSector: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select sector" /></SelectTrigger>
                    <SelectContent>
                      {SECTORS.map(s => <SelectItem key={s.value} value={s.value}>{s.icon} {s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Country of Operation *</Label>
                  <Select value={orgDetails.orgCountry} onValueChange={v => setOrgDetails(d => ({ ...d, orgCountry: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select country" /></SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="regulatoryId" className="flex items-center gap-1"><Hash className="h-3 w-3" /> Regulatory / License ID</Label>
                  <Input id="regulatoryId" placeholder="e.g. CBN/FIN/2024/001" value={orgDetails.regulatoryId}
                    onChange={e => setOrgDetails(d => ({ ...d, regulatoryId: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="contactName" className="flex items-center gap-1"><Building2 className="h-3 w-3" /> Compliance Officer Name *</Label>
                  <Input id="contactName" placeholder="Full name" value={orgDetails.contactName}
                    onChange={e => setOrgDetails(d => ({ ...d, contactName: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="contactEmail" className="flex items-center gap-1"><Mail className="h-3 w-3" /> Email Address *</Label>
                  <Input id="contactEmail" type="email" placeholder="compliance@organization.com" value={orgDetails.contactEmail}
                    onChange={e => setOrgDetails(d => ({ ...d, contactEmail: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="contactPhone" className="flex items-center gap-1"><Phone className="h-3 w-3" /> Phone Number</Label>
                  <Input id="contactPhone" placeholder="+234 800 000 0000" value={orgDetails.contactPhone}
                    onChange={e => setOrgDetails(d => ({ ...d, contactPhone: e.target.value }))} className="mt-1" />
                </div>
              </div>
            )}

            {/* Step 2: Asset Inventory */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Declare all IT assets under your organization's control.</p>
                  <Button size="sm" variant="outline" onClick={() => setAssets(a => [...a, { type: "hardware", name: "", count: 1, location: "" }])}>
                    + Add Asset
                  </Button>
                </div>
                {assets.map((asset, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 rounded-lg border border-border/50 bg-muted/20">
                    <div>
                      <Label className="text-xs">Asset Type *</Label>
                      <Select value={asset.type} onValueChange={v => setAssets(a => a.map((x, i) => i === idx ? { ...x, type: v } : x))}>
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ASSET_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Asset Name / Description *</Label>
                      <Input className="mt-1 h-8 text-xs" placeholder="e.g. Core Banking System" value={asset.name}
                        onChange={e => setAssets(a => a.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                    </div>
                    <div>
                      <Label className="text-xs">Count</Label>
                      <Input className="mt-1 h-8 text-xs" type="number" min={1} value={asset.count}
                        onChange={e => setAssets(a => a.map((x, i) => i === idx ? { ...x, count: parseInt(e.target.value) || 1 } : x))} />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Label className="text-xs">Data Centre / Location</Label>
                        <Input className="mt-1 h-8 text-xs" placeholder="Lagos DC-1" value={asset.location}
                          onChange={e => setAssets(a => a.map((x, i) => i === idx ? { ...x, location: e.target.value } : x))} />
                      </div>
                      {assets.length > 1 && (
                        <button onClick={() => setAssets(a => a.filter((_, i) => i !== idx))}
                          className="mt-5 text-destructive hover:text-destructive/80 text-xs">✕</button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <Upload className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">Bulk upload via CSV</p>
                    <p className="text-xs text-muted-foreground">Format: type, name, count, location</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const lines = (ev.target?.result as string).split('\n').filter(Boolean).slice(1);
                        const parsed = lines.map(l => {
                          const [type, name, count, location] = l.split(',').map(s => s.trim());
                          return { type: type || 'hardware', name: name || '', count: parseInt(count) || 1, location: location || '' };
                        }).filter(a => a.name);
                        if (parsed.length) setAssets(parsed);
                      };
                      reader.readAsText(file);
                    }} />
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => fileInputRef.current?.click()}>
                    Upload CSV
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Data Catalog */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Declare all datasets your organization stores or processes.</p>
                  <Button size="sm" variant="outline" onClick={() => setDatasets(d => [...d, { name: "", classification: "tier2_financial", storageLocation: "", containsPii: false, crossBorder: false, recordCount: "" }])}>
                    + Add Dataset
                  </Button>
                </div>
                {datasets.map((ds, idx) => (
                  <div key={idx} className="p-4 rounded-lg border border-border/50 bg-muted/20 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Dataset Name *</Label>
                        <Input className="mt-1 h-8 text-xs" placeholder="e.g. Customer KYC Records" value={ds.name}
                          onChange={e => setDatasets(d => d.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                      </div>
                      <div>
                        <Label className="text-xs">Classification *</Label>
                        <Select value={ds.classification} onValueChange={v => setDatasets(d => d.map((x, i) => i === idx ? { ...x, classification: v } : x))}>
                          <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tier1_pii">Tier 1 — PII</SelectItem>
                            <SelectItem value="tier2_financial">Tier 2 — Financial</SelectItem>
                            <SelectItem value="tier3_health">Tier 3 — Health</SelectItem>
                            <SelectItem value="tier4_government">Tier 4 — Government</SelectItem>
                            <SelectItem value="tier5_public">Tier 5 — Public</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Storage Location *</Label>
                        <Input className="mt-1 h-8 text-xs" placeholder="e.g. s3://ndsep-bank/kyc/" value={ds.storageLocation}
                          onChange={e => setDatasets(d => d.map((x, i) => i === idx ? { ...x, storageLocation: e.target.value } : x))} />
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={ds.containsPii} className="rounded"
                          onChange={e => setDatasets(d => d.map((x, i) => i === idx ? { ...x, containsPii: e.target.checked } : x))} />
                        <span className="text-xs text-muted-foreground">Contains PII</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={ds.crossBorder} className="rounded"
                          onChange={e => setDatasets(d => d.map((x, i) => i === idx ? { ...x, crossBorder: e.target.checked } : x))} />
                        <span className="text-xs text-muted-foreground">Cross-border transfer</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Records:</Label>
                        <Input className="h-7 w-28 text-xs" placeholder="e.g. 2.4M" value={ds.recordCount}
                          onChange={e => setDatasets(d => d.map((x, i) => i === idx ? { ...x, recordCount: e.target.value } : x))} />
                      </div>
                      {datasets.length > 1 && (
                        <button onClick={() => setDatasets(d => d.filter((_, i) => i !== idx))}
                          className="ml-auto text-destructive hover:text-destructive/80 text-xs">Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Step 4: Self-Assessment */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div>
                    <p className="text-sm font-medium text-foreground">Self-Assessment Score</p>
                    <p className="text-xs text-muted-foreground">Answer all questions honestly — auditors will verify</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-3xl font-bold ${selfAssessmentScore >= 80 ? "text-primary" : selfAssessmentScore >= 60 ? "text-yellow-500" : "text-destructive"}`}>
                      {selfAssessmentScore}
                    </span>
                    <span className="text-muted-foreground text-sm">/100</span>
                  </div>
                </div>
                {["Data Residency", "Access Control", "Encryption", "Audit", "Incident Response"].map(cat => (
                  <div key={cat}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{cat}</p>
                    <div className="space-y-2">
                      {SELF_ASSESSMENT_QUESTIONS.filter(q => q.category === cat).map(q => (
                        <div key={q.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/40 hover:bg-muted/20 transition-colors">
                          <input type="checkbox" id={q.id} checked={!!assessmentAnswers[q.id]}
                            onChange={e => setAssessmentAnswers(a => ({ ...a, [q.id]: e.target.checked }))}
                            className="mt-0.5 rounded" />
                          <label htmlFor={q.id} className="flex-1 text-sm text-foreground cursor-pointer">{q.question}</label>
                          <Badge variant="outline" className="text-xs shrink-0">{q.weight}pts</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Step 5: Review & Submit */}
            {step === 5 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Card className="border-border/40 bg-muted/10">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Organization</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-1">
                      <p className="text-sm font-medium">{orgDetails.orgName}</p>
                      <p className="text-xs text-muted-foreground">{SECTORS.find(s => s.value === orgDetails.orgSector)?.label} · {orgDetails.orgCountry}</p>
                      <p className="text-xs text-muted-foreground">{orgDetails.contactEmail}</p>
                      {orgDetails.regulatoryId && <p className="text-xs mono text-muted-foreground">{orgDetails.regulatoryId}</p>}
                    </CardContent>
                  </Card>
                  <Card className="border-border/40 bg-muted/10">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" /> Assessment Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-1">
                      <p className="text-sm font-medium">{assets.length} asset groups declared</p>
                      <p className="text-xs text-muted-foreground">{assets.reduce((a, x) => a + x.count, 0)} total assets</p>
                      <p className="text-sm font-medium">{datasets.length} datasets declared</p>
                      <p className="text-xs text-muted-foreground">{datasets.filter(d => d.containsPii).length} contain PII · {datasets.filter(d => d.crossBorder).length} cross-border</p>
                    </CardContent>
                  </Card>
                </div>
                <div className="p-4 rounded-lg bg-muted/20 border border-border/40">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Self-Assessment Score</p>
                    <span className={`text-xl font-bold ${selfAssessmentScore >= 80 ? "text-primary" : selfAssessmentScore >= 60 ? "text-yellow-500" : "text-destructive"}`}>
                      {selfAssessmentScore}/100
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${selfAssessmentScore >= 80 ? "bg-primary" : selfAssessmentScore >= 60 ? "bg-yellow-500" : "bg-destructive"}`}
                      style={{ width: `${selfAssessmentScore}%` }} />
                  </div>
                  {selfAssessmentScore < 60 && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-yellow-600">
                      <AlertCircle className="h-3 w-3" /> Score below 60 — remediation will be required before certification.
                    </div>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
                  By submitting, you confirm that all information provided is accurate and that your organization consents to a compliance audit under the National Data Sovereignty Act. Providing false information is a criminal offence.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6">
          <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={step === 1}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {step < 5 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canProceed()}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={registerMutation.isPending}>
              {registerMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</> : <><FileText className="h-4 w-4 mr-1" /> Submit for Audit</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
