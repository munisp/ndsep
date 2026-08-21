import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Pencil, Check, X, Printer, ExternalLink } from "lucide-react";
import { toast } from "sonner";

// ── Editable Text Component ────────────────────────────────────────────────
function EditableText({
  value, onChange, className = "", multiline = false, placeholder = "Click to edit..."
}: {
  value: string; onChange: (v: string) => void; className?: string; multiline?: boolean; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = () => { onChange(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    return (
      <span className="inline-flex flex-col gap-1 w-full">
        {multiline
          ? <Textarea value={draft} onChange={e => setDraft(e.target.value)} className="text-inherit bg-background/10 border-white/30 text-sm min-h-[80px]" autoFocus />
          : <Input value={draft} onChange={e => setDraft(e.target.value)} className="text-inherit bg-background/10 border-white/30 h-7 text-sm" autoFocus
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }} />
        }
        <span className="flex gap-1">
          <button aria-label="Remove" onClick={save} className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-0.5"><Check className="w-3 h-3" />Save</button>
          <button onClick={cancel} className="text-muted-foreground hover:text-muted-foreground text-xs flex items-center gap-0.5" aria-label="Remove"><X className="w-3 h-3" />Cancel</button>
        </span>
      </span>
    );
  }

  return (
    <span
      className={`group relative cursor-pointer hover:opacity-80 ${className}`}
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Click to edit"
    >
      {value || <span className="opacity-40 italic">{placeholder}</span>}
      <Pencil className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
    </span>
  );
}

// ── Default Content ────────────────────────────────────────────────────────
const DEFAULT = {
  headline: "Your Entire DPCO Business.\nOne Platform.",
  subheadline: "NDSEP is the only platform built exclusively for licensed Data Protection Compliance Organisations operating under the Nigeria Data Protection Act 2023. From accreditation to CAR filing — fully automated, AI-powered, and NDPC-integrated.",
  tagline: "Accredited. Automated. Authoritative.",
  modules: [
    { title: "Accreditation Management", desc: "Apply, renew, and manage your NDPC licence entirely within the platform. Automated reminders, document vault, and instant status updates." },
    { title: "Client Engagement Inbox", desc: "Receive and respond to engagement requests from regulated organisations. Accept or decline with a single click, with full audit trail." },
    { title: "Audit Workspace", desc: "8-stage pipeline from Initiated to CAR Filed. Assess all 15 NDPA 2023 controls, attach evidence, and generate findings reports in one place." },
    { title: "AI Gap Analysis", desc: "Paste evidence documents and let the AI pre-fill all 15 control ratings with rationale, confidence scores, and key findings — in seconds." },
    { title: "CAR Narrative Generator", desc: "Generate complete, NDPC-ready Compliance Audit Return narratives from control ratings. Formal regulatory language, ready to submit." },
    { title: "Risk Prediction Engine", desc: "AI-powered DCPMI risk scoring for every client. Predict audit priority, regulatory exposure, and recommended audit frequency automatically." },
    { title: "Evidence Vault", desc: "Secure, tagged evidence repository per engagement. Upload, categorise, and link documents directly to NDPA controls with one click." },
    { title: "Billing & Subscription", desc: "Stripe-powered invoicing, subscription management, and earnings dashboard. Track revenue per client and manage your DPCO business finances." },
  ],
  aiTitle: "AI & Automation — Not a Feature. The Foundation.",
  aiPoints: [
    { label: "AI Gap Analysis", detail: "Analyses evidence documents against all 15 NDPA 2023 controls and generates pre-filled ratings with rationale and confidence scores." },
    { label: "CAR Narrative Generation", detail: "Produces complete, NDPC-ready audit return narratives in formal regulatory language from control ratings — eliminating hours of manual writing." },
    { label: "DCPMI Risk Prediction", detail: "Scores every client against the Data Compliance Penalty Matrix Index, predicts audit priority, and estimates regulatory exposure." },
    { label: "Automated Notifications", detail: "Every pipeline stage transition, accreditation decision, and licence expiry triggers instant notifications — no manual follow-up required." },
    { label: "Licence Gate Enforcement", detail: "The platform automatically blocks CAR filing if your NDPC licence is expired or within 7 days of expiry, protecting both you and your clients." },
  ],
  tiers: [
    { name: "Starter", price: "₦150,000", period: "/year", highlight: false, cta: "Apply Now",
      features: ["Up to 5 active engagements", "All 15 NDPA controls", "Evidence Vault", "CAR filing", "Email support"] },
    { name: "Professional", price: "₦450,000", period: "/year", highlight: true, cta: "Apply Now",
      features: ["Up to 25 active engagements", "AI Gap Analysis", "CAR Narrative Generator", "Risk Prediction", "Priority support", "Client compliance dashboard"] },
    { name: "Enterprise", price: "Custom", period: "", highlight: false, cta: "Contact Us",
      features: ["Unlimited engagements", "All AI tools", "Dedicated account manager", "Custom integrations", "SLA guarantee", "NDPC liaison support"] },
  ],
  ctaTitle: "Ready to Transform Your DPCO Practice?",
  ctaBody: "Join the growing community of accredited DPCOs who manage their entire practice on NDSEP — the only platform purpose-built for Nigeria's data protection compliance ecosystem.",
  ctaButton: "Apply for Accreditation",
  ctaContact: "Questions? Contact us at dpco@ndpc.gov.ng",
};

export default function DpcoBrochure() {
  const [c, setC] = useState(DEFAULT);

  const updateModule = (i: number, field: "title" | "desc", val: string) => {
    const modules = [...c.modules];
    modules[i] = { ...modules[i], [field]: val };
    setC(prev => ({ ...prev, modules }));
  };

  const updateAiPoint = (i: number, field: "label" | "detail", val: string) => {
    const aiPoints = [...c.aiPoints];
    aiPoints[i] = { ...aiPoints[i], [field]: val };
    setC(prev => ({ ...prev, aiPoints }));
  };

  const updateTier = (i: number, field: "name" | "price" | "period", val: string) => {
    const tiers = [...c.tiers];
    tiers[i] = { ...tiers[i], [field]: val };
    setC(prev => ({ ...prev, tiers }));
  };

  return (
    <div className="min-h-screen bg-muted">
      {/* Editor Toolbar */}
      <div className="sticky top-0 z-50 bg-background border-b border-border px-6 py-2 flex items-center gap-3 shadow-sm print:hidden">
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-medium text-foreground">Brochure Editor</span>
          <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20 text-xs">Live Edit Mode</Badge>
        </div>
        <span className="text-xs text-muted-foreground ml-2">Click any text to edit it inline</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setC(DEFAULT); toast.success("Content reset to defaults"); }} className="text-xs h-7">
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="text-xs h-7 gap-1.5">
            <Printer className="w-3 h-3" /> Print / Save PDF
          </Button>
          <Button size="sm" onClick={() => window.open("/dpco/apply", "_blank")} className="text-xs h-7 bg-emerald-600 hover:bg-emerald-500 gap-1.5">
            <ExternalLink className="w-3 h-3" /> Apply for Accreditation
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto">
        {/* ── COVER PAGE ──────────────────────────────────────────────────── */}
        <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-foreground px-16 py-20 flex flex-col justify-between" style={{minHeight: 480}}>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <span className="text-emerald-400 font-bold text-sm">N</span>
            </div>
            <div>
              <p className="text-emerald-400 font-semibold text-sm tracking-wider uppercase">NDSEP</p>
              <p className="text-muted-foreground text-xs">National Data Sovereignty Enforcement Platform</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-muted-foreground text-xs">For Licensed DPCOs</p>
              <p className="text-muted-foreground text-xs">NDPA 2023 Compliant</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            <h1 className="text-5xl font-bold leading-tight mb-6 whitespace-pre-line">
              <EditableText value={c.headline} onChange={v => setC(p => ({ ...p, headline: v }))} multiline className="text-5xl font-bold" />
            </h1>
            <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mb-8">
              <EditableText value={c.subheadline} onChange={v => setC(p => ({ ...p, subheadline: v }))} multiline className="text-muted-foreground text-lg" />
            </p>
            <span className="text-emerald-400 font-semibold text-xl tracking-wide">
              <EditableText value={c.tagline} onChange={v => setC(p => ({ ...p, tagline: v }))} className="text-emerald-400 font-semibold text-xl" />
            </span>
          </div>

          <div className="mt-12 pt-8 border-t border-border/50 flex items-center gap-6">
            {["NDPC-Integrated", "AI-Powered", "Production-Ready", "NDPA 2023"].map(tag => (
              <span key={tag} className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />{tag}
              </span>
            ))}
          </div>
        </section>

        {/* ── PLATFORM MODULES ────────────────────────────────────────────── */}
        <section className="bg-background px-16 py-14">
          <h2 className="text-2xl font-bold text-foreground mb-2">Everything You Need. Nothing You Don't.</h2>
          <p className="text-muted-foreground text-sm mb-10">Eight purpose-built modules covering the complete DPCO business lifecycle.</p>
          <div className="grid grid-cols-2 gap-6">
            {c.modules.map((m, i) => (
              <div key={i} className="border border-border rounded-xl p-5 hover:border-emerald-500/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-emerald-600 font-bold text-xs">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-sm mb-1">
                      <EditableText value={m.title} onChange={v => updateModule(i, "title", v)} className="font-semibold text-foreground text-sm" />
                    </h3>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      <EditableText value={m.desc} onChange={v => updateModule(i, "desc", v)} multiline className="text-muted-foreground text-xs" />
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── AI & AUTOMATION ─────────────────────────────────────────────── */}
        <section className="bg-background text-foreground px-16 py-14">
          <h2 className="text-2xl font-bold mb-2">
            <EditableText value={c.aiTitle} onChange={v => setC(p => ({ ...p, aiTitle: v }))} className="text-2xl font-bold" />
          </h2>
          <p className="text-muted-foreground text-sm mb-10">Every AI feature is live, tested, and backed by the NDSEP Intelligence Engine.</p>
          <div className="space-y-4">
            {c.aiPoints.map((p, i) => (
              <div key={i} className="flex gap-4 bg-card/60 border border-border/50 rounded-xl p-5">
                <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                  <span className="text-violet-400 font-bold text-xs">{String.fromCharCode(65 + i)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground text-sm mb-1">
                    <EditableText value={p.label} onChange={v => updateAiPoint(i, "label", v)} className="font-semibold text-foreground text-sm" />
                  </h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    <EditableText value={p.detail} onChange={v => updateAiPoint(i, "detail", v)} multiline className="text-muted-foreground text-xs" />
                  </p>
                </div>
                <div className="shrink-0">
                  <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">Live</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── PRICING ─────────────────────────────────────────────────────── */}
        <section className="bg-background px-16 py-14">
          <h2 className="text-2xl font-bold text-foreground mb-2">Transparent Pricing. No Hidden Fees.</h2>
          <p className="text-muted-foreground text-sm mb-10">Choose the tier that matches your practice size. All tiers include NDPC integration and full audit trail.</p>
          <div className="grid grid-cols-3 gap-6">
            {c.tiers.map((tier, i) => (
              <div key={i} className={`rounded-xl border-2 p-6 flex flex-col ${tier.highlight ? "border-emerald-500 bg-emerald-50" : "border-border bg-background"}`}>
                <div className="mb-4">
                  <h3 className="font-bold text-foreground text-lg">
                    <EditableText value={tier.name} onChange={v => updateTier(i, "name", v)} className="font-bold text-foreground text-lg" />
                  </h3>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold text-foreground">
                      <EditableText value={tier.price} onChange={v => updateTier(i, "price", v)} className="text-3xl font-bold text-foreground" />
                    </span>
                    <span className="text-muted-foreground text-sm">
                      <EditableText value={tier.period} onChange={v => updateTier(i, "period", v)} className="text-muted-foreground text-sm" />
                    </span>
                  </div>
                </div>
                {tier.highlight && <Badge className="mb-4 w-fit bg-emerald-500 text-foreground border-0 text-xs">Most Popular</Badge>}
                <ul className="space-y-2 flex-1 mb-6">
                  {tier.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => window.open("/dpco/apply", "_blank")}
                  className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${tier.highlight ? "bg-emerald-600 text-foreground hover:bg-emerald-500" : "bg-background text-foreground hover:bg-muted"}`}
                >
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <section className="bg-gradient-to-br from-emerald-900 via-slate-900 to-slate-950 text-foreground px-16 py-16 text-center">
          <h2 className="text-3xl font-bold mb-4">
            <EditableText value={c.ctaTitle} onChange={v => setC(p => ({ ...p, ctaTitle: v }))} className="text-3xl font-bold" />
          </h2>
          <p className="text-muted-foreground text-base max-w-2xl mx-auto mb-8 leading-relaxed">
            <EditableText value={c.ctaBody} onChange={v => setC(p => ({ ...p, ctaBody: v }))} multiline className="text-muted-foreground text-base" />
          </p>
          <button
            onClick={() => window.open("/dpco/apply", "_blank")}
            className="bg-emerald-500 hover:bg-emerald-400 text-foreground font-semibold px-8 py-3 rounded-xl text-sm transition-colors mb-4 block mx-auto"
          >
            <EditableText value={c.ctaButton} onChange={v => setC(p => ({ ...p, ctaButton: v }))} className="text-foreground font-semibold" />
          </button>
          <p className="text-muted-foreground text-xs">
            <EditableText value={c.ctaContact} onChange={v => setC(p => ({ ...p, ctaContact: v }))} className="text-muted-foreground text-xs" />
          </p>
          <div className="mt-12 pt-8 border-t border-border/50 flex items-center justify-center gap-8">
            {[
              { num: "15", label: "NDPA Controls" },
              { num: "8", label: "Pipeline Stages" },
              { num: "3", label: "AI Tools" },
              { num: "100%", label: "NDPC-Integrated" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-2xl font-bold text-emerald-400">{s.num}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { background: white; }
          section { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
