import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Building2, User, FileText, Shield, CheckCircle,
  ChevronRight, ChevronLeft, Upload, AlertCircle, Briefcase
} from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STEPS = [
  { id: 1, title: "Organisation Details",  icon: Building2,  desc: "Basic company information" },
  { id: 2, title: "Key Personnel",         icon: User,       desc: "DPO and principal officers" },
  { id: 3, title: "Service Scope",         icon: Briefcase,  desc: "Services and sector coverage" },
  { id: 4, title: "Compliance Evidence",   icon: FileText,   desc: "Insurance and qualifications" },
  { id: 5, title: "Declaration",           icon: Shield,     desc: "Review and submit" },
];

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba",
  "Yobe","Zamfara"
];

const SERVICE_TYPES = [
  "Data Protection Auditing",
  "Compliance Consulting",
  "Privacy Policy Drafting",
  "DPIA Facilitation",
  "Staff Training Delivery",
  "DPO-as-a-Service",
  "Breach Response Management",
  "ROPA Development",
  "Data Mapping",
  "Cross-Border Transfer Advisory",
];

const SECTORS = [
  "Financial Services","Healthcare","Telecommunications","Education","E-Commerce",
  "Government/Public Sector","Insurance","Legal","Technology","Media & Entertainment",
  "Oil & Gas","Manufacturing","Real Estate","NGO/Non-Profit","Other",
];

interface FormData {
  // Step 1
  orgName: string; rcNumber: string; taxId: string; address: string;
  state: string; city: string; phone: string; email: string; website: string;
  // Step 2
  dpoName: string; dpoEmail: string; dpoPhone: string; dpoQualification: string;
  ceoName: string; ceoEmail: string;
  // Step 3
  services: string[]; sectors: string[]; operatingStates: string[];
  yearsExperience: string; clientCapacity: string;
  // Step 4
  indemnityInsurer: string; indemnityAmount: string; indemnityExpiry: string;
  qualifications: string; references: string;
  // Step 5
  declarationAccepted: boolean; ndpaAccepted: boolean; feeAcknowledged: boolean;
}

const EMPTY: FormData = {
  orgName: "", rcNumber: "", taxId: "", address: "", state: "", city: "",
  phone: "", email: "", website: "",
  dpoName: "", dpoEmail: "", dpoPhone: "", dpoQualification: "", ceoName: "", ceoEmail: "",
  services: [], sectors: [], operatingStates: [], yearsExperience: "", clientCapacity: "",
  indemnityInsurer: "", indemnityAmount: "", indemnityExpiry: "", qualifications: "", references: "",
  declarationAccepted: false, ndpaAccepted: false, feeAcknowledged: false,
};

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = current > step.id;
        const active = current === step.id;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all
                ${done ? "bg-green-600 border-green-600 text-white" :
                  active ? "bg-blue-600 border-blue-600 text-white" :
                  "bg-background border-border text-muted-foreground"}`}>
                {done ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
              </div>
              <div className={`text-xs mt-1 font-medium text-center max-w-[80px] leading-tight
                ${active ? "text-blue-700" : done ? "text-green-700" : "text-muted-foreground"}`}>
                {step.title}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-5 ${done ? "bg-green-400" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MultiSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded p-3 bg-muted">
        {options.map(opt => (
          <div key={opt} className="flex items-center gap-2">
            <Checkbox
              id={`opt-${opt}`}
              checked={value.includes(opt)}
              onCheckedChange={checked => {
                if (checked) onChange([...value, opt]);
                else onChange(value.filter(v => v !== opt));
              }}
            />
            <label htmlFor={`opt-${opt}`} className="text-sm cursor-pointer leading-tight">{opt}</label>
          </div>
        ))}
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {value.map(v => (
            <Badge key={v} variant="secondary" className="text-xs cursor-pointer"
              onClick={() => onChange(value.filter(x => x !== v))}>
              {v} ×
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DpcoOnboard() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [refNumber, setRefNumber] = useState("");

  const createMutation = trpc.dpco.upsertOrganisation.useMutation({
    onSuccess: (data: any) => {
      setRefNumber(data?.licence_number ?? `DPCO-APP-${Date.now()}`);
      setSubmitted(true);
      toast.success("Application submitted successfully!");
    },
    onError: (err: any) => toast.error(`Submission failed: ${err.message}`),
  });

  function set(field: keyof FormData, value: any) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function validateStep(): boolean {
    if (step === 1) {
      if (!form.orgName || !form.rcNumber || !form.address || !form.state || !form.email || !form.phone) {
        toast.error("Please fill all required fields"); return false;
      }
    }
    if (step === 2) {
      if (!form.dpoName || !form.dpoEmail || !form.ceoName) {
        toast.error("DPO name, email, and CEO name are required"); return false;
      }
    }
    if (step === 3) {
      if (form.services.length === 0 || form.sectors.length === 0) {
        toast.error("Select at least one service and one sector"); return false;
      }
    }
    if (step === 4) {
      if (!form.indemnityInsurer || !form.indemnityAmount || !form.indemnityExpiry) {
        toast.error("Professional indemnity insurance details are required"); return false;
      }
    }
    if (step === 5) {
      if (!form.declarationAccepted || !form.ndpaAccepted || !form.feeAcknowledged) {
        toast.error("All declarations must be accepted before submission"); return false;
      }
    }
    return true;
  }

  function next() {
    if (!validateStep()) return;
    if (step < 5) setStep(s => s + 1);
    else handleSubmit();
  }

  function handleSubmit() {
    createMutation.mutate({
      name: form.orgName,
      rc_number: form.rcNumber,
      address: form.address,
      state: form.state,
      city: form.city,
      phone: form.phone,
      email: form.email,
      website: form.website || undefined,
      dpo_name: form.dpoName,
      dpo_email: form.dpoEmail,
      status: "pending_review",
      service_scope: form.services.join(", "),
      sector_coverage: form.sectors.join(", "),
      years_experience: parseInt(form.yearsExperience) || 0,
    } as any);
  }

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Dpco Onboard" }]} className="mb-4" />
        <Card className="border-green-500/20 bg-green-50">
          <CardContent className="pt-8 pb-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-green-900 mb-2">Application Submitted!</h2>
            <p className="text-green-800 mb-4">
              Your DPCO licence application has been received by the NDPC. You will be notified within 30 working days.
            </p>
            <div className="bg-background rounded-lg border border-green-500/20 p-4 mb-6 inline-block">
              <div className="text-xs text-muted-foreground mb-1">Application Reference Number</div>
              <div className="text-xl font-mono font-bold text-foreground">{refNumber}</div>
            </div>
            <div className="text-sm text-green-700 space-y-1">
              <p>✓ Confirmation email sent to <strong>{form.email}</strong></p>
              <p>✓ Application fee invoice will be sent within 24 hours</p>
              <p>✓ NDPC review team will contact you for document verification</p>
            </div>
            <Button className="mt-6" onClick={() => { setStep(1); setForm(EMPTY); setSubmitted(false); }}>
              Submit Another Application
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-600" />
          DPCO Licence Application
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Apply for a Data Protection Compliance Organisation licence under NDPA 2023 Section 33
        </p>
      </div>

      <Progress value={(step / STEPS.length) * 100} className="h-2" />
      <StepIndicator current={step} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{STEPS[step - 1].title}</CardTitle>
          <p className="text-sm text-muted-foreground">{STEPS[step - 1].desc}</p>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Step 1: Organisation Details */}
          {step === 1 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Organisation Name <span className="text-red-500">*</span></Label>
                  <Input value={form.orgName} onChange={e => set("orgName", e.target.value)} placeholder="Acme Data Protection Ltd" />
                </div>
                <div>
                  <Label>RC Number (CAC) <span className="text-red-500">*</span></Label>
                  <Input value={form.rcNumber} onChange={e => set("rcNumber", e.target.value)} placeholder="RC1234567" />
                </div>
                <div>
                  <Label>Tax Identification Number</Label>
                  <Input value={form.taxId} onChange={e => set("taxId", e.target.value)} placeholder="12345678-0001" />
                </div>
                <div className="col-span-2">
                  <Label>Registered Address <span className="text-red-500">*</span></Label>
                  <Textarea value={form.address} onChange={e => set("address", e.target.value)} placeholder="No. 1 Data Street, Victoria Island" rows={2} />
                </div>
                <div>
                  <Label>State <span className="text-red-500">*</span></Label>
                  <Select value={form.state} onValueChange={v => set("state", v)}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>{NIGERIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={form.city} onChange={e => set("city", e.target.value)} placeholder="Lagos" />
                </div>
                <div>
                  <Label>Phone Number <span className="text-red-500">*</span></Label>
                  <Input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+234 800 000 0000" />
                </div>
                <div>
                  <Label>Email Address <span className="text-red-500">*</span></Label>
                  <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="info@acmedp.com" />
                </div>
                <div className="col-span-2">
                  <Label>Website</Label>
                  <Input value={form.website} onChange={e => set("website", e.target.value)} placeholder="https://acmedp.com" />
                </div>
              </div>
            </>
          )}

          {/* Step 2: Key Personnel */}
          {step === 2 && (
            <>
              <div className="bg-blue-50 border border-blue-500/20 rounded p-3 text-sm text-blue-800 flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                The DPO must hold a recognised data protection qualification (CIPP, CIPM, CDPO, or equivalent).
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>DPO Full Name <span className="text-red-500">*</span></Label>
                  <Input value={form.dpoName} onChange={e => set("dpoName", e.target.value)} placeholder="Dr. Amina Okafor" />
                </div>
                <div>
                  <Label>DPO Email <span className="text-red-500">*</span></Label>
                  <Input type="email" value={form.dpoEmail} onChange={e => set("dpoEmail", e.target.value)} placeholder="dpo@acmedp.com" />
                </div>
                <div>
                  <Label>DPO Phone</Label>
                  <Input value={form.dpoPhone} onChange={e => set("dpoPhone", e.target.value)} placeholder="+234 800 000 0001" />
                </div>
                <div>
                  <Label>DPO Qualification</Label>
                  <Select value={form.dpoQualification} onValueChange={v => set("dpoQualification", v)}>
                    <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CIPP/E">CIPP/E (IAPP)</SelectItem>
                      <SelectItem value="CIPM">CIPM (IAPP)</SelectItem>
                      <SelectItem value="CDPO">CDPO</SelectItem>
                      <SelectItem value="NDPA-CERT">NDPC Certified DPO</SelectItem>
                      <SelectItem value="LLM-DP">LLM in Data Protection</SelectItem>
                      <SelectItem value="OTHER">Other Recognised Qualification</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>CEO / MD Full Name <span className="text-red-500">*</span></Label>
                  <Input value={form.ceoName} onChange={e => set("ceoName", e.target.value)} placeholder="Mr. Chukwuemeka Adeyemi" />
                </div>
                <div>
                  <Label>CEO / MD Email</Label>
                  <Input type="email" value={form.ceoEmail} onChange={e => set("ceoEmail", e.target.value)} placeholder="ceo@acmedp.com" />
                </div>
              </div>
            </>
          )}

          {/* Step 3: Service Scope */}
          {step === 3 && (
            <>
              <MultiSelect
                label="Services Offered *"
                options={SERVICE_TYPES}
                value={form.services}
                onChange={v => set("services", v)}
              />
              <MultiSelect
                label="Sectors Covered *"
                options={SECTORS}
                value={form.sectors}
                onChange={v => set("sectors", v)}
              />
              <MultiSelect
                label="States of Operation"
                options={NIGERIAN_STATES}
                value={form.operatingStates}
                onChange={v => set("operatingStates", v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Years of Experience in Data Protection</Label>
                  <Select value={form.yearsExperience} onValueChange={v => set("yearsExperience", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {["1","2","3","4","5","6","7","8","9","10+"].map(y => <SelectItem key={y} value={y}>{y} year{y !== "1" ? "s" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Maximum Client Capacity (per year)</Label>
                  <Select value={form.clientCapacity} onValueChange={v => set("clientCapacity", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {["1-5","6-10","11-20","21-50","51-100","100+"].map(c => <SelectItem key={c} value={c}>{c} clients</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* Step 4: Compliance Evidence */}
          {step === 4 && (
            <>
              <div className="bg-amber-50 border border-amber-500/20 rounded p-3 text-sm text-amber-800 flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                Professional Indemnity Insurance is mandatory under NDPA S.33(3). Minimum cover: ₦50,000,000.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Insurance Provider <span className="text-red-500">*</span></Label>
                  <Input value={form.indemnityInsurer} onChange={e => set("indemnityInsurer", e.target.value)} placeholder="Leadway Assurance" />
                </div>
                <div>
                  <Label>Cover Amount (₦) <span className="text-red-500">*</span></Label>
                  <Input value={form.indemnityAmount} onChange={e => set("indemnityAmount", e.target.value)} placeholder="50,000,000" />
                </div>
                <div>
                  <Label>Policy Expiry Date <span className="text-red-500">*</span></Label>
                  <Input type="date" value={form.indemnityExpiry} onChange={e => set("indemnityExpiry", e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Professional Qualifications & Certifications</Label>
                <Textarea
                  value={form.qualifications}
                  onChange={e => set("qualifications", e.target.value)}
                  placeholder="List all relevant qualifications, certifications, and professional memberships of key personnel..."
                  rows={3}
                />
              </div>
              <div>
                <Label>Client References (minimum 2)</Label>
                <Textarea
                  value={form.references}
                  onChange={e => set("references", e.target.value)}
                  placeholder="Provide names and contact details of at least 2 organisations you have provided data protection services to..."
                  rows={3}
                />
              </div>
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground font-medium">Upload Supporting Documents</p>
                <p className="text-xs text-muted-foreground mt-1">CAC Certificate, Insurance Certificate, DPO Qualification Certificates (PDF, max 10MB each)</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => toast.info("Document upload will be available after account creation")}>
                  Select Files
                </Button>
              </div>
            </>
          )}

          {/* Step 5: Declaration */}
          {step === 5 && (
            <>
              <div className="bg-muted border rounded-lg p-4 space-y-3 text-sm">
                <h3 className="font-semibold text-foreground">Application Summary</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Organisation:</span> <span className="font-medium">{form.orgName}</span></div>
                  <div><span className="text-muted-foreground">RC Number:</span> <span className="font-medium">{form.rcNumber}</span></div>
                  <div><span className="text-muted-foreground">State:</span> <span className="font-medium">{form.state}</span></div>
                  <div><span className="text-muted-foreground">DPO:</span> <span className="font-medium">{form.dpoName}</span></div>
                  <div><span className="text-muted-foreground">Services:</span> <span className="font-medium">{form.services.length} selected</span></div>
                  <div><span className="text-muted-foreground">Sectors:</span> <span className="font-medium">{form.sectors.length} selected</span></div>
                  <div><span className="text-muted-foreground">Indemnity:</span> <span className="font-medium">₦{form.indemnityAmount} ({form.indemnityInsurer})</span></div>
                </div>
              </div>
              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-3">
                  <Checkbox id="decl1" checked={form.declarationAccepted} onCheckedChange={v => set("declarationAccepted", !!v)} />
                  <label htmlFor="decl1" className="text-sm cursor-pointer">
                    I declare that all information provided in this application is true, accurate, and complete. I understand that providing false information is an offence under the NDPA 2023 and may result in criminal prosecution.
                  </label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox id="decl2" checked={form.ndpaAccepted} onCheckedChange={v => set("ndpaAccepted", !!v)} />
                  <label htmlFor="decl2" className="text-sm cursor-pointer">
                    I confirm that the organisation and its personnel will comply with all obligations under the Nigeria Data Protection Act 2023, the Nigeria Data Protection Regulation, and all guidelines issued by the NDPC.
                  </label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox id="decl3" checked={form.feeAcknowledged} onCheckedChange={v => set("feeAcknowledged", !!v)} />
                  <label htmlFor="decl3" className="text-sm cursor-pointer">
                    I acknowledge that the DPCO licence application fee of <strong>₦250,000</strong> is payable upon submission and is non-refundable. Annual renewal fee of <strong>₦150,000</strong> applies.
                  </label>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={step === 1} className="gap-2">
          <ChevronLeft className="w-4 h-4" /> Previous
        </Button>
        <Button onClick={next} disabled={createMutation.isPending} className="gap-2">
          {step === 5 ? (createMutation.isPending ? "Submitting..." : "Submit Application") : "Next Step"}
          {step < 5 && <ChevronRight className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
