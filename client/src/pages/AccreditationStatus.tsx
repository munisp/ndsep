import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { toast } from "sonner";
import {
  ArrowLeft, Search, CheckCircle, Clock, AlertCircle,
  XCircle, FileText, ShieldCheck, Calendar, Award, RefreshCw
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; description: string }> = {
  draft: { label: "Draft", color: "text-muted-foreground bg-card border-border", icon: FileText, description: "Application saved but not yet submitted." },
  submitted: { label: "Submitted", color: "text-blue-400 bg-blue-500/10 border-blue-500/30", icon: Clock, description: "Application received. Awaiting NDPC review queue assignment." },
  info_requested: { label: "Information Requested", color: "text-amber-400 bg-amber-500/10 border-amber-500/30", icon: AlertCircle, description: "The NDPC reviewer has requested additional information. Check your email." },
  under_review: { label: "Under Review", color: "text-purple-400 bg-purple-500/10 border-purple-500/30", icon: Search, description: "Your application is actively being reviewed by an NDPC officer." },
  competency_scheduled: { label: "Competency Assessment Scheduled", color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30", icon: Calendar, description: "A competency assessment has been scheduled. Check your email for details." },
  approved: { label: "Approved", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle, description: "Your application has been approved. Your DPCO licence has been issued." },
  conditionally_approved: { label: "Conditionally Approved", color: "text-teal-400 bg-teal-500/10 border-teal-500/30", icon: CheckCircle, description: "Approved subject to conditions. Review the conditions in your approval notice." },
  rejected: { label: "Rejected", color: "text-red-400 bg-red-500/10 border-red-500/30", icon: XCircle, description: "Your application was not approved. See the reason below." },
  suspended: { label: "Suspended", color: "text-orange-400 bg-orange-500/10 border-orange-500/30", icon: AlertCircle, description: "Your accreditation has been suspended pending investigation." },
  revoked: { label: "Revoked", color: "text-red-500 bg-red-500/10 border-red-500/30", icon: XCircle, description: "Your accreditation has been revoked by the NDPC." },
};

export default function AccreditationStatus() {
  const [token, setToken] = useState("");
  const [queryToken, setQueryToken] = useState("");

  const { data, isLoading, error } = trpc.accreditation.getApplicationStatus.useQuery(
    { token: queryToken },
    { enabled: !!queryToken }
  );

  const handleSearch = () => {
    if (token.trim()) setQueryToken(token.trim());
  };
  const renewalMutation = trpc.accreditation.submitRenewal.useMutation({
    onSuccess: () => toast.success("Renewal application submitted — you will receive a confirmation email"),
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const statusCfg = data ? (STATUS_CONFIG[data.status] ?? STATUS_CONFIG["submitted"]) : null;
  const StatusIcon = statusCfg?.icon;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-background/50">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-1">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-foreground">Application Status Tracker</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Track Your Accreditation Application</h1>
          <p className="text-muted-foreground text-sm">Enter your reference token to check the status of your DPCO accreditation application.</p>
        </div>

        <div className="flex gap-2 mb-8">
          <Input
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="e.g. NDPC-DPCO-A1B2C3D4E5F6G7H8"
            className="bg-card border-border text-foreground placeholder:text-muted-foreground font-mono"
          />
          <Button onClick={handleSearch} disabled={!token.trim() || isLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-foreground gap-2 shrink-0">
            <Search className="w-4 h-4" />
            {isLoading ? "Searching..." : "Search"}
          </Button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex gap-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-300">Application Not Found</p>
              <p className="text-xs text-red-400/70 mt-0.5">No application was found with this reference token. Please check the token and try again.</p>
            </div>
          </div>
        )}

        {data && statusCfg && StatusIcon && (
          <div className="space-y-4">
            {/* Status card */}
            <div className="bg-background border border-border rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center border ${statusCfg.color}`}>
                  <StatusIcon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-semibold text-foreground">{data.org_name ?? (data as any).orgName}</h2>
                    <Badge className={`text-xs border ${statusCfg.color}`}>{statusCfg.label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{statusCfg.description}</p>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="bg-background border border-border rounded-xl p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Application Timeline</h3>
              <div className="space-y-3">
                {[
                  { label: "Application Submitted", date: data.submitted_at ?? (data as any).submittedAt, done: true },
                  { label: "Under NDPC Review", date: null, done: ["under_review","competency_scheduled","approved","conditionally_approved","rejected"].includes(data.status) },
                  { label: "Competency Assessment", date: data.competency_scheduled_at ?? (data as any).competencyScheduledAt, done: !!((data as any).competencyScheduledAt ?? data.competency_scheduled_at) },
                  { label: "Decision Issued", date: data.decision_at ?? (data as any).decisionAt, done: !!((data as any).decisionAt ?? data.decision_at) },
                  { label: "Licence Issued", date: data.licence_issued_at ?? (data as any).licenceIssuedAt, done: !!((data as any).licenceIssuedAt ?? data.licence_issued_at) },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${item.done ? "bg-emerald-500" : "bg-muted"}`}>
                      {item.done && <CheckCircle className="w-3 h-3 text-foreground" />}
                    </div>
                    <span className={`text-sm flex-1 ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
                    {item.date && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Licence details (if approved) */}
            {(data.status === "approved" || data.status === "conditionally_approved") && (data as any).issuedLicenceNumber && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Award className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-sm font-medium text-emerald-300">Licence Issued</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Licence Number</p>
                    <p className="text-foreground font-mono font-semibold">{(data as any).issuedLicenceNumber}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Expires</p>
                    <p className="text-foreground">{(data as any).licenceExpiresAt ? new Date((data as any).licenceExpiresAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : "—"}</p>
                  </div>
                </div>
                {(data as any).conditions && (
                  <div className="mt-3 pt-3 border-t border-emerald-500/20">
                    <p className="text-xs text-muted-foreground mb-1">Conditions</p>
                    <p className="text-sm text-amber-300">{(data as any).conditions}</p>
                  </div>
                )}
              </div>
            )}

            {/* Renewal prompt for licences expiring within 90 days */}
            {(data.status === "approved" || data.status === "conditionally_approved") && (data as any).licenceExpiresAt && (() => {
              const daysLeft = Math.ceil((new Date((data as any).licenceExpiresAt).getTime() - Date.now()) / 86400000);
              return daysLeft <= 90 ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-amber-300 mb-1">Licence Renewal Required</h3>
                      <p className="text-xs text-muted-foreground">Your licence expires in <strong className="text-amber-300">{daysLeft} day{daysLeft !== 1 ? 's' : ''}</strong>. Submit a renewal application now to avoid a lapse in accreditation.</p>
                    </div>
                    <Button size="sm" onClick={() => renewalMutation.mutate({ notes: "Renewal submitted via status portal" })} disabled={renewalMutation.isPending} className="bg-amber-600 hover:bg-amber-500 gap-1 shrink-0">
                      <RefreshCw className="w-3 h-3" /> {renewalMutation.isPending ? "Submitting…" : "Renew Licence"}
                    </Button>
                  </div>
                </div>
              ) : null;
            })()}
            {/* Rejection reason */}
            {data.status === "rejected" && (data as any).decisionReason && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
                <h3 className="text-sm font-medium text-red-300 mb-2">Reason for Rejection</h3>
                <p className="text-sm text-muted-foreground">{(data as any).decisionReason}</p>
                <p className="text-xs text-muted-foreground mt-3">You may reapply after 6 months. Contact the NDPC Compliance Directorate for further guidance.</p>
              </div>
            )}

            {/* Info request */}
            {data.status === "info_requested" && (data as any).infoRequestNote && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
                <h3 className="text-sm font-medium text-amber-300 mb-2">Information Requested</h3>
                <p className="text-sm text-muted-foreground">{(data as any).infoRequestNote}</p>
                <p className="text-xs text-muted-foreground mt-3">Please respond by email to the NDPC Compliance Directorate with the requested information, quoting your reference token.</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            Don't have a reference token?{" "}
            <Link href="/dpco/apply">
              <span className="text-emerald-400 hover:text-emerald-300 cursor-pointer">Apply for DPCO Accreditation</span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
