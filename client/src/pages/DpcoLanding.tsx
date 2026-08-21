import { Link } from "wouter";
import { useState } from "react";
import {
  ShieldCheck, Zap, Brain, BarChart3, FileText, Users, Award, Clock,
  CheckCircle, ArrowRight, Star, Globe, Lock, TrendingUp, ChevronRight,
  Search, MapPin, Building2, Send, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const MODULES = [
  { icon: Award, title: "Accreditation Management", desc: "Apply, renew, and manage your NDPC licence entirely within the platform. Automated reminders, document vault, and instant status tracking." },
  { icon: Users, title: "Client Engagement Inbox", desc: "Receive and respond to engagement requests from regulated organisations. Accept with one click and an audit engagement is automatically created." },
  { icon: FileText, title: "Audit Workspace", desc: "8-stage pipeline from Initiated to CAR Filed. Assess all 15 NDPA 2023 controls, manage evidence, and generate your Compliance Audit Return." },
  { icon: Brain, title: "AI Audit Tools", desc: "AI-powered gap analysis, CAR narrative generation, and risk prediction. Generate a full compliance narrative in seconds from your control ratings." },
  { icon: BarChart3, title: "Client Compliance Dashboard", desc: "Real-time compliance posture for every client. Track findings, remediation progress, and certificate status across your entire portfolio." },
  { icon: Lock, title: "Evidence Vault", desc: "Centralised document repository with control tagging, version history, and tamper-evident audit trail for every piece of evidence." },
  { icon: Globe, title: "DPCO Registry Profile", desc: "Your public-facing profile on the NDPC DPCO Registry — visible to thousands of regulated organisations searching for an accredited auditor." },
  { icon: TrendingUp, title: "Performance Scorecard", desc: "Public performance metrics — CAR acceptance rate, average audit cycle, and client improvement rate — to build trust and win new business." },
];

const AI_FEATURES = [
  { title: "AI Gap Analysis", desc: "Upload a client's ROPA and privacy policy. The AI maps gaps against all 15 NDPA controls in under 60 seconds." },
  { title: "CAR Narrative Generator", desc: "Select your control ratings and the AI writes a complete, professional CAR narrative ready for NDPC submission." },
  { title: "Risk Prediction Engine", desc: "Predict which clients are at highest risk of non-compliance before the audit begins, using DCPMI scoring and sector benchmarks." },
  { title: "Automated Pipeline Notifications", desc: "Every stage transition triggers automatic notifications to your client, keeping them informed without manual follow-up." },
];

const TIERS = [
  {
    name: "Starter",
    price: "₦150,000",
    period: "/year",
    desc: "For newly accredited DPCOs",
    features: ["Up to 5 active audit engagements", "Full Audit Workspace access", "Evidence Vault (5GB)", "CAR filing", "Basic client dashboard"],
    cta: "Apply for Accreditation",
    highlight: false,
  },
  {
    name: "Professional",
    price: "₦450,000",
    period: "/year",
    desc: "For growing DPCO practices",
    features: ["Up to 25 active engagements", "AI Gap Analysis & CAR Narrative", "Evidence Vault (50GB)", "Performance Scorecard", "Priority NDPC support channel", "Client portal access"],
    cta: "Get Started",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For large multi-sector DPCOs",
    features: ["Unlimited engagements", "Full AI suite + Risk Prediction", "Unlimited Evidence Vault", "Dedicated account manager", "White-label client portal", "API access"],
    cta: "Contact NDPC",
    highlight: false,
  },
];

const STATS = [
  { value: "15", label: "NDPA 2023 Controls" },
  { value: "8", label: "Audit Pipeline Stages" },
  { value: "< 60s", label: "AI Gap Analysis Time" },
  { value: "100%", label: "Digital — No Paper" },
];

const SECTORS = ["All Sectors", "Financial Services", "Telecoms", "Health", "Technology", "Education", "Government", "Retail", "Energy", "Media"];

function DpcoSearchWidget() {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [query, setQuery] = useState<{ search?: string; sector?: string } | null>(null);
  const [selectedDpco, setSelectedDpco] = useState<any>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("");

  const { data: results, isLoading } = trpc.accreditation.publicListDpcos.useQuery(
    query ?? undefined,
    { enabled: query !== null }
  );

  const sendRequest = trpc.dpco.submitEngagementRequest.useMutation({
    onSuccess: () => {
      setRequestSent(true);
    },
  });

  const handleSearch = () => {
    setQuery({ search: search || undefined, sector: (sector && sector !== "All Sectors") ? sector : undefined });
  };

  if (selectedDpco) {
    if (requestSent) {
      return (
        <div className="max-w-lg mx-auto text-center py-10">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-emerald-600" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Engagement Request Sent</h3>
          <p className="text-sm text-muted-foreground mb-4">Your request has been sent to <strong>{selectedDpco.name}</strong>. They will review and respond within 2 business days.</p>
          <Button variant="outline" size="sm" onClick={() => { setSelectedDpco(null); setRequestSent(false); setOrgName(""); setContactEmail(""); setMessage(""); }}>
            Find Another DPCO
          </Button>
        </div>
      );
    }
    return (
      <div className="max-w-lg mx-auto">
        <button onClick={() => setSelectedDpco(null)} className="text-xs text-emerald-600 hover:underline mb-4 flex items-center gap-1">
          ← Back to results
        </button>
        <div className="bg-muted/50 rounded-xl border border-border p-5 mb-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-700 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">{selectedDpco.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Licence: {selectedDpco.licenceNumber ?? "Active"}</p>
              {selectedDpco.sectors && <p className="text-xs text-emerald-600 mt-1">{selectedDpco.sectors}</p>}
            </div>
            <span className="ml-auto text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium capitalize">{selectedDpco.tier}</span>
          </div>
        </div>
        <h4 className="text-sm font-semibold text-foreground mb-3">Send Engagement Request</h4>
        <div className="space-y-3">
          <Input placeholder="Your organisation name *" value={orgName} onChange={e => setOrgName(e.target.value)} className="text-sm h-9" />
          <Input placeholder="Contact email *" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="text-sm h-9" />
          <textarea
            placeholder="Brief description of your data processing activities and audit scope..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
          <Button
            className="w-full bg-emerald-700 hover:bg-emerald-800 text-foreground text-sm h-9"
            disabled={!orgName || !contactEmail || sendRequest.isPending}
            onClick={() => sendRequest.mutate({
              dpcoOrgId: selectedDpco.id,
              orgName,
              contactName: orgName,
              contactEmail,
              auditScope: message || "General NDPA compliance audit",
              preferredStartDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            })}
          >
            {sendRequest.isPending ? "Sending..." : <><Send className="w-3.5 h-3.5 mr-1.5" /> Send Engagement Request</>}
          </Button>
          {sendRequest.error && <p className="text-xs text-red-500">{sendRequest.error.message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-3 mb-6 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by DPCO name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            className="pl-9 text-sm h-10"
          />
        </div>
        <select
          value={sector}
          onChange={e => setSector(e.target.value)}
          className="rounded-md border border-border bg-background px-3 text-sm text-muted-foreground h-10 focus-visible:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {SECTORS.map(s => <option key={s} value={s === "All Sectors" ? "" : s}>{s}</option>)}
        </select>
        <Button onClick={handleSearch} className="bg-emerald-700 hover:bg-emerald-800 text-foreground text-sm h-10 px-5">
          Search
        </Button>
      </div>

      {query === null && (
        <div className="text-center py-10 text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Search for an accredited DPCO by name or sector</p>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500 mx-auto" />
        </div>
      )}

      {results && results.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <p className="text-sm">No accredited DPCOs found matching your search.</p>
        </div>
      )}

      {results && results.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {results.map(dpco => (
            <div key={dpco.id} className="bg-background rounded-xl border border-border p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-700 flex items-center justify-center">
                  <Building2 className="w-4.5 h-4.5 text-foreground" />
                </div>
                <span className="text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium capitalize">{dpco.tier}</span>
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">{dpco.name}</h3>
              {dpco.sectors && (
                <p className="text-xs text-emerald-600 mb-3 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {dpco.sectors.split(",").slice(0, 2).join(", ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground mb-4">Licence: {dpco.licenceNumber ?? "Active"}</p>
              <Button
                size="sm"
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-foreground text-xs h-8"
                onClick={() => setSelectedDpco(dpco)}
              >
                Send Engagement Request
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DpcoLanding() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-700 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-foreground" />
            </div>
            <span className="font-bold text-foreground text-sm">NDSEP</span>
            <span className="text-muted-foreground text-sm mx-1">|</span>
            <span className="text-muted-foreground text-sm">DPCO Platform</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#modules" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#ai" className="text-sm text-muted-foreground hover:text-foreground transition-colors">AI Tools</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
            <Link href="/dpco/apply">
              <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-foreground text-xs h-8">
                Apply for Accreditation
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-20 bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 30% 50%, #10b981 0%, transparent 60%), radial-gradient(circle at 70% 20%, #d97706 0%, transparent 50%)" }} />
        <div className="max-w-5xl mx-auto px-6 relative z-10">
          <div className="inline-flex items-center gap-2 bg-emerald-900/50 border border-emerald-700/50 rounded-full px-3 py-1 text-xs text-emerald-300 mb-6">
            <Star className="w-3 h-3 fill-emerald-400 text-emerald-400" />
            Official NDPC-Authorised DPCO Management Platform
          </div>
          <h1 className="text-5xl font-bold leading-tight mb-4 max-w-3xl">
            Your Entire DPCO Business.<br />
            <span className="text-emerald-400">One Platform.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mb-8 leading-relaxed">
            NDSEP is the only platform purpose-built for Nigeria Data Protection Compliance Organisations.
            From NDPC accreditation to CAR filing — with AI that does the heavy lifting.
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <Link href="/dpco/apply">
              <Button className="bg-emerald-500 hover:bg-emerald-400 text-foreground font-semibold px-6 h-11 text-sm">
                Apply for Accreditation <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link href="/dpco-brochure">
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-card h-11 text-sm">
                View Full Brochure
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-6 mt-14 pt-10 border-t border-border/50">
            {STATS.map(s => (
              <div key={s.label}>
                <p className="text-3xl font-bold text-emerald-400">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="py-20 bg-muted/50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-3">Everything a DPCO Needs</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-sm">
              Eight integrated modules covering the complete DPCO lifecycle — no third-party tools required.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-5">
            {MODULES.map(m => (
              <div key={m.title} className="bg-background rounded-xl border border-border p-5 hover:shadow-md transition-shadow">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center mb-3">
                  <m.icon className="w-4.5 h-4.5 text-emerald-700" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{m.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Section */}
      <section id="ai" className="py-20 bg-gradient-to-br from-slate-900 to-emerald-950 text-foreground">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-emerald-900/50 border border-emerald-700/40 rounded-full px-3 py-1 text-xs text-emerald-300 mb-5">
                <Zap className="w-3 h-3" /> AI-Powered Compliance
              </div>
              <h2 className="text-3xl font-bold mb-4">Automation & AI That Actually Works</h2>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                NDSEP's AI engine is trained on the NDPA 2023 framework and NDPC guidance notes.
                It doesn't just assist — it accelerates every stage of the audit lifecycle.
              </p>
              <Link href="/dpco/ai-tools">
                <Button className="bg-emerald-500 hover:bg-emerald-400 text-foreground text-sm h-9">
                  Explore AI Tools <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
            <div className="space-y-4">
              {AI_FEATURES.map(f => (
                <div key={f.title} className="flex gap-4 bg-card/50 border border-border/50 rounded-xl p-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-700/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Brain className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">{f.title}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-background">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-3">How DPCOs Onboard</h2>
            <p className="text-muted-foreground text-sm max-w-xl mx-auto">From application to first CAR filing in 4 steps</p>
          </div>
          <div className="grid grid-cols-4 gap-6">
            {[
              { step: "01", title: "Apply for Accreditation", desc: "Submit your NDPC accreditation application with entity details, auditor CVs, and supporting documents through the platform." },
              { step: "02", title: "NDPC Review & Approval", desc: "The NDPC reviews your application, conducts due diligence, and issues your licence number — all tracked in real time." },
              { step: "03", title: "Activate Your Account", desc: "Your DPCO profile goes live on the NDSEP Registry. Regulated organisations can find you and send engagement requests." },
              { step: "04", title: "Start Auditing", desc: "Accept engagement requests, work through the 8-stage audit pipeline, and file CARs directly with the NDPC." },
            ].map(s => (
              <div key={s.step} className="relative">
                <div className="text-4xl font-black text-emerald-100 mb-3">{s.step}</div>
                <h3 className="text-sm font-semibold text-foreground mb-2">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DPCO Registry Search */}
      <section id="find-dpco" className="py-20 bg-background border-t border-border">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-foreground mb-3">Find an Accredited DPCO</h2>
            <p className="text-muted-foreground text-sm max-w-xl mx-auto">
              Browse NDPC-accredited DPCOs and send an engagement request directly from this page.
            </p>
          </div>
          <DpcoSearchWidget />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 bg-muted/50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-3">Subscription Tiers</h2>
            <p className="text-muted-foreground text-sm max-w-xl mx-auto">Choose the plan that matches your practice size</p>
          </div>
          <div className="grid grid-cols-3 gap-6">
            {TIERS.map(t => (
              <div key={t.name} className={`rounded-2xl border p-6 flex flex-col ${t.highlight ? "border-emerald-500 bg-emerald-700 text-foreground shadow-xl shadow-emerald-900/20" : "border-border bg-background"}`}>
                <div className="mb-4">
                  <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${t.highlight ? "text-emerald-200" : "text-emerald-600"}`}>{t.name}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-3xl font-black">{t.price}</span>
                    <span className={`text-sm mb-1 ${t.highlight ? "text-emerald-200" : "text-muted-foreground"}`}>{t.period}</span>
                  </div>
                  <p className={`text-xs mt-1 ${t.highlight ? "text-emerald-200" : "text-muted-foreground"}`}>{t.desc}</p>
                </div>
                <ul className="space-y-2.5 flex-1 mb-6">
                  {t.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-xs">
                      <CheckCircle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${t.highlight ? "text-emerald-300" : "text-emerald-500"}`} />
                      <span className={t.highlight ? "text-emerald-50" : "text-muted-foreground"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/dpco/apply">
                  <Button className={`w-full text-sm h-9 ${t.highlight ? "bg-background text-emerald-700 hover:bg-emerald-50" : "bg-emerald-700 hover:bg-emerald-800 text-foreground"}`}>
                    {t.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-emerald-700 text-foreground text-center">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl font-bold mb-4">Ready to Manage Your DPCO Practice on NDSEP?</h2>
          <p className="text-emerald-100 text-sm mb-8 leading-relaxed">
            Join accredited DPCOs already using NDSEP to manage their entire compliance practice —
            from accreditation to CAR filing — in one place.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/dpco/apply">
              <Button className="bg-background text-emerald-700 hover:bg-emerald-50 font-semibold px-8 h-11 text-sm">
                Apply for Accreditation <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link href="/accreditation/status">
              <Button variant="outline" className="border-emerald-400 text-foreground hover:bg-emerald-600 h-11 text-sm">
                Check Application Status
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-background text-muted-foreground py-8 text-center text-xs">
        <p>© 2026 Nigeria Data Protection Commission (NDPC) · National Data Sovereignty Enforcement Platform (NDSEP)</p>
        <p className="mt-1">Regulated under the Nigeria Data Protection Act 2023 · All DPCO accreditations are subject to NDPC approval</p>
      </footer>
    </div>
  );
}
