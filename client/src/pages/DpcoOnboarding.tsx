/**
 * DPCO Onboarding — unified registration + accreditation flow (Round-12 W3)
 * =========================================================================
 * ONE onboarding flow replacing the three previously divergent pages:
 *   - DpcoRegister (public self-registration, dpco.registerOrganisation)
 *   - DpcoApply    (accreditation application, accreditation.submitApplication)
 *   - DpcoOnboard  (authenticated org upsert, dpco.upsertOrganisation)
 *
 * The wizard drives the correct sequence of EXISTING mutations:
 *   1. dpco.registerOrganisation      — creates the DPCO organisation record
 *                                       and issues a provisional licence
 *   2. accreditation.submitApplication — files the NDPA s.33 accreditation
 *                                       application linked via
 *                                       existingDpcoOrgId
 *
 * The old route components (DpcoRegister / DpcoApply / DpcoOnboard) are thin
 * re-exports of this page so existing routes keep working.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { OrgIdentityPrefill } from "@/components/OrgIdentityPrefill";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Shield,
  FileText,
  Users,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba",
  "Yobe","Zamfara",
];

const DPCO_SERVICES = [
  { id: "compliance_audit", label: "Compliance Audit" },
  { id: "dpia_assessment", label: "DPIA Assessment" },
  { id: "training_session", label: "Staff Training" },
  { id: "policy_drafting", label: "Policy & Contract Drafting" },
  { id: "dpo_retainer", label: "DPO Retainer Service" },
  { id: "breach_support", label: "Breach Incident Support" },
  { id: "due_diligence", label: "Due Diligence Assessment" },
];

const SECTORS = [
  "Banking & Finance", "Telecommunications", "Healthcare", "Insurance",
  "Fintech", "Government & Public Sector", "Education", "Energy & Utilities",
  "Retail & E-commerce", "Technology", "Media & Entertainment", "Logistics",
];

const CERTIFICATIONS = ["CIPP/E", "CIPP/A", "CIPM", "CDPSE", "CISA", "ISO 27001 Lead Auditor", "NDPC Certified DPO"];

const STEPS = [
  { id: 1, label: "Organisation", icon: Building2 },
  { id: 2, label: "Services & Contact", icon: Users },
  { id: 3, label: "Accreditation", icon: Shield },
  { id: 4, label: "Evidence & Declaration", icon: FileText },
  { id: 5, label: "Confirmation", icon: CheckCircle2 },
];

interface Auditor {
  name: string;
  email: string;
  certifications: string[];
}

interface OnboardingForm {
  // Step 1 — organisation details (prefillable from the registries)
  name: string;
  organisationType: "private" | "public" | "ngo" | "academic" | "government";
  registrationNumber: string; // CAC RC/BN number — feeds cacNumber + rcNumber
  taxId: string;
  email: string;
  phone: string;
  website: string;
  state: string;
  address: string;
  // Step 2 — services & primary contact (registerOrganisation)
  services: string[];
  staffCount: string;
  contactPersonName: string;
  contactPersonRole: string;
  // Step 3 — accreditation (submitApplication)
  auditors: Auditor[];
  sectors: string[];
  // Step 4 — evidence & declaration
  incorporationDocUrl: string;
  financialStatementsUrl: string;
  indemnityInsuranceUrl: string;
  auditMethodologyUrl: string;
  accuracyDeclaration: boolean;
  conflictDeclaration: boolean;
}

const INITIAL_FORM: OnboardingForm = {
  name: "",
  organisationType: "private",
  registrationNumber: "",
  taxId: "",
  email: "",
  phone: "",
  website: "",
  state: "",
  address: "",
  services: [],
  staffCount: "",
  contactPersonName: "",
  contactPersonRole: "",
  auditors: [{ name: "", email: "", certifications: [] }],
  sectors: [],
  incorporationDocUrl: "",
  financialStatementsUrl: "",
  indemnityInsuranceUrl: "",
  auditMethodologyUrl: "",
  accuracyDeclaration: false,
  conflictDeclaration: false,
};

export default function DpcoOnboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    provisionalLicence: string | null;
    referenceToken: string | null;
    alreadyRegistered: boolean;
  } | null>(null);

  const registerMutation = trpc.dpco.registerOrganisation.useMutation();
  const accreditMutation = trpc.accreditation.submitApplication.useMutation();

  const set = <K extends keyof OnboardingForm>(field: K, value: OnboardingForm[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const toggleIn = (field: "services" | "sectors", v: string) =>
    setForm((f) => ({
      ...f,
      [field]: (f[field] as string[]).includes(v)
        ? (f[field] as string[]).filter((x) => x !== v)
        : [...(f[field] as string[]), v],
    }));

  const updateAuditor = (i: number, patch: Partial<Auditor>) =>
    setForm((f) => ({ ...f, auditors: f.auditors.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) }));

  const toggleCert = (i: number, cert: string) => {
    const a = form.auditors[i];
    updateAuditor(i, {
      certifications: a.certifications.includes(cert)
        ? a.certifications.filter((c) => c !== cert)
        : [...a.certifications, cert],
    });
  };

  const validateStep = (): boolean => {
    if (step === 1) {
      if (!form.name.trim()) { toast.error("Organisation name is required"); return false; }
      if (!form.registrationNumber.trim()) { toast.error("CAC RC/BN registration number is required"); return false; }
      if (!form.email.trim() || !form.email.includes("@")) { toast.error("A valid email is required"); return false; }
      if (!form.phone.trim()) { toast.error("Phone number is required"); return false; }
      if (!form.state) { toast.error("State is required"); return false; }
      if (form.address.trim().length < 5) { toast.error("Registered address is required"); return false; }
    }
    if (step === 2) {
      if (form.services.length === 0) { toast.error("Select at least one service"); return false; }
      if (!form.contactPersonName.trim()) { toast.error("Contact person name is required"); return false; }
      if (!form.contactPersonRole.trim()) { toast.error("Contact person role is required"); return false; }
    }
    if (step === 3) {
      if (form.sectors.length === 0) { toast.error("Select at least one sector specialisation"); return false; }
      if (!form.auditors.every((a) => a.name.trim() && a.email.trim() && a.certifications.length > 0)) {
        toast.error("Every lead auditor needs a name, email, and at least one certification");
        return false;
      }
    }
    if (step === 4) {
      if (!form.accuracyDeclaration || !form.conflictDeclaration) {
        toast.error("Both declarations must be accepted before submission");
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    let organisationId: number | undefined;
    let provisionalLicence: string | null = null;
    let alreadyRegistered = false;
    try {
      // ── Step A: organisation registration (provisional licence) ──────────
      try {
        const reg = await registerMutation.mutateAsync({
          name: form.name.trim(),
          organisationType: form.organisationType,
          email: form.email.trim(),
          phone: form.phone.trim(),
          website: form.website.trim() || undefined,
          state: form.state,
          address: form.address.trim(),
          cacNumber: form.registrationNumber.trim(),
          services: form.services,
          staffCount: form.staffCount ? parseInt(form.staffCount, 10) : undefined,
          contactPersonName: form.contactPersonName.trim(),
          contactPersonRole: form.contactPersonRole.trim(),
          declarationAccepted: true,
        });
        organisationId = reg.organisationId;
        provisionalLicence = reg.provisionalLicence;
      } catch (err: any) {
        // CONFLICT = the organisation is already registered (same email/CAC).
        // That is not fatal here: continue with the accreditation application
        // so re-entry through the unified flow still lands in the same place.
        if (err?.data?.code === "CONFLICT") {
          alreadyRegistered = true;
          toast.info("Organisation already registered — continuing with the accreditation application.");
        } else {
          throw err;
        }
      }

      // ── Step B: NDPA s.33 accreditation application ─────────────────────
      const app = await accreditMutation.mutateAsync({
        orgName: form.name.trim(),
        rcNumber: form.registrationNumber.trim(),
        cacNumber: form.registrationNumber.trim(),
        taxId: form.taxId.trim() || undefined,
        address: form.address.trim(),
        website: form.website.trim() || undefined,
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        leadAuditors: form.auditors.map((a) => ({
          name: a.name.trim(),
          email: a.email.trim(),
          certifications: a.certifications,
        })),
        sectors: form.sectors,
        incorporationDocUrl: form.incorporationDocUrl.trim() || undefined,
        financialStatementsUrl: form.financialStatementsUrl.trim() || undefined,
        indemnityInsuranceUrl: form.indemnityInsuranceUrl.trim() || undefined,
        auditMethodologyUrl: form.auditMethodologyUrl.trim() || undefined,
        conflictDeclaration: form.conflictDeclaration,
        applicationType: "new",
        existingDpcoOrgId: organisationId,
      });
      setResult({ provisionalLicence, referenceToken: app.referenceToken, alreadyRegistered });
      setStep(5);
    } catch (err: any) {
      toast.error(err?.message ?? "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!validateStep()) return;
    if (step === 4) handleSubmit();
    else setStep((s) => s + 1);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-cyan-900/40 bg-background/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <Shield className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs text-cyan-400 font-mono uppercase tracking-widest">NDPC / NDSEP</p>
              <p className="text-sm font-semibold text-foreground">DPCO Onboarding — Registration &amp; Accreditation</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate("/")}>
            ← Back to Platform
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-foreground mb-2">Data Protection Compliance Organisation</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            One flow: register your organisation, then file the NDPA 2023 §33 accreditation application —
            no duplicate data entry. Organisation identity can be pre-filled from the NDPC registries.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-10 flex-wrap">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = step === s.id;
            const isDone = step > s.id;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? "bg-cyan-500/20 border border-cyan-500/60 text-cyan-300"
                      : isDone
                      ? "bg-green-500/20 border border-green-500/40 text-green-400"
                      : "bg-card/60 border border-border text-muted-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              </div>
            );
          })}
        </div>

        <div className="bg-background border border-border/50 rounded-xl p-8">
          {/* Step 1: Organisation details */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
                <Building2 className="w-5 h-5" /> Organisation Details
              </h2>
              <OrgIdentityPrefill
                idPrefix="dpco-onboard"
                onResolved={(id) => {
                  setForm((f) => ({
                    ...f,
                    name: f.name || id.name || "",
                    registrationNumber: f.registrationNumber || id.cacNumber || id.rcNumber || id.registrationRef || "",
                    taxId: f.taxId || id.taxId || "",
                    address: f.address || id.address || "",
                    state: f.state || id.state || "",
                    email: f.email || id.email || "",
                    phone: f.phone || id.phone || "",
                    website: f.website || id.website || "",
                  }));
                }}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-muted-foreground">Organisation Name *</Label>
                  <Input value={form.name} onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. DataGuard Nigeria Limited" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Organisation Type *</Label>
                  <Select value={form.organisationType} onValueChange={(v) => set("organisationType", v as OnboardingForm["organisationType"])}>
                    <SelectTrigger className="bg-card/60 border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="private">Private Company</SelectItem>
                      <SelectItem value="public">Public Institution</SelectItem>
                      <SelectItem value="ngo">NGO / Non-Profit</SelectItem>
                      <SelectItem value="academic">Academic / Research</SelectItem>
                      <SelectItem value="government">Government Agency</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">CAC RC/BN Number *</Label>
                  <Input value={form.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)}
                    placeholder="e.g. RC1234567" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Tax ID (TIN)</Label>
                  <Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)}
                    placeholder="Optional" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Email Address *</Label>
                  <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)}
                    placeholder="info@organisation.ng" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Phone Number *</Label>
                  <Input value={form.phone} onChange={(e) => set("phone", e.target.value)}
                    placeholder="+234 800 000 0000" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Website</Label>
                  <Input value={form.website} onChange={(e) => set("website", e.target.value)}
                    placeholder="https://www.organisation.ng" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">State *</Label>
                  <Select value={form.state} onValueChange={(v) => set("state", v)}>
                    <SelectTrigger className="bg-card/60 border-border text-foreground"><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-60">
                      {NIGERIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-muted-foreground">Registered Address *</Label>
                  <Textarea value={form.address} onChange={(e) => set("address", e.target.value)}
                    placeholder="Full registered office address" rows={2}
                    className="bg-card/60 border-border text-foreground resize-none" />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Services & contact */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
                <Users className="w-5 h-5" /> Services &amp; Primary Contact
              </h2>
              <div>
                <Label className="text-muted-foreground mb-3 block">
                  Services Offered * <span className="text-xs">(select all that apply)</span>
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {DPCO_SERVICES.map((svc) => (
                    <label key={svc.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        form.services.includes(svc.id)
                          ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                          : "border-border bg-card/40 text-muted-foreground hover:border-primary"
                      }`}>
                      <Checkbox checked={form.services.includes(svc.id)} onCheckedChange={() => toggleIn("services", svc.id)} className="border-primary" />
                      <span className="text-sm">{svc.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Contact Person Full Name *</Label>
                  <Input value={form.contactPersonName} onChange={(e) => set("contactPersonName", e.target.value)}
                    placeholder="e.g. Amaka Okonkwo" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Contact Person Role *</Label>
                  <Input value={form.contactPersonRole} onChange={(e) => set("contactPersonRole", e.target.value)}
                    placeholder="e.g. Data Protection Officer" className="bg-card/60 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Number of Staff</Label>
                  <Input type="number" min={1} value={form.staffCount} onChange={(e) => set("staffCount", e.target.value)}
                    placeholder="e.g. 25" className="bg-card/60 border-border text-foreground" />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Accreditation (auditors + sectors) */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
                <Shield className="w-5 h-5" /> Accreditation — Lead Auditors &amp; Sectors
              </h2>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  The NDPC requires at least one named principal holding a recognised data protection
                  certification. Certification evidence may be requested during review.
                </p>
              </div>
              <div className="space-y-4">
                {form.auditors.map((auditor, i) => (
                  <div key={i} className="bg-card/50 border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">Lead Auditor {i + 1}</span>
                      {form.auditors.length > 1 && (
                        <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 h-7 px-2"
                          onClick={() => set("auditors", form.auditors.filter((_, idx) => idx !== i))}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-muted-foreground text-xs mb-1 block">Full Name *</Label>
                        <Input value={auditor.name} onChange={(e) => updateAuditor(i, { name: e.target.value })}
                          className="bg-background border-border text-foreground h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-muted-foreground text-xs mb-1 block">Email *</Label>
                        <Input type="email" value={auditor.email} onChange={(e) => updateAuditor(i, { email: e.target.value })}
                          className="bg-background border-border text-foreground h-8 text-sm" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs mb-2 block">Certifications *</Label>
                      <div className="flex flex-wrap gap-2">
                        {CERTIFICATIONS.map((cert) => (
                          <button key={cert} type="button" onClick={() => toggleCert(i, cert)}
                            className={`px-2.5 py-1 rounded text-xs border transition-all ${
                              auditor.certifications.includes(cert)
                                ? "bg-blue-500/20 border-blue-500 text-blue-300"
                                : "bg-background border-border text-muted-foreground hover:border-primary"
                            }`}>
                            {cert}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="border-border text-muted-foreground gap-2 w-full"
                  onClick={() => set("auditors", [...form.auditors, { name: "", email: "", certifications: [] }])}>
                  <Plus className="w-4 h-4" /> Add Another Auditor
                </Button>
              </div>
              <div>
                <Label className="text-muted-foreground mb-2 block">Sector Specialisations *</Label>
                <div className="flex flex-wrap gap-2">
                  {SECTORS.map((s) => (
                    <button key={s} type="button" onClick={() => toggleIn("sectors", s)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                        form.sectors.includes(s)
                          ? "bg-cyan-500/20 border-cyan-500 text-cyan-300"
                          : "bg-card border-border text-muted-foreground hover:border-primary"
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Evidence & declaration */}
          {step === 4 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
                <FileText className="w-5 h-5" /> Evidence &amp; Declaration
              </h2>
              <div className="space-y-4">
                {([
                  { key: "incorporationDocUrl", label: "Certificate of Incorporation", sub: "CAC-certified copy (URL)" },
                  { key: "financialStatementsUrl", label: "Audited Financial Statements", sub: "Last 2 years (URL)" },
                  { key: "indemnityInsuranceUrl", label: "Professional Indemnity Insurance", sub: "Minimum ₦50M cover (URL)" },
                  { key: "auditMethodologyUrl", label: "Audit Methodology Document", sub: "Coverage of the NDPA control domains (URL)" },
                ] as const).map((doc) => (
                  <div key={doc.key} className="bg-card/50 border border-border rounded-lg p-4">
                    <p className="text-sm font-medium text-foreground">{doc.label}</p>
                    <p className="text-xs text-muted-foreground mb-2">{doc.sub}</p>
                    <Input value={form[doc.key]} onChange={(e) => set(doc.key, e.target.value)}
                      placeholder="https://…" className="bg-background border-border text-foreground text-sm" />
                  </div>
                ))}
              </div>
              <div className="bg-card/40 border border-border rounded-lg p-5 space-y-1 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Application Summary</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span>Organisation:</span><span>{form.name}</span>
                  <span>RC/BN Number:</span><span>{form.registrationNumber}</span>
                  <span>Email:</span><span>{form.email}</span>
                  <span>Services:</span><span>{form.services.length} selected</span>
                  <span>Lead auditors:</span><span>{form.auditors.length} named</span>
                  <span>Sectors:</span><span>{form.sectors.length} selected</span>
                </div>
              </div>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer bg-card/50 border border-border rounded-lg p-4">
                  <Checkbox checked={form.accuracyDeclaration} onCheckedChange={(v) => set("accuracyDeclaration", !!v)} className="mt-0.5 border-primary" />
                  <span className="text-sm text-muted-foreground">
                    I declare that all information provided is true, accurate, and complete. Providing false
                    information is an offence under the Nigeria Data Protection Act 2023 and may result in
                    rejection and/or prosecution.
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer bg-card/50 border border-border rounded-lg p-4">
                  <Checkbox checked={form.conflictDeclaration} onCheckedChange={(v) => set("conflictDeclaration", !!v)} className="mt-0.5 border-primary" />
                  <span className="text-sm text-muted-foreground">
                    I declare that this organisation has no material conflict of interest with any prospective
                    audit client, and that all named lead auditors are independent of any organisation they
                    may audit under this accreditation.
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Step 5: Confirmation */}
          {step === 5 && result && (
            <div className="text-center space-y-6 py-6">
              <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Onboarding Submitted</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  {result.alreadyRegistered
                    ? "Your organisation was already registered; the accreditation application has been filed and linked where possible."
                    : "Your organisation registration and accreditation application have both been received by the NDPC."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-4">
                {result.provisionalLicence && (
                  <div className="bg-card/60 border border-border rounded-lg p-5 text-left">
                    <p className="text-xs text-muted-foreground mb-1">Provisional Licence Reference</p>
                    <p className="font-mono text-cyan-300 text-lg font-bold">{result.provisionalLicence}</p>
                  </div>
                )}
                {result.referenceToken && (
                  <div className="bg-card/60 border border-border rounded-lg p-5 text-left">
                    <p className="text-xs text-muted-foreground mb-1">Accreditation Reference Token</p>
                    <p className="font-mono text-emerald-300 text-lg font-bold">{result.referenceToken}</p>
                    <p className="text-xs text-muted-foreground mt-2">Track status at /accreditation/status</p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button variant="outline" className="border-border text-muted-foreground"
                  onClick={() => { setForm(INITIAL_FORM); setStep(1); setResult(null); }}>
                  Submit Another Application
                </Button>
                <Button className="bg-cyan-600 hover:bg-cyan-500 text-foreground" onClick={() => navigate("/")}>
                  Return to Platform
                </Button>
              </div>
            </div>
          )}

          {/* Navigation */}
          {step < 5 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground"
                onClick={() => setStep((s) => s - 1)} disabled={step === 1}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button className="bg-cyan-600 hover:bg-cyan-500 text-foreground min-w-[140px]" onClick={next} disabled={submitting}>
                {submitting ? "Submitting..." : step === 4 ? "Submit Registration & Application" : <>Next <ChevronRight className="w-4 h-4 ml-1" /></>}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
