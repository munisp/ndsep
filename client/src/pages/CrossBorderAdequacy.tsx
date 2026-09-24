import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Globe2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  proposed: "text-yellow-400 bg-yellow-900/30",
  in_force: "text-green-400 bg-green-900/30",
  suspended: "text-orange-400 bg-orange-900/30",
  revoked: "text-red-400 bg-red-900/30",
  submitted: "text-blue-400 bg-blue-900/30",
  under_review: "text-yellow-400 bg-yellow-900/30",
  approved: "text-green-400 bg-green-900/30",
  rejected: "text-red-400 bg-red-900/30",
};

const DEROGATION_TYPES = [
  "explicit_consent", "contract_performance", "public_interest",
  "legal_claims", "vital_interests", "legitimate_interests",
];

export default function CrossBorderAdequacy() {
  const [tab, setTab] = useState<"adequacy" | "bcr" | "derogations">("adequacy");

  const { data: decisions = [], refetch: refetchDecisions } = trpc.crossBorderAdequacy.listAdequacyDecisions.useQuery({});
  const { data: bcrs = [], refetch: refetchBcrs } = trpc.crossBorderAdequacy.listBcrs.useQuery({});
  const { data: derogations = [], refetch: refetchDerogations } = trpc.crossBorderAdequacy.listDerogations.useQuery({});

  const [issueForm, setIssueForm] = useState({ country: "", region: "", review_due_date: "", notes: "" });
  const [bcrForm, setBcrForm] = useState({ group_name: "", bcr_document_url: "" });
  const [derogForm, setDerogForm] = useState({ organization_id: "", destination_country: "", derogation_type: "explicit_consent", justification: "", data_subject_count: "" });

  const issueMutation = trpc.crossBorderAdequacy.issueAdequacyDecision.useMutation({
    onSuccess: () => { toast.success("Adequacy decision issued"); setIssueForm({ country: "", region: "", review_due_date: "", notes: "" }); refetchDecisions(); },
    onError: (e) => toast.error(e.message),
  });
  const suspendMutation = trpc.crossBorderAdequacy.suspendAdequacyDecision.useMutation({
    onSuccess: () => { toast.success("Decision suspended"); refetchDecisions(); },
    onError: (e) => toast.error(e.message),
  });
  const revokeMutation = trpc.crossBorderAdequacy.revokeAdequacyDecision.useMutation({
    onSuccess: () => { toast.success("Decision revoked"); refetchDecisions(); },
    onError: (e) => toast.error(e.message),
  });
  const reinstateMutation = trpc.crossBorderAdequacy.reinstateAdequacyDecision.useMutation({
    onSuccess: () => { toast.success("Decision reinstated"); refetchDecisions(); },
    onError: (e) => toast.error(e.message),
  });
  const registerBcrMutation = trpc.crossBorderAdequacy.registerBcr.useMutation({
    onSuccess: () => { toast.success("BCR submitted for NDPC review"); setBcrForm({ group_name: "", bcr_document_url: "" }); refetchBcrs(); },
    onError: (e) => toast.error(e.message),
  });
  const reviewBcrMutation = trpc.crossBorderAdequacy.reviewBcr.useMutation({
    onSuccess: () => { toast.success("BCR decision recorded"); refetchBcrs(); },
    onError: (e) => toast.error(e.message),
  });
  const recordDerogMutation = trpc.crossBorderAdequacy.recordDerogation.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Derogation recorded (destination adequacy: ${r.adequacy_status_at_destination})`);
      setDerogForm({ organization_id: "", destination_country: "", derogation_type: "explicit_consent", justification: "", data_subject_count: "" });
      refetchDerogations();
    },
    onError: (e) => toast.error(e.message),
  });

  const promptAction = (label: string, fn: (reason: string) => void) => {
    const reason = window.prompt(`${label} — enter reason (min 10 chars):`);
    if (reason && reason.length >= 10) fn(reason);
    else if (reason !== null) toast.error("Reason must be at least 10 characters");
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Cross-Border Transfers" }]} />
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Globe2 className="h-6 w-6" /> Cross-Border Transfer Adequacy (NDPA ss.41–43)
      </h1>

      <div className="flex gap-2">
        {(["adequacy", "bcr", "derogations"] as const).map((t) => (
          <Button key={t} variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t === "adequacy" ? "Adequacy Decisions" : t === "bcr" ? "Binding Corporate Rules" : "Derogations"}
          </Button>
        ))}
      </div>

      {tab === "adequacy" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!issueForm.country) return toast.error("Country is required");
              issueMutation.mutate({
                country: issueForm.country,
                region: issueForm.region || undefined,
                review_due_date: issueForm.review_due_date || undefined,
                notes: issueForm.notes || undefined,
                in_force: true,
              });
            }}
            className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3"
          >
            <div><Label>Country</Label><Input value={issueForm.country} onChange={(e) => setIssueForm({ ...issueForm, country: e.target.value })} placeholder="e.g. Ghana" /></div>
            <div><Label>Region (optional)</Label><Input value={issueForm.region} onChange={(e) => setIssueForm({ ...issueForm, region: e.target.value })} /></div>
            <div><Label>Review due</Label><Input type="date" value={issueForm.review_due_date} onChange={(e) => setIssueForm({ ...issueForm, review_due_date: e.target.value })} /></div>
            <div className="flex items-end"><Button type="submit" disabled={issueMutation.isPending}>Issue Decision</Button></div>
          </form>

          <table className="w-full text-sm border rounded-lg">
            <thead><tr className="border-b text-left"><th className="p-2">Country</th><th className="p-2">Region</th><th className="p-2">Status</th><th className="p-2">Review due</th><th className="p-2">Actions</th></tr></thead>
            <tbody>
              {(decisions as any[]).map((d) => (
                <tr key={d.id} className="border-b">
                  <td className="p-2">{d.country}</td>
                  <td className="p-2">{d.region ?? "—"}</td>
                  <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[d.decision_status] ?? ""}`}>{d.decision_status}</span></td>
                  <td className="p-2">{d.review_due_date ? new Date(d.review_due_date).toLocaleDateString() : "—"}</td>
                  <td className="p-2 space-x-1">
                    {d.decision_status === "in_force" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => promptAction("Suspend", (r) => suspendMutation.mutate({ id: d.id, reason: r }))}>Suspend</Button>
                        <Button size="sm" variant="destructive" onClick={() => promptAction("Revoke", (r) => revokeMutation.mutate({ id: d.id, reason: r }))}>Revoke</Button>
                      </>
                    )}
                    {d.decision_status === "suspended" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => reinstateMutation.mutate({ id: d.id })}>Reinstate</Button>
                        <Button size="sm" variant="destructive" onClick={() => promptAction("Revoke", (r) => revokeMutation.mutate({ id: d.id, reason: r }))}>Revoke</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {(decisions as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={5}>No adequacy decisions recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "bcr" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!bcrForm.group_name) return toast.error("Group name is required");
              registerBcrMutation.mutate({ group_name: bcrForm.group_name, bcr_document_url: bcrForm.bcr_document_url || undefined });
            }}
            className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            <div><Label>Corporate group</Label><Input value={bcrForm.group_name} onChange={(e) => setBcrForm({ ...bcrForm, group_name: e.target.value })} /></div>
            <div><Label>BCR document URL</Label><Input value={bcrForm.bcr_document_url} onChange={(e) => setBcrForm({ ...bcrForm, bcr_document_url: e.target.value })} placeholder="https://…" /></div>
            <div className="flex items-end"><Button type="submit" disabled={registerBcrMutation.isPending}>Submit for Approval</Button></div>
          </form>

          <table className="w-full text-sm border rounded-lg">
            <thead><tr className="border-b text-left"><th className="p-2">Group</th><th className="p-2">Status</th><th className="p-2">Approval ref</th><th className="p-2">Review</th></tr></thead>
            <tbody>
              {(bcrs as any[]).map((b) => (
                <tr key={b.id} className="border-b">
                  <td className="p-2">{b.group_name}</td>
                  <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[b.status] ?? ""}`}>{b.status}</span></td>
                  <td className="p-2">{b.approval_reference ?? "—"}</td>
                  <td className="p-2 space-x-1">
                    {["submitted", "under_review"].includes(b.status) && (
                      <>
                        <Button size="sm" onClick={() => {
                          const ref = window.prompt("Approval reference:");
                          if (ref) reviewBcrMutation.mutate({ id: b.id, decision: "approved", approval_reference: ref });
                        }}>Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => {
                          const notes = window.prompt("Rejection notes:");
                          if (notes) reviewBcrMutation.mutate({ id: b.id, decision: "rejected", review_notes: notes });
                        }}>Reject</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {(bcrs as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={4}>No BCRs registered.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "derogations" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!derogForm.organization_id || !derogForm.destination_country || derogForm.justification.length < 10)
                return toast.error("Org ID, destination and justification (min 10 chars) are required");
              recordDerogMutation.mutate({
                organization_id: Number(derogForm.organization_id),
                destination_country: derogForm.destination_country,
                derogation_type: derogForm.derogation_type as any,
                justification: derogForm.justification,
                data_subject_count: derogForm.data_subject_count ? Number(derogForm.data_subject_count) : undefined,
              });
            }}
            className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3"
          >
            <div><Label>Organization ID</Label><Input type="number" value={derogForm.organization_id} onChange={(e) => setDerogForm({ ...derogForm, organization_id: e.target.value })} /></div>
            <div><Label>Destination country</Label><Input value={derogForm.destination_country} onChange={(e) => setDerogForm({ ...derogForm, destination_country: e.target.value })} /></div>
            <div>
              <Label>Derogation type</Label>
              <Select value={derogForm.derogation_type} onValueChange={(v) => setDerogForm({ ...derogForm, derogation_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEROGATION_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Data subjects affected</Label><Input type="number" value={derogForm.data_subject_count} onChange={(e) => setDerogForm({ ...derogForm, data_subject_count: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Justification</Label><Textarea value={derogForm.justification} onChange={(e) => setDerogForm({ ...derogForm, justification: e.target.value })} /></div>
            <div><Button type="submit" disabled={recordDerogMutation.isPending}>Record Derogation</Button></div>
          </form>

          <table className="w-full text-sm border rounded-lg">
            <thead><tr className="border-b text-left"><th className="p-2">Destination</th><th className="p-2">Type</th><th className="p-2">Subjects</th><th className="p-2">Adequacy</th><th className="p-2">Date</th></tr></thead>
            <tbody>
              {(derogations as any[]).map((d) => (
                <tr key={d.id} className="border-b">
                  <td className="p-2">{d.destination_country}</td>
                  <td className="p-2">{String(d.derogation_type).replace(/_/g, " ")}</td>
                  <td className="p-2">{d.data_subject_count ?? "—"}</td>
                  <td className="p-2">{d.adequacy_status ?? "none"}</td>
                  <td className="p-2">{new Date(d.transfer_date).toLocaleDateString()}</td>
                </tr>
              ))}
              {(derogations as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={5}>No derogations recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
