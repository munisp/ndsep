import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  BookOpen, Search, PlayCircle, CheckCircle, Circle, ChevronRight,
  Clock, Star, Award, Shield, FileText, AlertTriangle, Building2,
  BarChart3, Settings, Lock, Zap, Globe, HelpCircle, Video,
  ArrowRight, ChevronDown, ChevronUp, Bookmark
} from "lucide-react";
import { useLocation } from "wouter";

// ── Tutorial definitions ──────────────────────────────────────────────────────
const TUTORIALS = [
  {
    id: "getting-started",
    title: "Getting Started with NDSEP",
    description: "Learn the basics of the National Data Sovereignty Enforcement Platform",
    duration: "5 min",
    difficulty: "Beginner",
    category: "Onboarding",
    icon: Globe,
    color: "text-blue-500",
    bgColor: "bg-blue-50",
    steps: [
      { title: "Platform Overview", content: "NDSEP is Nigeria's central compliance enforcement platform covering 6 regulated sectors: Banking (CBN), Telecom (NCC), Healthcare (NHIA), Energy (NERC), Insurance (NAICOM), and Fintech (CBN). Navigate using the left sidebar — each sector has its own module.", action: "Explore the sidebar" },
      { title: "Your Dashboard", content: "The My Dashboard page (/my-dashboard) lets you customise which compliance metrics you see. Add widgets for breach counts, compliance scores, deadlines, and more. Click 'Edit Layout' to start customising.", action: "Go to My Dashboard", route: "/my-dashboard" },
      { title: "Organisation Registry", content: "All regulated organisations are listed in the Organisation Registry. You can search by sector, compliance status, or registration number. Each org has a full compliance profile.", action: "View Registry", route: "/organizations" },
      { title: "Getting Help", content: "Use the Support Chat (/support-chat) for instant AI-powered assistance. For urgent breach notifications, use the Breach Incident Center (/breach-incidents).", action: "Open Support Chat", route: "/support-chat" },
    ]
  },
  {
    id: "ndpa-compliance",
    title: "NDPA Compliance Workflow",
    description: "Master the Nigeria Data Protection Act compliance lifecycle",
    duration: "12 min",
    difficulty: "Intermediate",
    category: "NDPA",
    icon: Shield,
    color: "text-green-500",
    bgColor: "bg-green-50",
    steps: [
      { title: "Understanding NDPA", content: "The Nigeria Data Protection Act 2023 (NDPA) requires all data controllers and processors to register with the NDPC, appoint a DPO (if processing >10,000 records), maintain a ROPA, and notify breaches within 72 hours.", action: "Read NDPA Summary" },
      { title: "Consent Management", content: "Navigate to Consent Records (/consent-records) to manage data subject consents. Each consent must specify: purpose, legal basis, data categories, retention period, and withdrawal mechanism.", action: "Open Consent Records", route: "/consent-records" },
      { title: "Breach Notification", content: "When a breach occurs, go to Breach Incident Center (/breach-incidents) and click 'Report Breach'. The 72-hour NDPC notification clock starts immediately. The Article 40 Tracker shows live countdowns.", action: "Open Breach Center", route: "/breach-incidents" },
      { title: "DSAR Management", content: "Data Subject Access Requests must be responded to within 30 days. Navigate to the DSAR Portal to track all requests, assign handlers, and generate responses.", action: "Open DSAR Portal", route: "/dsar-portal" },
      { title: "Annual Audit Return", content: "All NDPA-licensed entities must submit an Annual Audit Return by 15 March each year. Use the PDF Export Center to generate the return in the NDPC-approved format.", action: "Open PDF Export", route: "/pdf-export" },
    ]
  },
  {
    id: "breach-response",
    title: "Breach Response Playbook",
    description: "Step-by-step guide to handling a data breach under NDPA",
    duration: "8 min",
    difficulty: "Intermediate",
    category: "Incident Response",
    icon: AlertTriangle,
    color: "text-red-500",
    bgColor: "bg-red-50",
    steps: [
      { title: "Detect & Contain", content: "Immediately isolate affected systems. Document: what data was affected, how many records, the likely cause, and the timeline. Assign an Incident Commander.", action: "Start Incident Log" },
      { title: "Assess Severity", content: "Use the Risk Scorecard (/risk-scorecard) to assess the severity. High-risk breaches (involving sensitive personal data, financial data, or >1,000 records) require mandatory NDPC notification.", action: "Open Risk Scorecard", route: "/risk-scorecard" },
      { title: "Report the Breach", content: "Go to Breach Incident Center → 'Report Breach'. Fill in all required fields. The system automatically starts the 72-hour notification countdown and creates an Article 40 tracker entry.", action: "Report Breach", route: "/breach-incidents" },
      { title: "Notify NDPC", content: "The Article 40 Tracker (/article-40-tracker) shows your countdown. Click 'Notify NDPC' to send the formal notification via the platform. This logs the timestamp and generates a reference number.", action: "Open Article 40 Tracker", route: "/article-40-tracker" },
      { title: "Notify Affected Subjects", content: "If the breach poses high risk to individuals, you must also notify affected data subjects without undue delay. Use the SMS Alerts (/sms-alerts) module to send bulk notifications.", action: "Open SMS Alerts", route: "/sms-alerts" },
    ]
  },
  {
    id: "banking-supervision",
    title: "Banking Sector Supervision",
    description: "CBN data sovereignty requirements for financial institutions",
    duration: "10 min",
    difficulty: "Advanced",
    category: "Banking",
    icon: Building2,
    color: "text-indigo-500",
    bgColor: "bg-indigo-50",
    steps: [
      { title: "CBN Data Localisation", content: "CBN Circular BSD/DIR/CON/LAB/14/052 requires all customer financial data to be stored on servers physically located in Nigeria. The Banking Dashboard shows localisation compliance by institution.", action: "Open Banking Dashboard", route: "/banking" },
      { title: "NIP/RTGS Monitoring", content: "Real-time NIP and RTGS transaction monitoring is available in the Banking Dashboard. Suspicious patterns trigger automatic alerts. Volume spikes >3σ from the 30-day mean are flagged.", action: "View NIP Monitoring", route: "/banking" },
      { title: "KYC Compliance", content: "All Tier 2 and Tier 3 accounts require full KYC. The KYC Compliance module tracks completion rates by institution. Non-compliant accounts are automatically flagged for remediation.", action: "View KYC Status", route: "/banking" },
      { title: "Fraud Detection", content: "The Fraud Detection module uses ML-based anomaly detection on transaction patterns. Alerts are generated in real time and routed to the relevant institution's compliance officer.", action: "View Fraud Alerts", route: "/banking" },
    ]
  },
  {
    id: "dpco-certification",
    title: "DPCO Certification Process",
    description: "How to obtain and maintain NDPC Data Protection Compliance Organisation status",
    duration: "7 min",
    difficulty: "Intermediate",
    category: "DPCO",
    icon: Award,
    color: "text-yellow-500",
    bgColor: "bg-yellow-50",
    steps: [
      { title: "DPCO Requirements", content: "To become a licensed DPCO under NDPA Section 33, your organisation must: have at least 2 certified DPOs, demonstrate 3+ years of data protection practice, and pass the NDPC competency assessment.", action: "View DPCO Requirements" },
      { title: "Apply for Certification", content: "Go to DPCO (/dpco) and click 'New Application'. Upload your evidence documents, list your certified DPOs, and submit your portfolio. The NDPC reviews applications within 30 working days.", action: "Open DPCO Portal", route: "/dpco" },
      { title: "DPO Registration", content: "All DPOs must be registered in the DPO Registry (/dpo-registry). Each DPO needs: name, credentials, contact details, and the organisations they serve. Maximum 10 organisations per DPO.", action: "Open DPO Registry", route: "/dpo-registry" },
      { title: "Certificate Verification", content: "Use Certificate Verification (/cert-verification) to issue and verify compliance certificates. Certificates are QR-code enabled and can be verified by third parties via the public registry.", action: "Open Cert Verification", route: "/cert-verification" },
    ]
  },
  {
    id: "admin-guide",
    title: "Platform Administration",
    description: "Managing users, roles, and system configuration",
    duration: "6 min",
    difficulty: "Advanced",
    category: "Administration",
    icon: Settings,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    steps: [
      { title: "User Management", content: "Admin users can manage all platform users at Admin → User Management (/admin/users). You can promote users to admin, deactivate accounts, and view login history.", action: "Open User Management", route: "/admin/users" },
      { title: "API Keys", content: "External systems can integrate with NDSEP via the REST API. Manage API keys at API Key Management (/api-keys). Each key has configurable scopes and rate limits.", action: "Open API Keys", route: "/api-keys" },
      { title: "Webhook Delivery", content: "Configure webhooks to receive real-time notifications when breaches are reported, penalties are issued, or compliance scores change. Manage at Webhook Delivery (/webhook-delivery).", action: "Open Webhooks", route: "/webhook-delivery" },
      { title: "System Health", content: "Monitor platform health at System Health Dashboard (/admin/system-health). View worker status, database metrics, and API response times.", action: "Open System Health", route: "/admin/system-health" },
    ]
  },
];

const DOCS = [
  { title: "NDPA 2023 Full Text", description: "Nigeria Data Protection Act 2023 — complete legislation", category: "Legal", icon: FileText, url: "https://ndpc.gov.ng/NDPA_2023.pdf" },
  { title: "NDPR Implementation Framework", description: "NITDA's implementation framework for data protection", category: "Legal", icon: FileText, url: "https://nitda.gov.ng/ndpr" },
  { title: "CBN Data Localisation Circular", description: "CBN BSD/DIR/CON/LAB/14/052 — financial data localisation", category: "Banking", icon: Building2, url: "#" },
  { title: "DPCO Licensing Guidelines", description: "NDPC guidelines for Data Protection Compliance Organisations", category: "DPCO", icon: Award, url: "#" },
  { title: "Breach Notification Template", description: "NDPC-approved breach notification letter template", category: "Templates", icon: AlertTriangle, url: "#" },
  { title: "DSAR Response Template", description: "Standard template for responding to Data Subject Access Requests", category: "Templates", icon: FileText, url: "#" },
  { title: "ROPA Template", description: "Record of Processing Activities template (NDPA Schedule 1)", category: "Templates", icon: BarChart3, url: "#" },
  { title: "API Documentation", description: "NDSEP REST API reference for external integrations", category: "Technical", icon: Zap, url: "#" },
];

// ── Tutorial Card ─────────────────────────────────────────────────────────────
function TutorialCard({ tutorial, progress, onStart }: {
  tutorial: typeof TUTORIALS[0];
  progress: number;
  onStart: (id: string) => void;
}) {
  const Icon = tutorial.icon;
  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onStart(tutorial.id)}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg ${tutorial.bgColor} flex items-center justify-center shrink-0`}>
            <Icon className={`h-5 w-5 ${tutorial.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-medium text-sm truncate">{tutorial.title}</h3>
              {progress === 100 && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
            </div>
            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{tutorial.description}</p>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-xs">{tutorial.category}</Badge>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> {tutorial.duration}
              </span>
              <span className="text-xs text-muted-foreground">{tutorial.difficulty}</span>
            </div>
            {progress > 0 && (
              <div className="space-y-1">
                <Progress value={progress} className="h-1" />
                <p className="text-xs text-muted-foreground">{progress}% complete</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tutorial Viewer ───────────────────────────────────────────────────────────
function TutorialViewer({ tutorial, onClose, onComplete }: {
  tutorial: typeof TUTORIALS[0];
  onClose: () => void;
  onComplete: (id: string, step: number) => void;
}) {
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const step = tutorial.steps[currentStep];
  const isLast = currentStep === tutorial.steps.length - 1;

  const handleNext = () => {
    onComplete(tutorial.id, currentStep + 1);
    if (isLast) { onClose(); toast.success(`Tutorial complete: ${tutorial.title}!`); }
    else setCurrentStep(s => s + 1);
  };

  const Icon = tutorial.icon;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg ${tutorial.bgColor} flex items-center justify-center`}>
                <Icon className={`h-4 w-4 ${tutorial.color}`} />
              </div>
              <div>
                <CardTitle className="text-base">{tutorial.title}</CardTitle>
                <p className="text-xs text-muted-foreground">Step {currentStep + 1} of {tutorial.steps.length}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
          </div>
          <Progress value={((currentStep + 1) / tutorial.steps.length) * 100} className="h-1 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">{step.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{step.content}</p>
          </div>
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={() => setCurrentStep(s => Math.max(0, s - 1))} disabled={currentStep === 0}>
              Back
            </Button>
            <div className="flex gap-1">
              {tutorial.steps.map((_, i) => (
                <button key={i} onClick={() => setCurrentStep(i)} className={`w-2 h-2 rounded-full transition-colors ${i === currentStep ? "bg-primary" : i < currentStep ? "bg-primary/40" : "bg-muted"}`} />
              ))}
            </div>
            <div className="flex gap-2">
              {step.route && (
                <Button variant="outline" size="sm" onClick={() => { navigate(step.route!); onClose(); }}>
                  {step.action} <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              )}
              <Button size="sm" onClick={handleNext}>
                {isLast ? "Complete" : "Next"} <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UserGuide() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeTutorial, setActiveTutorial] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [tutorialProgress, setTutorialProgress] = useState<Record<string, number>>({});

  const { data: progressData } = trpc.tutorial.getProgress.useQuery();
  const markComplete = trpc.tutorial.completeStep.useMutation();

  // Load saved progress
  const savedProgress: Record<string, number> = {};
  if (progressData) {
    for (const [tutorialId, steps] of Object.entries(progressData as Record<string, Record<string, { completed: boolean }>>)) {
      const tutorial = TUTORIALS.find(t => t.id === tutorialId);
      if (!tutorial) continue;
      const completedSteps = Object.values(steps).filter((s: any) => s.completed).length;
      savedProgress[tutorialId] = Math.round((completedSteps / tutorial.steps.length) * 100);
    }
  }

  const progress = { ...savedProgress, ...tutorialProgress };

  const handleComplete = (tutorialId: string, step: number) => {
    const tutorial = TUTORIALS.find(t => t.id === tutorialId);
    if (!tutorial) return;
    const pct = Math.round((step / tutorial.steps.length) * 100);
    setTutorialProgress(prev => ({ ...prev, [tutorialId]: pct }));
    markComplete.mutate({ tutorialId, stepId: `step-${step}` });
  };

  const categories = ["All", ...Array.from(new Set(TUTORIALS.map(t => t.category)))];
  const filteredTutorials = TUTORIALS.filter(t => {
    const matchCat = activeCategory === "All" || t.category === activeCategory;
    const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const filteredDocs = DOCS.filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.description.toLowerCase().includes(search.toLowerCase())
  );

  const completedCount = Object.values(progress).filter(v => v === 100).length;
  const activeTutorialData = TUTORIALS.find(t => t.id === activeTutorial);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-blue-500" />
              User Guide & Tutorials
            </h1>
            <p className="text-muted-foreground text-sm">Interactive tutorials, documentation, and compliance playbooks</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-500">{completedCount}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{TUTORIALS.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tutorials, guides, and documentation..."
            className="pl-10"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Quick start banner */}
        {completedCount === 0 && (
          <Card className="border-blue-500/20 bg-blue-50/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PlayCircle className="h-8 w-8 text-blue-500" />
                  <div>
                    <p className="font-medium">New to NDSEP?</p>
                    <p className="text-sm text-muted-foreground">Start with the "Getting Started" tutorial — it takes just 5 minutes</p>
                  </div>
                </div>
                <Button onClick={() => setActiveTutorial("getting-started")}>
                  Start Tutorial <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tutorials Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Interactive Tutorials</h2>
            <div className="flex gap-2">
              {categories.map(cat => (
                <Button
                  key={cat}
                  variant={activeCategory === cat ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveCategory(cat)}
                  className="text-xs"
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTutorials.map(tutorial => (
              <TutorialCard
                key={tutorial.id}
                tutorial={tutorial}
                progress={progress[tutorial.id] ?? 0}
                onStart={setActiveTutorial}
              />
            ))}
          </div>
        </div>

        {/* Documentation Section */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Reference Documentation</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredDocs.map(doc => {
              const Icon = doc.icon;
              const isExpanded = expandedDoc === doc.title;
              return (
                <Card key={doc.title} className="cursor-pointer hover:shadow-sm transition-shadow">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between" onClick={() => setExpandedDoc(isExpanded ? null : doc.title)}>
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{doc.title}</p>
                          <p className="text-xs text-muted-foreground">{doc.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{doc.category}</Badge>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t flex gap-2">
                        {doc.url !== "#" ? (
                          <Button size="sm" variant="outline" onClick={() => window.open(doc.url, "_blank")}>
                            <FileText className="h-3 w-3 mr-1" /> Open Document
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => toast.info("Document available after publishing")}>
                            <Bookmark className="h-3 w-3 mr-1" /> View in Platform
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* FAQ Section */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {[
              { q: "What is the 72-hour breach notification rule?", a: "Under NDPA Section 40, data controllers must notify the NDPC within 72 hours of becoming aware of a personal data breach that poses a risk to individuals' rights and freedoms. The notification must include: nature of the breach, categories and approximate number of affected individuals, likely consequences, and measures taken or proposed." },
              { q: "Who needs to appoint a DPO?", a: "Under NDPA Section 32, you must appoint a DPO if: (a) you are a public authority, (b) your core activities require large-scale systematic monitoring of individuals, or (c) you process sensitive personal data on a large scale (generally >10,000 records). The DPO must be registered with the NDPC." },
              { q: "What are the penalties for NDPA violations?", a: "NDPA Section 48 sets maximum fines at: 2% of annual global turnover or ₦10 million (whichever is higher) for general violations, and 4% of annual global turnover or ₦20 million for serious violations. Use the Penalty Calculator (/penalty-calculator) to estimate fines." },
              { q: "How do I respond to a DSAR?", a: "Data Subject Access Requests must be responded to within 30 days (extendable to 90 days for complex requests). The response must include: confirmation of processing, copy of personal data, purposes, recipients, retention periods, and rights information. Use the DSAR Portal to manage all requests." },
              { q: "What data must be stored in Nigeria?", a: "CBN regulations require all customer financial data to be stored on servers physically located in Nigeria. NDPA Section 43 requires a data transfer impact assessment for cross-border transfers. The Cross-Sector Data Sharing module (/cross-sector-sharing) manages approved transfer mechanisms." },
            ].map(faq => {
              const isOpen = expandedDoc === faq.q;
              return (
                <Card key={faq.q} className="cursor-pointer" onClick={() => setExpandedDoc(isOpen ? null : faq.q)}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HelpCircle className="h-4 w-4 text-blue-500 shrink-0" />
                        <p className="text-sm font-medium">{faq.q}</p>
                      </div>
                      {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </div>
                    {isOpen && (
                      <p className="mt-3 text-sm text-muted-foreground leading-relaxed pl-6">{faq.a}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Support footer */}
        <Card className="border-dashed">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageCircleIcon className="h-6 w-6 text-blue-500" />
                <div>
                  <p className="font-medium text-sm">Still have questions?</p>
                  <p className="text-xs text-muted-foreground">Our AI support assistant is available 24/7</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/support-chat")}>
                Open Support Chat <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tutorial Viewer Modal */}
      {activeTutorial && activeTutorialData && (
        <TutorialViewer
          tutorial={activeTutorialData}
          onClose={() => setActiveTutorial(null)}
          onComplete={handleComplete}
        />
      )}
    </>
  );
}

// Inline icon to avoid import issues
function MessageCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
