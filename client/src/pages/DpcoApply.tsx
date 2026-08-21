import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  CheckCircle, ChevronRight, ChevronLeft, Building2,
  Users, FileText, ShieldCheck, Plus, Trash2, AlertCircle,
  ArrowLeft, ExternalLink
} from "lucide-react";

const SECTORS = [
  "Banking & Finance", "Telecommunications", "Healthcare", "Insurance",
  "Fintech", "Government & Public Sector", "Education", "Energy & Utilities",
  "Retail & E-commerce", "Technology", "Media & Entertainment", "Logistics"
];

const CERTIFICATIONS = ["CIPP/E", "CIPP/A", "CIPM", "CDPSE", "CISA", "ISO 27001 Lead Auditor", "NDPC Certified DPO"];

const STEPS = [
  { id: 1, label: "Entity Details", icon: Building2 },
  { id: 2, label: "Lead Auditors", icon: Users },
  { id: 3, label: "Documents", icon: FileText },
  { id: 4, label: "Declaration", icon: ShieldCheck },
];

interface Auditor {
  name: string;
  email: string;
  certifications: string[];
}

export default function DpcoApply() {
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [referenceToken, setReferenceToken] = useState("");

  // Step 1 — Entity Details
  const [orgName, setOrgName] = useState("");
  const [rcNumber, setRcNumber] = useState("");
  const [cacNumber, setCacNumber] = useState("");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  // Step 2 — Lead Auditors
  const [auditors, setAuditors] = useState<Auditor[]>([{ name: "", email: "", certifications: [] }]);

  // Step 3 — Documents (URLs after upload)
  const [incorporationDocUrl, setIncorporationDocUrl] = useState("");
  const [financialStatementsUrl, setFinancialStatementsUrl] = useState("");
  const [indemnityInsuranceUrl, setIndemnityInsuranceUrl] = useState("");
  const [auditMethodologyUrl, setAuditMethodologyUrl] = useState("");

  // Step 4 — Declaration
  const [conflictDeclaration, setConflictDeclaration] = useState(false);
  const [accuracyDeclaration, setAccuracyDeclaration] = useState(false);

  const submitMutation = trpc.accreditation.submitApplication.useMutation({
    onSuccess: (data) => {
      setReferenceToken(data.referenceToken);
      setSubmitted(true);
    },
    onError: (err) => {
      toast.error(`Submission failed: ${err.message}`);
    },
  });

  const toggleSector = (s: string) => {
    setSelectedSectors(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const addAuditor = () => setAuditors(prev => [...prev, { name: "", email: "", certifications: [] }]);
  const removeAuditor = (i: number) => setAuditors(prev => prev.filter((_, idx) => idx !== i));
  const updateAuditor = (i: number, field: keyof Auditor, value: any) => {
    setAuditors(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  };
  const toggleCert = (auditorIdx: number, cert: string) => {
    setAuditors(prev => prev.map((a, i) => {
      if (i !== auditorIdx) return a;
      const certs = a.certifications.includes(cert)
        ? a.certifications.filter(c => c !== cert)
        : [...a.certifications, cert];
      return { ...a, certifications: certs };
    }));
  };

  const canProceedStep1 = orgName && rcNumber && address && email && selectedSectors.length > 0;
  const canProceedStep2 = auditors.length > 0 && auditors.every(a => a.name && a.email && a.certifications.length > 0);
  const canProceedStep3 = true; // Documents optional but encouraged
  const canSubmit = conflictDeclaration && accuracyDeclaration;

  const handleSubmit = () => {
    submitMutation.mutate({
      orgName, rcNumber, cacNumber: cacNumber || undefined, taxId: taxId || undefined,
      address, website: website || undefined, email, phone: phone || undefined,
      leadAuditors: auditors,
      sectors: selectedSectors,
      incorporationDocUrl: incorporationDocUrl || undefined,
      financialStatementsUrl: financialStatementsUrl || undefined,
      indemnityInsuranceUrl: indemnityInsuranceUrl || undefined,
      auditMethodologyUrl: auditMethodologyUrl || undefined,
      conflictDeclaration,
      applicationType: "new",
    });
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-lg w-full">
          <div className="bg-background border border-border rounded-xl p-8 text-center">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Application Submitted</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Your DPCO accreditation application has been received by the NDPC. You will be contacted at <span className="text-foreground">{email}</span> within 30 working days.
            </p>
            <div className="bg-card rounded-lg p-4 mb-6">
              <p className="text-xs text-muted-foreground mb-1">Reference Token</p>
              <p className="text-lg font-mono font-bold text-emerald-400">{referenceToken}</p>
              <p className="text-xs text-muted-foreground mt-1">Keep this token to track your application status</p>
            </div>
            <div className="space-y-2">
              <Link href="/accreditation/status">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-foreground">
                  Track Application Status
                </Button>
              </Link>
              <Link href="/">
                <Button variant="ghost" className="w-full text-muted-foreground hover:text-foreground">
                  Return to Home
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-background/50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-1">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-foreground">DPCO Accreditation Application</span>
          </div>
          <Badge variant="outline" className="ml-auto border-border text-muted-foreground text-xs">
            NDPA 2023 §33
          </Badge>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-10">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = step === s.id;
            const isDone = step > s.id;
            return (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                    isDone ? "bg-emerald-500 border-emerald-500" :
                    isActive ? "bg-card border-emerald-400" :
                    "bg-background border-border"
                  }`}>
                    {isDone
                      ? <CheckCircle className="w-4 h-4 text-foreground" />
                      : <Icon className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-muted-foreground"}`} />
                    }
                  </div>
                  <span className={`text-xs whitespace-nowrap ${isActive ? "text-emerald-400 font-medium" : isDone ? "text-emerald-500" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mt-[-14px] ${isDone ? "bg-emerald-500" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step 1 — Entity Details */}
        {step === 1 && (
          <div className="space-y-6">
        <Breadcrumbs items={[{ label: "DPCO", href: "/dpco" }, { label: "Apply" }]} />
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Entity Details</h2>
              <p className="text-sm text-muted-foreground">Provide the legal details of your organisation applying for DPCO accreditation.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label className="text-muted-foreground text-sm mb-1.5 block">Organisation Name <span className="text-red-400">*</span></Label>
                <Input value={orgName} onChange={e => setOrgName(e.target.value)}
                  placeholder="e.g. DataGuard Consulting Ltd"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <Label className="text-muted-foreground text-sm mb-1.5 block">RC Number <span className="text-red-400">*</span></Label>
                <Input value={rcNumber} onChange={e => setRcNumber(e.target.value)}
                  placeholder="e.g. RC1234567"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <Label className="text-muted-foreground text-sm mb-1.5 block">CAC Number</Label>
                <Input value={cacNumber} onChange={e => setCacNumber(e.target.value)}
                  placeholder="Optional"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <Label className="text-muted-foreground text-sm mb-1.5 block">Tax ID (TIN)</Label>
                <Input value={taxId} onChange={e => setTaxId(e.target.value)}
                  placeholder="Optional"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <Label className="text-muted-foreground text-sm mb-1.5 block">Website</Label>
                <Input value={website} onChange={e => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <Label className="text-muted-foreground text-sm mb-1.5 block">Contact Email <span className="text-red-400">*</span></Label>
                <Input value={email} onChange={e => setEmail(e.target.value)}
                  type="email" placeholder="accreditation@example.com"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <Label className="text-muted-foreground text-sm mb-1.5 block">Phone</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+234 800 000 0000"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="col-span-2">
                <Label className="text-muted-foreground text-sm mb-1.5 block">Registered Address <span className="text-red-400">*</span></Label>
                <Textarea value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="Full registered address including state and LGA"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground resize-none" rows={2} />
              </div>
            </div>

            <div>
              <Label className="text-muted-foreground text-sm mb-2 block">Sector Specialisations <span className="text-red-400">*</span></Label>
              <p className="text-xs text-muted-foreground mb-3">Select all sectors your organisation has expertise in auditing</p>
              <div className="flex flex-wrap gap-2">
                {SECTORS.map(s => (
                  <button key={s} onClick={() => toggleSector(s)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                      selectedSectors.includes(s)
                        ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                        : "bg-card border-border text-muted-foreground hover:border-primary"
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — Lead Auditors */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Lead Auditors</h2>
              <p className="text-sm text-muted-foreground">Provide details of at least two principals holding recognised data protection certifications.</p>
            </div>
            <div className="space-y-4">
              {auditors.map((auditor, i) => (
                <div key={i} className="bg-card/50 border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">Auditor {i + 1}</span>
                    {auditors.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeAuditor(i)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 px-2">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-muted-foreground text-xs mb-1 block">Full Name <span className="text-red-400">*</span></Label>
                      <Input value={auditor.name} onChange={e => updateAuditor(i, "name", e.target.value)}
                        placeholder="Dr. Amina Okonkwo"
                        className="bg-background border-border text-foreground placeholder:text-muted-foreground h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs mb-1 block">Email <span className="text-red-400">*</span></Label>
                      <Input value={auditor.email} onChange={e => updateAuditor(i, "email", e.target.value)}
                        type="email" placeholder="auditor@example.com"
                        className="bg-background border-border text-foreground placeholder:text-muted-foreground h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs mb-2 block">Certifications <span className="text-red-400">*</span></Label>
                    <div className="flex flex-wrap gap-2">
                      {CERTIFICATIONS.map(cert => (
                        <button key={cert} onClick={() => toggleCert(i, cert)}
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
              <Button variant="outline" onClick={addAuditor}
                className="border-border text-muted-foreground hover:bg-card gap-2 w-full">
                <Plus className="w-4 h-4" /> Add Another Auditor
              </Button>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                The NDPC requires a minimum of two principals with recognised certifications. Certification evidence will be requested during the review stage.
              </p>
            </div>
          </div>
        )}

        {/* Step 3 — Documents */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Supporting Documents</h2>
              <p className="text-sm text-muted-foreground">Upload your documents to a file hosting service and paste the public URL below. Accepted formats: PDF.</p>
            </div>
            <div className="space-y-4">
              {[
                { label: "Certificate of Incorporation", sublabel: "CAC-certified copy of your incorporation documents", value: incorporationDocUrl, setter: setIncorporationDocUrl, required: true },
                { label: "Audited Financial Statements", sublabel: "Last 2 years of audited financial statements", value: financialStatementsUrl, setter: setFinancialStatementsUrl, required: true },
                { label: "Professional Indemnity Insurance", sublabel: "Current certificate with minimum ₦50M cover", value: indemnityInsuranceUrl, setter: setIndemnityInsuranceUrl, required: true },
                { label: "Audit Methodology Document", sublabel: "Demonstrating competence across all 15 NDPA control domains", value: auditMethodologyUrl, setter: setAuditMethodologyUrl, required: true },
              ].map(doc => (
                <div key={doc.label} className="bg-card/50 border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{doc.label} {doc.required && <span className="text-red-400">*</span>}</p>
                      <p className="text-xs text-muted-foreground">{doc.sublabel}</p>
                    </div>
                    {doc.value && (
                      <a href={doc.value} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-300 h-7 gap-1 text-xs">
                          <ExternalLink className="w-3 h-3" /> View
                        </Button>
                      </a>
                    )}
                  </div>
                  <Input value={doc.value} onChange={e => doc.setter(e.target.value)}
                    placeholder="https://drive.google.com/... or https://dropbox.com/..."
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground text-sm" />
                </div>
              ))}
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300">
                Documents can be submitted after initial application if not yet available. The NDPC reviewer may request additional documents during the review stage.
              </p>
            </div>
          </div>
        )}

        {/* Step 4 — Declaration & Fee */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Declaration & Application Fee</h2>
              <p className="text-sm text-muted-foreground">Review the declarations and confirm the application fee before submitting.</p>
            </div>

            {/* Summary */}
            <div className="bg-card/50 border border-border rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Application Summary</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">Organisation</span><span className="text-foreground">{orgName}</span>
                <span className="text-muted-foreground">RC Number</span><span className="text-foreground">{rcNumber}</span>
                <span className="text-muted-foreground">Email</span><span className="text-foreground">{email}</span>
                <span className="text-muted-foreground">Lead Auditors</span><span className="text-foreground">{auditors.length} named</span>
                <span className="text-muted-foreground">Sectors</span><span className="text-foreground">{selectedSectors.length} selected</span>
                <span className="text-muted-foreground">Application Type</span><span className="text-foreground">New Accreditation</span>
              </div>
            </div>

            {/* Fee */}
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Application Fee</p>
                  <p className="text-xs text-muted-foreground">Non-refundable NDPC processing fee (NDPA §33)</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-foreground">₦150,000</p>
                  <p className="text-xs text-muted-foreground">Payable on submission</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">Payment will be processed via the NDPC payment portal after submission. Your application will be queued for review upon payment confirmation.</p>
              </div>
            </div>

            {/* Declarations */}
            <div className="space-y-3">
              <div className="flex items-start gap-3 bg-card/50 border border-border rounded-lg p-4">
                <Checkbox id="conflict" checked={conflictDeclaration}
                  onCheckedChange={(v) => setConflictDeclaration(v === true)}
                  className="mt-0.5 border-primary" />
                <label htmlFor="conflict" className="text-sm text-muted-foreground cursor-pointer leading-relaxed">
                  I declare that this organisation has no material conflict of interest with any prospective audit client, and that all named lead auditors are independent of any organisation they may audit under this accreditation.
                </label>
              </div>
              <div className="flex items-start gap-3 bg-card/50 border border-border rounded-lg p-4">
                <Checkbox id="accuracy" checked={accuracyDeclaration}
                  onCheckedChange={(v) => setAccuracyDeclaration(v === true)}
                  className="mt-0.5 border-primary" />
                <label htmlFor="accuracy" className="text-sm text-muted-foreground cursor-pointer leading-relaxed">
                  I declare that all information provided in this application is true, accurate, and complete to the best of my knowledge. I understand that providing false information is grounds for rejection and may constitute an offence under applicable law.
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <Button variant="ghost" onClick={() => setStep(s => s - 1)} disabled={step === 1}
            className="text-muted-foreground hover:text-foreground gap-2">
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">Step {step} of {STEPS.length}</span>
          {step < 4 ? (
            <Button onClick={() => setStep(s => s + 1)}
              disabled={
                (step === 1 && !canProceedStep1) ||
                (step === 2 && !canProceedStep2)
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-foreground gap-2">
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!canSubmit || submitMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-foreground gap-2 min-w-32">
              {submitMutation.isPending ? "Submitting..." : "Submit Application"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
