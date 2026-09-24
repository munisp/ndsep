import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileWarning, Link2, Scissors, UserX } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const RELATIONSHIPS = ["guardian", "legal_counsel", "next_of_kin", "authorised_agent", "executor"];

export default function DsarEdgeCases() {
  const [tab, setTab] = useState<"refusals" | "thirdparty" | "links" | "redactions">("refusals");

  const { data: thirdParty = [], refetch: refetchTP } = trpc.dsarEdgeCases.listThirdPartySubmissions.useQuery({});
  const { data: refusals = [], refetch: refetchRefusals } = trpc.dsarEdgeCases.listRefusals.useQuery({});
  const { data: links = [], refetch: refetchLinks } = trpc.dsarEdgeCases.listLinkedRequests.useQuery({});
  const { data: redactions = [], refetch: refetchRedactions } = trpc.dsarEdgeCases.listRedactions.useQuery({});

  const [refusalForm, setRefusalForm] = useState({ requestId: "", ground: "manifestly_unfounded", justification: "", exemptionBasis: "" });
  const [linkForm, setLinkForm] = useState({ requestId: "", relatedRequestId: "", linkType: "duplicate" });
  const [mergeForm, setMergeForm] = useState({ primaryId: "", duplicateId: "" });
  const [redactForm, setRedactForm] = useState({ requestId: "", documentRef: "", reason: "third_party_rights", passageRef: "", rationale: "" });

  const refuseMutation = trpc.dsarEdgeCases.refuseRequest.useMutation({
    onSuccess: () => { toast.success("Refusal issued with justification and appeal pointer"); setRefusalForm({ requestId: "", ground: "manifestly_unfounded", justification: "", exemptionBasis: "" }); refetchRefusals(); },
    onError: (e) => toast.error(e.message),
  });
  const verifyTPMutation = trpc.dsarEdgeCases.verifyRepresentative.useMutation({
    onSuccess: () => { toast.success("Representative verification recorded"); refetchTP(); },
    onError: (e) => toast.error(e.message),
  });
  const linkMutation = trpc.dsarEdgeCases.linkRequests.useMutation({
    onSuccess: () => { toast.success("Requests linked"); refetchLinks(); },
    onError: (e) => toast.error(e.message),
  });
  const mergeMutation = trpc.dsarEdgeCases.mergeRequests.useMutation({
    onSuccess: () => { toast.success("Duplicate merged into primary request"); refetchLinks(); },
    onError: (e) => toast.error(e.message),
  });
  const redactMutation = trpc.dsarEdgeCases.proposeRedaction.useMutation({
    onSuccess: () => { toast.success("Redaction proposed for review"); setRedactForm({ requestId: "", documentRef: "", reason: "third_party_rights", passageRef: "", rationale: "" }); refetchRedactions(); },
    onError: (e) => toast.error(e.message),
  });
  const reviewRedactMutation = trpc.dsarEdgeCases.reviewRedaction.useMutation({
    onSuccess: () => { toast.success("Redaction updated"); refetchRedactions(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "DSAR Edge Cases" }]} />
      <h1 className="text-2xl font-bold">DSAR Edge Cases</h1>

      <div className="flex gap-2 flex-wrap">
        <Button variant={tab === "refusals" ? "default" : "outline"} onClick={() => setTab("refusals")}><FileWarning className="h-4 w-4 mr-1" /> Refusals</Button>
        <Button variant={tab === "thirdparty" ? "default" : "outline"} onClick={() => setTab("thirdparty")}><UserX className="h-4 w-4 mr-1" /> Third-Party</Button>
        <Button variant={tab === "links" ? "default" : "outline"} onClick={() => setTab("links")}><Link2 className="h-4 w-4 mr-1" /> Duplicates</Button>
        <Button variant={tab === "redactions" ? "default" : "outline"} onClick={() => setTab("redactions")}><Scissors className="h-4 w-4 mr-1" /> Redactions</Button>
      </div>

      {tab === "refusals" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!refusalForm.requestId || refusalForm.justification.length < 20)
                return toast.error("Request ID and written justification (min 20 chars) are mandatory");
              refuseMutation.mutate({
                requestId: Number(refusalForm.requestId),
                refusalGround: refusalForm.ground as any,
                writtenJustification: refusalForm.justification,
                exemptionBasis: refusalForm.exemptionBasis || undefined,
              });
            }}
            className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3"
          >
            <div><Label>DSAR Request ID</Label><Input type="number" value={refusalForm.requestId} onChange={(e) => setRefusalForm({ ...refusalForm, requestId: e.target.value })} /></div>
            <div>
              <Label>Ground</Label>
              <Select value={refusalForm.ground} onValueChange={(v) => setRefusalForm({ ...refusalForm, ground: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manifestly_unfounded">Manifestly unfounded</SelectItem>
                  <SelectItem value="manifestly_excessive">Manifestly excessive</SelectItem>
                  <SelectItem value="exemption_applies">Exemption applies</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Written justification (mandatory)</Label><Textarea value={refusalForm.justification} onChange={(e) => setRefusalForm({ ...refusalForm, justification: e.target.value })} /></div>
            <div><Label>Exemption basis (if applicable)</Label><Input value={refusalForm.exemptionBasis} onChange={(e) => setRefusalForm({ ...refusalForm, exemptionBasis: e.target.value })} /></div>
            <div className="flex items-end"><Button type="submit" variant="destructive" disabled={refuseMutation.isPending}>Issue Refusal</Button></div>
          </form>

          <table className="w-full text-sm border rounded-lg">
            <thead><tr className="border-b text-left"><th className="p-2">Ref</th><th className="p-2">Ground</th><th className="p-2">Status</th><th className="p-2">Refused by</th><th className="p-2">Date</th></tr></thead>
            <tbody>
              {(refusals as any[]).map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2 font-mono">{r.reference_number}</td>
                  <td className="p-2">{String(r.refusal_ground).replace(/_/g, " ")}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.refused_by}</td>
                  <td className="p-2">{new Date(r.refused_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {(refusals as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={5}>No refusals recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "thirdparty" && (
        <table className="w-full text-sm border rounded-lg">
          <thead><tr className="border-b text-left"><th className="p-2">Request</th><th className="p-2">Representative</th><th className="p-2">Relationship</th><th className="p-2">Verification</th><th className="p-2">Action</th></tr></thead>
          <tbody>
            {(thirdParty as any[]).map((t) => (
              <tr key={t.id} className="border-b">
                <td className="p-2 font-mono">{t.reference_number}</td>
                <td className="p-2">{t.representative_name}</td>
                <td className="p-2">{t.relationship}</td>
                <td className="p-2">{t.verification_status}</td>
                <td className="p-2 space-x-1">
                  {t.verification_status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => verifyTPMutation.mutate({ thirdPartySubmissionId: t.id, decision: "verified" })}>Verify</Button>
                      <Button size="sm" variant="destructive" onClick={() => verifyTPMutation.mutate({ thirdPartySubmissionId: t.id, decision: "rejected" })}>Reject</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(thirdParty as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={5}>No third-party submissions.</td></tr>}
          </tbody>
        </table>
      )}

      {tab === "links" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                linkMutation.mutate({ requestId: Number(linkForm.requestId), relatedRequestId: Number(linkForm.relatedRequestId), linkType: linkForm.linkType as any });
              }}
              className="border rounded-lg p-4 space-y-3"
            >
              <h3 className="font-medium">Link duplicate / competing requests</h3>
              <div><Label>Request ID</Label><Input type="number" value={linkForm.requestId} onChange={(e) => setLinkForm({ ...linkForm, requestId: e.target.value })} /></div>
              <div><Label>Related Request ID</Label><Input type="number" value={linkForm.relatedRequestId} onChange={(e) => setLinkForm({ ...linkForm, relatedRequestId: e.target.value })} /></div>
              <div>
                <Label>Link type</Label>
                <Select value={linkForm.linkType} onValueChange={(v) => setLinkForm({ ...linkForm, linkType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="duplicate">Duplicate</SelectItem>
                    <SelectItem value="competing">Competing</SelectItem>
                    <SelectItem value="related">Related</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={linkMutation.isPending}>Link</Button>
            </form>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mergeMutation.mutate({ primaryRequestId: Number(mergeForm.primaryId), duplicateRequestId: Number(mergeForm.duplicateId) });
              }}
              className="border rounded-lg p-4 space-y-3"
            >
              <h3 className="font-medium">Merge duplicate into primary</h3>
              <div><Label>Primary (surviving) Request ID</Label><Input type="number" value={mergeForm.primaryId} onChange={(e) => setMergeForm({ ...mergeForm, primaryId: e.target.value })} /></div>
              <div><Label>Duplicate Request ID</Label><Input type="number" value={mergeForm.duplicateId} onChange={(e) => setMergeForm({ ...mergeForm, duplicateId: e.target.value })} /></div>
              <Button type="submit" variant="secondary" disabled={mergeMutation.isPending}>Merge</Button>
            </form>
          </div>
          <table className="w-full text-sm border rounded-lg">
            <thead><tr className="border-b text-left"><th className="p-2">Request</th><th className="p-2">Related</th><th className="p-2">Type</th><th className="p-2">Resolution</th></tr></thead>
            <tbody>
              {(links as any[]).map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2 font-mono">{l.request_ref}</td>
                  <td className="p-2 font-mono">{l.related_ref}</td>
                  <td className="p-2">{l.link_type}</td>
                  <td className="p-2">{l.resolution}</td>
                </tr>
              ))}
              {(links as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={4}>No linked requests.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "redactions" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!redactForm.requestId || !redactForm.documentRef || !redactForm.passageRef || !redactForm.rationale)
                return toast.error("All fields are required");
              redactMutation.mutate({
                requestId: Number(redactForm.requestId),
                documentRef: redactForm.documentRef,
                redactionReason: redactForm.reason as any,
                redactedPassages: [{ passageRef: redactForm.passageRef, rationale: redactForm.rationale }],
              });
            }}
            className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3"
          >
            <div><Label>DSAR Request ID</Label><Input type="number" value={redactForm.requestId} onChange={(e) => setRedactForm({ ...redactForm, requestId: e.target.value })} /></div>
            <div><Label>Document reference</Label><Input value={redactForm.documentRef} onChange={(e) => setRedactForm({ ...redactForm, documentRef: e.target.value })} /></div>
            <div>
              <Label>Reason</Label>
              <Select value={redactForm.reason} onValueChange={(v) => setRedactForm({ ...redactForm, reason: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="third_party_rights">Third-party rights</SelectItem>
                  <SelectItem value="legal_privilege">Legal privilege</SelectItem>
                  <SelectItem value="crime_prevention">Crime prevention</SelectItem>
                  <SelectItem value="management_forecast">Management forecast</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Passage reference</Label><Input value={redactForm.passageRef} onChange={(e) => setRedactForm({ ...redactForm, passageRef: e.target.value })} placeholder="e.g. page 3, paragraph 2" /></div>
            <div className="md:col-span-2"><Label>Rationale</Label><Textarea value={redactForm.rationale} onChange={(e) => setRedactForm({ ...redactForm, rationale: e.target.value })} /></div>
            <div><Button type="submit" disabled={redactMutation.isPending}>Propose Redaction</Button></div>
          </form>

          <table className="w-full text-sm border rounded-lg">
            <thead><tr className="border-b text-left"><th className="p-2">Ref</th><th className="p-2">Document</th><th className="p-2">Reason</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead>
            <tbody>
              {(redactions as any[]).map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2 font-mono">{r.reference_number}</td>
                  <td className="p-2">{r.document_ref}</td>
                  <td className="p-2">{String(r.redaction_reason).replace(/_/g, " ")}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2 space-x-1">
                    {r.status === "pending_review" && <Button size="sm" onClick={() => reviewRedactMutation.mutate({ redactionId: r.id, decision: "approved" })}>Approve</Button>}
                    {r.status === "approved" && <Button size="sm" variant="secondary" onClick={() => reviewRedactMutation.mutate({ redactionId: r.id, decision: "applied" })}>Mark Applied</Button>}
                  </td>
                </tr>
              ))}
              {(redactions as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={5}>No redactions proposed.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
