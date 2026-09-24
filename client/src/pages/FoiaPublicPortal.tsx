import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Landmark, FileText, Clock, CheckCircle2, AlertCircle, ChevronRight, Search } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  received: "text-blue-400 bg-blue-900/30",
  processing: "text-yellow-400 bg-yellow-900/30",
  partial_disclosure: "text-purple-400 bg-purple-900/30",
  disclosed: "text-green-400 bg-green-900/30",
  refused: "text-red-400 bg-red-900/30",
  closed: "text-muted-foreground bg-card",
};

const EXEMPTION_LABELS: Record<string, string> = {
  national_security: "National security (FOIA s.11)",
  personal_privacy: "Personal privacy (FOIA s.14)",
  law_enforcement: "Law enforcement & investigation (FOIA s.12)",
  commercial_confidence: "Commercial confidence (FOIA s.15)",
};

export default function FoiaPublicPortal() {
  const [mode, setMode] = useState<"home" | "submit" | "track" | "success">("home");
  const [form, setForm] = useState({
    requesterName: "", requesterEmail: "", requesterPhone: "",
    subject: "", description: "", preferredFormat: "electronic",
  });
  const [trackForm, setTrackForm] = useState({ referenceNumber: "", requesterEmail: "" });
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [trackResult, setTrackResult] = useState<any>(null);

  const submitMutation = trpc.foia.submit.useMutation({
    onSuccess: (data) => { setSubmitResult(data); setMode("success"); },
    onError: (err) => toast.error(err.message),
  });

  const trackQuery = trpc.foia.track.useQuery(
    { referenceNumber: trackForm.referenceNumber, requesterEmail: trackForm.requesterEmail },
    { enabled: false, retry: false }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.requesterName || !form.requesterEmail || !form.subject || form.description.length < 20) {
      toast.error("Please complete all required fields (description min 20 characters).");
      return;
    }
    submitMutation.mutate({
      requesterName: form.requesterName,
      requesterEmail: form.requesterEmail,
      requesterPhone: form.requesterPhone || undefined,
      subject: form.subject,
      description: form.description,
      preferredFormat: form.preferredFormat as any,
    });
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackForm.referenceNumber || !trackForm.requesterEmail) {
      toast.error("Enter your reference number and email.");
      return;
    }
    const result = await trackQuery.refetch();
    if (result.data) setTrackResult(result.data);
    else if (result.error) toast.error("No request found with those details.");
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Public Services", href: "/" }, { label: "FOIA Portal" }]} className="mb-4" />
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Landmark className="w-7 h-7 text-green-400" />
          <div>
            <div className="font-bold text-foreground text-lg leading-tight">NDPC Freedom of Information Portal</div>
            <div className="text-xs text-muted-foreground">Freedom of Information Act 2011 — response within 7 days</div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {mode === "home" && (
          <div>
            <div className="text-center mb-10">
              <h1 className="text-2xl font-bold text-foreground mb-3">Request Public Records</h1>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Under the Freedom of Information Act 2011, any person may request records held by the Nigeria Data Protection Commission. We must respond within <strong className="text-foreground">7 days</strong>.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
              <button onClick={() => setMode("submit")} className="bg-background border border-border hover:border-green-500 rounded-xl p-6 text-left transition-all group">
                <FileText className="w-8 h-8 text-green-400 mb-3" />
                <div className="font-semibold text-foreground text-lg mb-1">Submit a FOIA Request</div>
                <div className="text-muted-foreground text-sm mb-4">Ask for records held by the Commission. No login required.</div>
                <div className="flex items-center text-green-400 text-sm font-medium">Get started <ChevronRight className="w-4 h-4 ml-1" /></div>
              </button>
              <button onClick={() => setMode("track")} className="bg-background border border-border hover:border-blue-500 rounded-xl p-6 text-left transition-all group">
                <Search className="w-8 h-8 text-blue-400 mb-3" />
                <div className="font-semibold text-foreground text-lg mb-1">Track a Request</div>
                <div className="text-muted-foreground text-sm mb-4">Check the status of an existing FOIA-YYYY-##### reference.</div>
                <div className="flex items-center text-blue-400 text-sm font-medium">Track now <ChevronRight className="w-4 h-4 ml-1" /></div>
              </button>
            </div>
          </div>
        )}

        {mode === "submit" && (
          <form onSubmit={handleSubmit} className="bg-background border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">New FOIA Request</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>Full name *</Label><Input required value={form.requesterName} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} /></div>
              <div><Label>Email *</Label><Input required type="email" value={form.requesterEmail} onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })} /></div>
              <div><Label>Phone (optional)</Label><Input value={form.requesterPhone} onChange={(e) => setForm({ ...form, requesterPhone: e.target.value })} /></div>
              <div>
                <Label>Preferred format</Label>
                <Select value={form.preferredFormat} onValueChange={(v) => setForm({ ...form, preferredFormat: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="electronic">Electronic copy</SelectItem>
                    <SelectItem value="paper">Paper copy</SelectItem>
                    <SelectItem value="inspect">Inspect records in person</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Subject *</Label><Input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief subject of the records you seek" /></div>
            <div><Label>Description * (min 20 characters)</Label><Textarea required rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the records with enough detail for the Commission to locate them…" /></div>
            <div className="flex gap-3">
              <Button type="submit" disabled={submitMutation.isPending}>{submitMutation.isPending ? "Submitting…" : "Submit request"}</Button>
              <Button type="button" variant="outline" onClick={() => setMode("home")}>Cancel</Button>
            </div>
          </form>
        )}

        {mode === "success" && submitResult && (
          <div className="bg-background border border-green-500/40 rounded-xl p-8 text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
            <h2 className="text-xl font-semibold text-foreground">Request received</h2>
            <p className="text-muted-foreground">Your reference number is</p>
            <p className="text-2xl font-mono font-bold text-green-400">{submitResult.reference_number}</p>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Clock className="w-4 h-4" /> Statutory response deadline: {new Date(submitResult.statutory_deadline).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })} (7 days)
            </p>
            <p className="text-xs text-muted-foreground">Keep your reference number and email — you will need both to track this request.</p>
            <Button variant="outline" onClick={() => { setMode("track"); setTrackForm({ referenceNumber: submitResult.reference_number, requesterEmail: form.requesterEmail }); }}>Track this request</Button>
          </div>
        )}

        {mode === "track" && (
          <div className="space-y-6">
            <form onSubmit={handleTrack} className="bg-background border border-border rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Track your FOIA request</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>Reference number *</Label><Input required value={trackForm.referenceNumber} onChange={(e) => setTrackForm({ ...trackForm, referenceNumber: e.target.value })} placeholder="FOIA-2025-00042" /></div>
                <div><Label>Email used at submission *</Label><Input required type="email" value={trackForm.requesterEmail} onChange={(e) => setTrackForm({ ...trackForm, requesterEmail: e.target.value })} /></div>
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={trackQuery.isFetching}>{trackQuery.isFetching ? "Checking…" : "Track"}</Button>
                <Button type="button" variant="outline" onClick={() => setMode("home")}>Back</Button>
              </div>
            </form>

            {trackResult && (
              <div className="bg-background border border-border rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono font-bold">{trackResult.reference_number}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[trackResult.status] ?? ""}`}>{String(trackResult.status).replace(/_/g, " ")}</span>
                  {trackResult.overdue && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium text-red-400 bg-red-900/30 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> past statutory deadline</span>
                  )}
                </div>
                <p className="text-foreground font-medium">{trackResult.subject}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div><p className="text-muted-foreground">Received</p><p>{trackResult.received_at ? new Date(trackResult.received_at).toLocaleDateString("en-NG") : "—"}</p></div>
                  <div><p className="text-muted-foreground">Statutory deadline</p><p>{trackResult.statutory_deadline ? new Date(trackResult.statutory_deadline).toLocaleDateString("en-NG") : "—"}</p></div>
                  <div><p className="text-muted-foreground">Preferred format</p><p className="capitalize">{trackResult.preferred_format}</p></div>
                </div>
                {trackResult.status === "refused" && (
                  <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3 text-sm">
                    <p className="font-medium text-red-400">Refused — {EXEMPTION_LABELS[trackResult.exemption_code] ?? trackResult.exemption_code}</p>
                    {trackResult.refusal_reason && <p className="mt-1 text-muted-foreground">{trackResult.refusal_reason}</p>}
                  </div>
                )}
                {trackResult.disclosure_notes && (
                  <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-3 text-sm">
                    <p className="font-medium text-green-400">Disclosure notes</p>
                    <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{trackResult.disclosure_notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
