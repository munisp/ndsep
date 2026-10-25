import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FileCheck, Globe, Loader2, RefreshCw } from "lucide-react";

const DOC_TYPES = ["final_order", "undertaking", "administrative_fine", "reprimand", "decision", "guidance", "other"] as const;
const STATUSES = ["draft", "legal_review", "redaction", "approval", "published", "corrected", "withdrawn"] as const;
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  legal_review: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  redaction: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  approval: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  published: "bg-green-500/20 text-green-300 border-green-500/40",
  corrected: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  withdrawn: "bg-red-500/20 text-red-300 border-red-500/40",
};

export default function PublicationWorkbench() {
  const utils = trpc.useUtils();
  const stats = trpc.publicationWorkbench.stats.useQuery();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const list = trpc.publicationWorkbench.list.useQuery({
    status: (statusFilter || undefined) as (typeof STATUSES)[number] | undefined,
    limit: 50,
  });
  const published = trpc.publicationWorkbench.listPublished.useQuery({ limit: 20 });

  const [selected, setSelected] = useState<number | null>(null);
  const detail = trpc.publicationWorkbench.get.useQuery({ id: selected ?? 0 }, { enabled: selected != null });

  const refresh = () => { list.refetch(); stats.refetch(); published.refetch(); if (selected) detail.refetch(); };

  // Create draft
  const [form, setForm] = useState({ docType: "decision" as (typeof DOC_TYPES)[number], title: "", orgName: "", summary: "", bodyRaw: "", legalInstrumentRef: "", gazetteNumber: "", investigationSensitive: false });
  const createDraft = trpc.publicationWorkbench.createDraft.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Draft #${res.id ?? ""} created`);
      setForm({ ...form, title: "", summary: "", bodyRaw: "", legalInstrumentRef: "", gazetteNumber: "" });
      refresh();
      if (res.id) setSelected(Number(res.id));
    },
    onError: (err) => toast.error(err.message),
  });

  const act = (label: string) => ({
    onSuccess: () => { toast.success(label); refresh(); },
    onError: (err: any) => toast.error(err.message),
  });
  const submitLegal = trpc.publicationWorkbench.submitForLegalReview.useMutation(act("Submitted for legal review"));
  const submitApproval = trpc.publicationWorkbench.submitForApproval.useMutation(act("Submitted for approval"));
  const publish = trpc.publicationWorkbench.publish.useMutation(act("Document published"));

  const [legalNote, setLegalNote] = useState("");
  const recordLegal = trpc.publicationWorkbench.recordLegalReview.useMutation(act("Legal review recorded"));

  const [minorNames, setMinorNames] = useState("");
  const runRedaction = trpc.publicationWorkbench.runRedaction.useMutation(act("Redaction pass complete"));

  const [signoffTaskId, setSignoffTaskId] = useState("");
  const signOff = trpc.publicationWorkbench.signOffRedaction.useMutation(act("Redaction sign-off recorded"));

  const [approveNote, setApproveNote] = useState("");
  const approve = trpc.publicationWorkbench.approve.useMutation(act("Approval decision recorded"));

  const [publicNote, setPublicNote] = useState("");
  const correct = trpc.publicationWorkbench.correct.useMutation(act("Correction submitted for approval"));
  const withdraw = trpc.publicationWorkbench.withdraw.useMutation(act("Document withdrawn"));

  const doc: any = detail.data;
  const st: any = stats.data ?? {};

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Publication Workbench" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileCheck className="h-6 w-6" /> Publication Workbench</h1>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      <p className="text-sm text-muted-foreground">
        NDPA 2023 s.5(1)(f) transparency publications. Pipeline: draft → legal review → redaction → approval → published. Corrections and withdrawals keep a public audit trail.
      </p>

      {/* Pipeline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Drafts", value: st.drafts },
          { label: "In legal review", value: st.in_legal_review },
          { label: "Awaiting approval", value: st.awaiting_approval },
          { label: "Published", value: st.published },
          { label: "In redaction", value: st.in_redaction },
          { label: "Withdrawn", value: st.withdrawn },
          { label: "Corrections pending", value: st.corrections_pending },
          { label: "Redaction sign-offs pending", value: st.pending_redaction_signoffs },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-3"><CardDescription>{k.label}</CardDescription></CardHeader>
            <CardContent className="text-2xl font-mono font-bold">{k.value ?? 0}</CardContent>
          </Card>
        ))}
      </div>

      {/* Create draft */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New draft</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Document type</Label>
              <Select value={form.docType} onValueChange={(v) => setForm({ ...form, docType: v as (typeof DOC_TYPES)[number] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="pw-title">Title</Label>
              <Input id="pw-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pw-org">Organisation name</Label>
              <Input id="pw-org" value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pw-instrument">Legal instrument ref</Label>
              <Input id="pw-instrument" value={form.legalInstrumentRef} onChange={(e) => setForm({ ...form, legalInstrumentRef: e.target.value })} placeholder="e.g. NDPA 2023 s.49" />
            </div>
            <div>
              <Label htmlFor="pw-gazette">Gazette number</Label>
              <Input id="pw-gazette" value={form.gazetteNumber} onChange={(e) => setForm({ ...form, gazetteNumber: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="pw-summary">Public summary</Label>
            <Textarea id="pw-summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={2} />
          </div>
          <div>
            <Label htmlFor="pw-body">Body (source text — redaction applied before publication)</Label>
            <Textarea id="pw-body" value={form.bodyRaw} onChange={(e) => setForm({ ...form, bodyRaw: e.target.value })} rows={5} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.investigationSensitive} onCheckedChange={(c) => setForm({ ...form, investigationSensitive: c === true })} />
            Investigation-sensitive (enhanced redaction review)
          </label>
          <Button
            disabled={createDraft.isPending || form.title.trim().length < 4 || form.bodyRaw.trim().length < 1}
            onClick={() => createDraft.mutate({
              docType: form.docType,
              title: form.title.trim(),
              orgName: form.orgName || undefined,
              summary: form.summary || undefined,
              bodyRaw: form.bodyRaw,
              legalInstrumentRef: form.legalInstrumentRef || undefined,
              gazetteNumber: form.gazetteNumber || undefined,
              investigationSensitive: form.investigationSensitive,
            })}
          >
            {createDraft.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Create draft
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Document list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pipeline</CardTitle>
            <div className="flex items-center gap-3 pt-2">
              <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
              <CardDescription>{list.data?.total ?? 0} document(s)</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[520px] overflow-y-auto">
            {(list.data?.data ?? []).map((d: any) => (
              <button key={d.id} onClick={() => setSelected(d.id)} className={`w-full text-left border rounded px-3 py-2 text-sm ${selected === d.id ? "border-primary" : "border-border"}`}>
                <div className="flex justify-between items-center gap-2">
                  <span className="font-medium truncate">#{d.id} {d.title}</span>
                  <Badge variant="outline" className={STATUS_COLORS[d.status] ?? ""}>{d.status.replaceAll("_", " ")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{d.doc_type.replaceAll("_", " ")} · {d.org_name ?? "—"}</p>
              </button>
            ))}
            {(list.data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No documents in this stage.</p>}
          </CardContent>
        </Card>

        {/* Detail + actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Document actions</CardTitle>
            {doc && <CardDescription>#{doc.id} — {doc.title}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!doc ? (
              <p className="text-muted-foreground">Select a document to run pipeline actions.</p>
            ) : (
              <>
                {doc.summary && <p className="text-muted-foreground">{doc.summary}</p>}

                {doc.status === "draft" && (
                  <Button size="sm" onClick={() => submitLegal.mutate({ id: doc.id })} disabled={submitLegal.isPending}>Submit for legal review</Button>
                )}

                {doc.status === "legal_review" && (
                  <div className="border rounded-lg p-3 space-y-2">
                    <Label htmlFor="pw-legal-note">Legal review note</Label>
                    <Textarea id="pw-legal-note" value={legalNote} onChange={(e) => setLegalNote(e.target.value)} rows={2} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={recordLegal.isPending} onClick={() => recordLegal.mutate({ id: doc.id, decision: "approved", note: legalNote || undefined })}>Legal: approve</Button>
                      <Button size="sm" variant="destructive" disabled={recordLegal.isPending} onClick={() => recordLegal.mutate({ id: doc.id, decision: "rejected", note: legalNote || undefined })}>Legal: reject</Button>
                    </div>
                  </div>
                )}

                {doc.status === "redaction" && (
                  <div className="border rounded-lg p-3 space-y-2">
                    <div>
                      <Label htmlFor="pw-minors">Minor names to redact (comma-separated)</Label>
                      <Input id="pw-minors" value={minorNames} onChange={(e) => setMinorNames(e.target.value)} />
                    </div>
                    <Button
                      size="sm" variant="secondary"
                      disabled={runRedaction.isPending}
                      onClick={() => runRedaction.mutate({ id: doc.id, minorNames: minorNames.split(",").map((s) => s.trim()).filter(Boolean) })}
                    >Run redaction</Button>
                    <div className="border-t pt-2 flex gap-2 items-end">
                      <div className="flex-1">
                        <Label htmlFor="pw-signoff">Sign off redaction task (task id)</Label>
                        <Input id="pw-signoff" type="number" value={signoffTaskId} onChange={(e) => setSignoffTaskId(e.target.value)} />
                      </div>
                      <Button size="sm" disabled={signOff.isPending || !signoffTaskId} onClick={() => signOff.mutate({ redactionTaskId: Number(signoffTaskId) })}>Sign off</Button>
                      <Button size="sm" variant="destructive" disabled={signOff.isPending || !signoffTaskId} onClick={() => signOff.mutate({ redactionTaskId: Number(signoffTaskId), reject: true })}>Reject</Button>
                    </div>
                  </div>
                )}

                {doc.status === "redaction" && (
                  <Button size="sm" onClick={() => submitApproval.mutate({ id: doc.id })} disabled={submitApproval.isPending}>Submit for approval</Button>
                )}

                {doc.status === "approval" && (
                  <div className="border rounded-lg p-3 space-y-2">
                    <Label htmlFor="pw-approve-note">Approval note (dual control — drafter cannot approve)</Label>
                    <Input id="pw-approve-note" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ id: doc.id, decision: "approved", note: approveNote || undefined })}>Approve</Button>
                      <Button size="sm" variant="destructive" disabled={approve.isPending} onClick={() => approve.mutate({ id: doc.id, decision: "rejected", note: approveNote || undefined })}>Reject</Button>
                    </div>
                  </div>
                )}

                {doc.status === "approval" && (
                  <Button size="sm" variant="secondary" onClick={() => publish.mutate({ id: doc.id })} disabled={publish.isPending}>Publish</Button>
                )}

                {["published", "corrected"].includes(doc.status) && (
                  <div className="border rounded-lg p-3 space-y-2">
                    <Label htmlFor="pw-public-note">Public note (min 10 chars)</Label>
                    <Textarea id="pw-public-note" value={publicNote} onChange={(e) => setPublicNote(e.target.value)} rows={2} placeholder="Reason shown publicly for the correction/withdrawal" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" disabled={correct.isPending || publicNote.trim().length < 10} onClick={() => correct.mutate({ id: doc.id, publicNote: publicNote.trim() })}>Issue correction</Button>
                      <Button size="sm" variant="destructive" disabled={withdraw.isPending || publicNote.trim().length < 10} onClick={() => withdraw.mutate({ id: doc.id, publicNote: publicNote.trim() })}>Withdraw</Button>
                    </div>
                  </div>
                )}

                {(doc.redaction_tasks ?? []).length > 0 && (
                  <div>
                    <p className="font-medium mb-1">Redaction tasks</p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {doc.redaction_tasks.map((t: any) => (
                        <li key={t.id}>task #{t.id} — {t.status} · rules: {(t.rules_applied ?? []).length ?? 0}{t.signed_off_at ? ` · signed off ${new Date(t.signed_off_at).toLocaleString()}` : ""}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(doc.approvals ?? []).length > 0 && (
                  <div>
                    <p className="font-medium mb-1">Approval trail</p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {doc.approvals.map((a: any) => (
                        <li key={a.id}>{a.stage} round {a.approval_round} — {a.approver_name}: {a.decision}{a.superseded ? " (superseded)" : ""}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Published register */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Globe className="h-5 w-5" /> Publicly published</CardTitle>
          <CardDescription>Redacted documents visible on the public register.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(published.data?.data ?? []).map((d: any) => (
            <div key={d.id} className="border rounded px-3 py-2 text-sm flex justify-between items-center">
              <div>
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  {d.doc_type.replaceAll("_", " ")} · {d.org_name ?? "—"} · published {d.published_at ? new Date(d.published_at).toLocaleDateString() : "—"}
                  {d.corrected_at ? " · corrected" : ""}
                </p>
              </div>
              <Badge variant="outline" className={STATUS_COLORS[d.status] ?? ""}>{d.status}</Badge>
            </div>
          ))}
          {(published.data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
