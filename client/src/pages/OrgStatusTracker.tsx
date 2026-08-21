/**
 * Organisation Self-Service Status Tracker
 * ==========================================
 * Public page at /status/:token — organisations paste their submission token
 * and see a live timeline of their onboarding phases, reviewer notes, compliance
 * score, open penalties, and any outstanding actions. No login required.
 */
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Shield, CheckCircle2, Clock, AlertCircle, Award, ChevronRight,
  Building2, Mail, Phone, Globe, Search, RefreshCw, FileText, AlertTriangle,
} from "lucide-react";

const PHASE_ORDER = [
  "submitted",
  "document_review",
  "technical_assessment",
  "field_audit",
  "remediation",
  "final_review",
  "certified",
];

const PHASE_LABELS: Record<string, string> = {
  submitted: "Submission Received",
  document_review: "Document Review",
  technical_assessment: "Technical Assessment",
  field_audit: "Field Audit",
  remediation: "Remediation Period",
  final_review: "Final Review",
  certified: "Certified",
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  submitted: "Your registration has been received and is queued for review.",
  document_review: "Our compliance team is reviewing your submitted documents and asset inventory.",
  technical_assessment: "A technical audit of your IT systems and data infrastructure is underway.",
  field_audit: "An NDSEP auditor is conducting an on-site inspection of your facilities.",
  remediation: "Remediation actions are required before certification can proceed.",
  final_review: "Your compliance record is under final review by the NDSEP Enforcement Committee.",
  certified: "Your organisation has been certified as compliant with the National Data Sovereignty Act.",
};

function PhaseIcon({ phase, current, done }: { phase: string; current: boolean; done: boolean }) {
  if (phase === "certified" && done) return <Award className="h-5 w-5 text-yellow-500" />;
  if (done) return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (current) return <Clock className="h-5 w-5 text-blue-500 animate-pulse" />;
  return <div className="h-5 w-5 rounded-full border-2 border-border/40" />;
}

export default function OrgStatusTracker() {
  const params = useParams<{ token?: string }>();
  const [tokenInput, setTokenInput] = useState(params.token ?? "");
  const [activeToken, setActiveToken] = useState(params.token ?? "");

  const { data: submission, isLoading, error, refetch } = trpc.portal.get.useQuery(
    { token: activeToken },
    { enabled: !!activeToken, retry: false }
  );

  const currentPhaseIdx = PHASE_ORDER.indexOf(submission?.current_phase ?? "");
  const progressPct = currentPhaseIdx >= 0
    ? Math.round(((currentPhaseIdx + 1) / PHASE_ORDER.length) * 100)
    : 0;

  const scoreColor = (score: number) =>
    score >= 75 ? "text-green-500" : score >= 50 ? "text-yellow-500" : "text-red-500";

  function handleSearch() {
    if (tokenInput.trim()) setActiveToken(tokenInput.trim());
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span className="font-bold text-sm text-foreground">NDSEP</span>
              <span className="text-xs text-muted-foreground ml-2">Compliance Status Tracker</span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs mono">PUBLIC ACCESS</Badge>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Token search */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-mono flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              Track Your Compliance Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Enter your submission reference token to view your organisation's onboarding progress, compliance score, and any outstanding actions.
            </p>
            <div className="flex gap-2">
              <Input
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="e.g. NDSEP-2026-XXXXXXXX"
                className="font-mono text-sm"
              />
              <Button onClick={handleSearch} disabled={isLoading || !tokenInput.trim()}>
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">Looking up submission...</span>
          </div>
        )}

        {/* Not found */}
        {!isLoading && error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="pt-6 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-600">Submission not found</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No submission matches token <span className="font-mono">{activeToken}</span>. Please check the token and try again.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submission found */}
        {submission && !isLoading && (
          <>
            {/* Org header */}
            <Card className="border-primary/30 bg-card/80">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">{submission.org_name}</h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-xs mono uppercase">{submission.org_sector}</Badge>
                        <Badge variant="outline" className="text-xs mono">{submission.org_country}</Badge>
                        {submission.current_phase === "certified" && (
                          <Badge className="text-xs bg-yellow-500/20 text-yellow-600 border-yellow-500/30">
                            <Award className="h-3 w-3 mr-1" /> Certified
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-xs">
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                  </Button>
                </div>

                {/* Contact info */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
                  {submission.contact_name && (
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      <span>{submission.contact_name}</span>
                    </div>
                  )}
                  {submission.contact_email && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      <span className="truncate">{submission.contact_email}</span>
                    </div>
                  )}
                  {submission.contact_phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" />
                      <span>{submission.contact_phone}</span>
                    </div>
                  )}
                </div>

                {/* Token */}
                <div className="mt-4 bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">REFERENCE TOKEN</p>
                  <p className="font-mono text-sm font-bold text-primary">{submission.submission_token}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Submitted: {new Date(submission.submitted_at).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Compliance score */}
            {submission.compliance_score != null && (
              <Card className="border-border/60">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium">Compliance Score</p>
                    <span className={`text-2xl font-bold mono ${scoreColor(submission.compliance_score)}`}>
                      {submission.compliance_score}<span className="text-sm text-muted-foreground">/100</span>
                    </span>
                  </div>
                  <Progress value={submission.compliance_score} className="h-2" />
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-muted-foreground">0 — Non-compliant</span>
                    <span className="text-xs text-muted-foreground">100 — Fully compliant</span>
                  </div>
                  {submission.compliance_score < 50 && (
                    <div className="mt-3 flex items-start gap-2 text-xs text-red-600 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Your compliance score is below the minimum threshold of 50. Remediation actions are required to proceed with certification.</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Phase timeline */}
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-mono flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Onboarding Progress
                </CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Progress value={progressPct} className="h-1.5 flex-1" />
                  <span className="text-xs text-muted-foreground mono">{progressPct}%</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-0">
                {PHASE_ORDER.map((phase, idx) => {
                  const isDone = idx < currentPhaseIdx || (idx === currentPhaseIdx && phase === "certified");
                  const isCurrent = idx === currentPhaseIdx && phase !== "certified";
                  const isFuture = idx > currentPhaseIdx;
                  // Find matching onboarding_phases row for notes
                  const phaseRow = (submission.phases ?? []).find((p: any) =>
                    p.phase_name === phase || p.status === phase
                  );

                  return (
                    <div key={phase} className={`flex gap-4 pb-6 relative ${idx < PHASE_ORDER.length - 1 ? "border-l-2 ml-2.5 pl-6 border-border/30" : "ml-2.5 pl-6"} ${isFuture ? "opacity-40" : ""}`}>
                      <div className="absolute -left-[11px] top-0">
                        <PhaseIcon phase={phase} current={isCurrent} done={isDone} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-sm font-medium ${isCurrent ? "text-blue-500" : isDone ? "text-foreground" : "text-muted-foreground"}`}>
                            {PHASE_LABELS[phase]}
                          </p>
                          {isCurrent && <Badge className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">Current</Badge>}
                          {isDone && phase !== "certified" && <Badge variant="outline" className="text-xs text-green-600 border-green-500/30">Complete</Badge>}
                          {phase === "certified" && isDone && <Badge className="text-xs bg-yellow-500/10 text-yellow-600 border-yellow-500/30">Certified</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{PHASE_DESCRIPTIONS[phase]}</p>
                        {phaseRow?.notes && (
                          <div className="mt-2 bg-muted/30 rounded p-2 text-xs text-muted-foreground border border-border/30">
                            <span className="font-medium text-foreground">Reviewer note: </span>{phaseRow.notes}
                          </div>
                        )}
                        {phaseRow?.completed_at && (
                          <p className="text-xs text-muted-foreground mt-1 mono">
                            Completed: {new Date(phaseRow.completed_at).toLocaleDateString("en-NG")}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Self-assessment score */}
            {submission.self_assessment_score != null && (
              <Card className="border-border/60">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Self-Assessment Score</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Submitted during registration</p>
                    </div>
                    <span className={`text-2xl font-bold mono ${scoreColor(submission.self_assessment_score)}`}>
                      {submission.self_assessment_score}<span className="text-sm text-muted-foreground">/100</span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Certification info */}
            {submission.current_phase === "certified" && submission.certified_at && (
              <Card className="border-yellow-500/30 bg-yellow-500/5">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
                      <Award className="h-6 w-6 text-yellow-500" />
                    </div>
                    <div>
                      <p className="font-bold text-foreground">Compliance Certificate Issued</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Certified on {new Date(submission.certified_at).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Certificate valid for 12 months. Verify at{" "}
                        <a href={`/verify/${submission.cert_token ?? submission.submission_token}`} className="text-primary underline">
                          /verify/{submission.cert_token ?? submission.submission_token}
                        </a>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Next action guidance */}
            {submission.current_phase !== "certified" && (
              <Card className="border-border/60 bg-muted/10">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <ChevronRight className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Next Steps</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {submission.current_phase === "remediation"
                          ? "Address all identified compliance gaps and submit evidence of remediation to your assigned auditor."
                          : submission.current_phase === "field_audit"
                          ? "Ensure your designated contact is available for the scheduled on-site audit. Prepare all documentation for review."
                          : "No action required at this time. You will be notified by email when your status advances."}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button variant="outline" size="sm" className="text-xs font-mono" asChild>
                          <a href="/portal">Open Portal</a>
                        </Button>
                        <Button variant="outline" size="sm" className="text-xs font-mono" asChild>
                          <a href="mailto:compliance@ndsep.gov.ng">Contact Auditor</a>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Empty state when no token yet */}
        {!activeToken && !isLoading && (
          <div className="text-center py-12">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Globe className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2">Enter Your Reference Token</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Your submission reference token was provided when you registered your organisation on the NDSEP portal. It looks like <span className="font-mono text-primary">NDSEP-2026-XXXXXXXX</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
