/**
 * DPCO Self-Registration Portal
 * ==============================
 * Public page — no login required.
 * Multi-step form: Organisation Details → Services & Contact → Declaration → Confirmation
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Shield,
  FileText,
  Users,
  Globe,
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

const STEPS = [
  { id: 1, label: "Organisation", icon: Building2 },
  { id: 2, label: "Services", icon: Shield },
  { id: 3, label: "Declaration", icon: FileText },
  { id: 4, label: "Confirmation", icon: CheckCircle2 },
];

interface FormData {
  name: string;
  organisationType: "private" | "public" | "ngo" | "academic" | "government";
  email: string;
  phone: string;
  website: string;
  state: string;
  address: string;
  cacNumber: string;
  ndpcReference: string;
  services: string[];
  staffCount: string;
  contactPersonName: string;
  contactPersonRole: string;
  declarationAccepted: boolean;
}

const INITIAL_FORM: FormData = {
  name: "",
  organisationType: "private",
  email: "",
  phone: "",
  website: "",
  state: "",
  address: "",
  cacNumber: "",
  ndpcReference: "",
  services: [],
  staffCount: "",
  contactPersonName: "",
  contactPersonRole: "",
  declarationAccepted: false,
};

export default function DpcoRegister() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [result, setResult] = useState<{ provisionalLicence: string; message: string } | null>(null);

  const registerMutation = trpc.dpco.registerOrganisation.useMutation({
    onSuccess: (data) => {
      setResult({ provisionalLicence: data.provisionalLicence, message: data.message });
      setStep(4);
    },
    onError: (err) => {
      toast.error(err.message ?? "Registration failed. Please try again.");
    },
  });

  const set = (field: keyof FormData, value: any) =>
    setForm((f) => ({ ...f, [field]: value }));

  const toggleService = (id: string) => {
    setForm((f) => ({
      ...f,
      services: f.services.includes(id)
        ? f.services.filter((s) => s !== id)
        : [...f.services, id],
    }));
  };

  const validateStep = (): boolean => {
    if (step === 1) {
      if (!form.name.trim()) { toast.error("Organisation name is required"); return false; }
      if (!form.email.trim() || !form.email.includes("@")) { toast.error("Valid email is required"); return false; }
      if (!form.phone.trim()) { toast.error("Phone number is required"); return false; }
      if (!form.state) { toast.error("State is required"); return false; }
      if (!form.address.trim()) { toast.error("Address is required"); return false; }
      if (!form.cacNumber.trim()) { toast.error("CAC number is required"); return false; }
    }
    if (step === 2) {
      if (form.services.length === 0) { toast.error("Select at least one service"); return false; }
      if (!form.contactPersonName.trim()) { toast.error("Contact person name is required"); return false; }
      if (!form.contactPersonRole.trim()) { toast.error("Contact person role is required"); return false; }
    }
    if (step === 3) {
      if (!form.declarationAccepted) { toast.error("You must accept the declaration to proceed"); return false; }
    }
    return true;
  };

  const next = () => {
    if (!validateStep()) return;
    if (step === 3) {
      registerMutation.mutate({
        name: form.name,
        organisationType: form.organisationType,
        email: form.email,
        phone: form.phone,
        website: form.website || undefined,
        state: form.state,
        address: form.address,
        cacNumber: form.cacNumber,
        ndpcReference: form.ndpcReference || undefined,
        services: form.services,
        staffCount: form.staffCount ? parseInt(form.staffCount) : undefined,
        contactPersonName: form.contactPersonName,
        contactPersonRole: form.contactPersonRole,
        declarationAccepted: true,
      });
    } else {
      setStep((s) => s + 1);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-cyan-900/40 bg-background/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <Shield className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs text-cyan-400 font-mono uppercase tracking-widest">NDPC / NDSEP</p>
              <p className="text-sm font-semibold text-foreground">DPCO Registration Portal</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/")}
          >
            ← Back to Platform
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Title */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Data Protection Compliance Organisation
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Apply for NDPC accreditation as a licensed DPCO under the Nigeria Data Protection Act 2023.
            Complete the form below to submit your application for review.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-10">
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
                {i < STEPS.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                )}
              </div>
            );
          })}
        </div>

        {/* Form card */}
        <div className="bg-background border border-border/50 rounded-xl p-8">
          {/* Step 1: Organisation Details */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
                <Building2 className="w-5 h-5" /> Organisation Details
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-muted-foreground">Organisation Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. DataGuard Nigeria Limited"
                    className="bg-card/60 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Organisation Type *</Label>
                  <Select value={form.organisationType} onValueChange={(v) => set("organisationType", v)}>
                    <SelectTrigger className="bg-card/60 border-border text-foreground">
                      <SelectValue />
                    </SelectTrigger>
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
                  <Label className="text-muted-foreground">CAC Registration Number *</Label>
                  <Input
                    value={form.cacNumber}
                    onChange={(e) => set("cacNumber", e.target.value)}
                    placeholder="e.g. RC-1234567"
                    className="bg-card/60 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Email Address *</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="info@organisation.ng"
                    className="bg-card/60 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Phone Number *</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="+234 800 000 0000"
                    className="bg-card/60 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Website</Label>
                  <Input
                    value={form.website}
                    onChange={(e) => set("website", e.target.value)}
                    placeholder="https://www.organisation.ng"
                    className="bg-card/60 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">State *</Label>
                  <Select value={form.state} onValueChange={(v) => set("state", v)}>
                    <SelectTrigger className="bg-card/60 border-border text-foreground">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-60">
                      {NIGERIAN_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-muted-foreground">Registered Address *</Label>
                  <Textarea
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    placeholder="Full registered office address"
                    rows={2}
                    className="bg-card/60 border-border text-foreground resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">NDPC Reference (if any)</Label>
                  <Input
                    value={form.ndpcReference}
                    onChange={(e) => set("ndpcReference", e.target.value)}
                    placeholder="e.g. NDPC/REF/2024/001"
                    className="bg-card/60 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Number of Staff</Label>
                  <Input
                    type="number"
                    value={form.staffCount}
                    onChange={(e) => set("staffCount", e.target.value)}
                    placeholder="e.g. 25"
                    min={1}
                    className="bg-card/60 border-border text-foreground"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Services & Contact */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
                <Shield className="w-5 h-5" /> Services & Contact Person
              </h2>
              <div>
                <Label className="text-muted-foreground mb-3 block">
                  Services Offered * <span className="text-muted-foreground text-xs">(select all that apply)</span>
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {DPCO_SERVICES.map((svc) => (
                    <label
                      key={svc.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        form.services.includes(svc.id)
                          ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                          : "border-border bg-card/40 text-muted-foreground hover:border-primary"
                      }`}
                    >
                      <Checkbox
                        checked={form.services.includes(svc.id)}
                        onCheckedChange={() => toggleService(svc.id)}
                        className="border-primary"
                      />
                      <span className="text-sm">{svc.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="border-t border-border pt-6">
                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2 mb-4">
                  <Users className="w-4 h-4" /> Primary Contact Person
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground">Full Name *</Label>
                    <Input
                      value={form.contactPersonName}
                      onChange={(e) => set("contactPersonName", e.target.value)}
                      placeholder="e.g. Amaka Okonkwo"
                      className="bg-card/60 border-border text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground">Role / Title *</Label>
                    <Input
                      value={form.contactPersonRole}
                      onChange={(e) => set("contactPersonRole", e.target.value)}
                      placeholder="e.g. Data Protection Officer"
                      className="bg-card/60 border-border text-foreground"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Declaration */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
                <FileText className="w-5 h-5" /> Declaration & Submission
              </h2>
              <div className="bg-card/40 border border-border rounded-lg p-5 space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p className="font-semibold text-foreground">Application Summary</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span className="text-muted-foreground">Organisation:</span>
                  <span>{form.name}</span>
                  <span className="text-muted-foreground">Email:</span>
                  <span>{form.email}</span>
                  <span className="text-muted-foreground">CAC Number:</span>
                  <span>{form.cacNumber}</span>
                  <span className="text-muted-foreground">State:</span>
                  <span>{form.state}</span>
                  <span className="text-muted-foreground">Services:</span>
                  <span>{form.services.length} selected</span>
                  <span className="text-muted-foreground">Contact:</span>
                  <span>{form.contactPersonName}</span>
                </div>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-5 text-sm text-amber-200 space-y-2">
                <p className="font-semibold">Statutory Declaration</p>
                <p>
                  I hereby declare that the information provided in this application is true, accurate, and
                  complete to the best of my knowledge. I understand that providing false information is an
                  offence under the Nigeria Data Protection Act 2023 and may result in rejection of this
                  application and/or prosecution.
                </p>
                <p>
                  I confirm that the organisation named above meets the eligibility criteria for accreditation
                  as a Data Protection Compliance Organisation (DPCO) as defined by the Nigeria Data Protection
                  Commission (NDPC).
                </p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={form.declarationAccepted}
                  onCheckedChange={(v) => set("declarationAccepted", !!v)}
                  className="mt-0.5 border-primary"
                />
                <span className="text-sm text-muted-foreground">
                  I accept the above declaration and confirm that all information provided is accurate and
                  complete. I authorise NDPC to verify the details provided.
                </span>
              </label>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 4 && result && (
            <div className="text-center space-y-6 py-6">
              <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Application Submitted</h2>
                <p className="text-muted-foreground max-w-md mx-auto">{result.message}</p>
              </div>
              <div className="bg-card/60 border border-border rounded-lg p-5 inline-block text-left">
                <p className="text-xs text-muted-foreground mb-1">Provisional Licence Reference</p>
                <p className="font-mono text-cyan-300 text-lg font-bold">{result.provisionalLicence}</p>
                <p className="text-xs text-muted-foreground mt-2">Keep this reference for your records</p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground"
                  onClick={() => { setForm(INITIAL_FORM); setStep(1); setResult(null); }}
                >
                  Submit Another Application
                </Button>
                <Button
                  className="bg-cyan-600 hover:bg-cyan-500 text-foreground"
                  onClick={() => navigate("/")}
                >
                  Return to Platform
                </Button>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          {step < 4 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setStep((s) => s - 1)}
                disabled={step === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                className="bg-cyan-600 hover:bg-cyan-500 text-foreground min-w-[140px]"
                onClick={next}
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending ? (
                  "Submitting..."
                ) : step === 3 ? (
                  "Submit Application"
                ) : (
                  <>Next <ChevronRight className="w-4 h-4 ml-1" /></>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
