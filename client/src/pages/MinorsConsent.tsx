import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Baby, ShieldCheck, ShieldX } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const TASK_STATUS_COLORS: Record<string, string> = {
  scheduled: "text-blue-400 bg-blue-900/30",
  due: "text-yellow-400 bg-yellow-900/30",
  renewed: "text-green-400 bg-green-900/30",
  expired: "text-red-400 bg-red-900/30",
  blocked: "text-red-400 bg-red-900/30",
};

export default function MinorsConsent() {
  const [form, setForm] = useState({ organization_id: "", data_subject_ref: "", dob: "", method: "document", guardian_name: "", guardian_contact: "" });

  const { data: records = [], refetch: refetchRecords } = trpc.minorsConsent.listAgeAssurances.useQuery({});
  const { data: tasks = [], refetch: refetchTasks } = trpc.minorsConsent.listConsentRefreshTasks.useQuery({});

  const recordMutation = trpc.minorsConsent.recordAgeAssurance.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Age assurance recorded — majority date ${new Date(r.majority_date).toLocaleDateString()}`);
      setForm({ organization_id: "", data_subject_ref: "", dob: "", method: "document", guardian_name: "", guardian_contact: "" });
      refetchRecords();
    },
    onError: (e) => toast.error(e.message),
  });
  const verifyMutation = trpc.minorsConsent.verifyAgeAssurance.useMutation({
    onSuccess: () => { toast.success("Verification recorded"); refetchRecords(); refetchTasks(); },
    onError: (e) => toast.error(e.message),
  });
  const generateMutation = trpc.minorsConsent.generateConsentRefreshTasks.useMutation({
    onSuccess: (r: any) => { toast.success(`Tasks: ${r.created} created, ${r.markedDue} due, ${r.blocked} blocked`); refetchTasks(); },
    onError: (e) => toast.error(e.message),
  });
  const renewMutation = trpc.minorsConsent.renewConsent.useMutation({
    onSuccess: () => { toast.success("Consent renewed — processing unblocked"); refetchTasks(); },
    onError: (e) => toast.error(e.message),
  });
  const blockMutation = trpc.minorsConsent.blockProcessing.useMutation({
    onSuccess: () => { toast.success("Processing blocked pending re-consent"); refetchTasks(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Minors & Consent" }]} />
      <h1 className="text-2xl font-bold flex items-center gap-2"><Baby className="h-6 w-6" /> Minors — Age Assurance & Consent Refresh</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.organization_id || !form.data_subject_ref || !form.dob) return toast.error("Org ID, subject reference and DOB are required");
          recordMutation.mutate({
            organization_id: Number(form.organization_id),
            data_subject_ref: form.data_subject_ref,
            dob: form.dob,
            method: form.method as any,
            guardian_name: form.guardian_name || undefined,
            guardian_contact: form.guardian_contact || undefined,
          });
        }}
        className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
      >
        <div><Label>Organization ID</Label><Input type="number" value={form.organization_id} onChange={(e) => setForm({ ...form, organization_id: e.target.value })} /></div>
        <div><Label>Data subject ref</Label><Input value={form.data_subject_ref} onChange={(e) => setForm({ ...form, data_subject_ref: e.target.value })} placeholder="Internal child identifier" /></div>
        <div><Label>Date of birth</Label><Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
        <div>
          <Label>Assurance method</Label>
          <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="document">Document check</SelectItem>
              <SelectItem value="bank_verification">Bank verification</SelectItem>
              <SelectItem value="guardian_attestation">Guardian attestation</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Guardian name</Label><Input value={form.guardian_name} onChange={(e) => setForm({ ...form, guardian_name: e.target.value })} /></div>
        <div><Label>Guardian contact</Label><Input value={form.guardian_contact} onChange={(e) => setForm({ ...form, guardian_contact: e.target.value })} /></div>
        <div><Button type="submit" disabled={recordMutation.isPending}>Record Age Assurance</Button></div>
      </form>

      <section className="border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Age Assurance Records</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Subject</th><th className="p-2">DOB</th><th className="p-2">Age</th><th className="p-2">Method</th><th className="p-2">Status</th><th className="p-2">Majority (18th birthday)</th><th className="p-2">Action</th></tr></thead>
          <tbody>
            {(records as any[]).map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-2 font-mono">{r.data_subject_ref}</td>
                <td className="p-2">{new Date(r.dob).toLocaleDateString()}</td>
                <td className="p-2">{Math.floor(Number(r.current_age_years ?? 0))}</td>
                <td className="p-2">{String(r.method).replace(/_/g, " ")}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{new Date(r.majority_date).toLocaleDateString()}</td>
                <td className="p-2 space-x-1">
                  {r.status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => verifyMutation.mutate({ id: r.id, decision: "verified" })}><ShieldCheck className="h-3 w-3 mr-1" />Verify</Button>
                      <Button size="sm" variant="destructive" onClick={() => verifyMutation.mutate({ id: r.id, decision: "failed" })}><ShieldX className="h-3 w-3 mr-1" />Fail</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(records as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={7}>No records.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Consent Refresh Tasks (re-consent at majority)</h2>
          <Button variant="outline" onClick={() => generateMutation.mutate({ lookaheadDays: 90 })} disabled={generateMutation.isPending}>
            Generate / Refresh Tasks
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Subject</th><th className="p-2">Majority date</th><th className="p-2">Days left</th><th className="p-2">Status</th><th className="p-2">Processing</th><th className="p-2">Action</th></tr></thead>
          <tbody>
            {(tasks as any[]).map((t) => (
              <tr key={t.id} className="border-b">
                <td className="p-2 font-mono">{t.data_subject_ref}</td>
                <td className="p-2">{new Date(t.majority_date).toLocaleDateString()}</td>
                <td className="p-2">{t.days_until_majority}</td>
                <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${TASK_STATUS_COLORS[t.status] ?? ""}`}>{t.status}</span></td>
                <td className="p-2">{t.processing_blocked ? <span className="text-red-400">BLOCKED</span> : "allowed"}</td>
                <td className="p-2 space-x-1">
                  {["scheduled", "due", "blocked"].includes(t.status) && (
                    <>
                      <Button size="sm" onClick={() => {
                        const name = window.prompt("Consent renewed by (full name of now-adult data subject):");
                        if (name && name.length >= 2) renewMutation.mutate({ taskId: t.id, renewedBy: name });
                      }}>Renew Consent</Button>
                      {t.status !== "blocked" && (
                        <Button size="sm" variant="destructive" onClick={() => {
                          const reason = window.prompt("Reason for blocking processing:");
                          if (reason && reason.length >= 5) blockMutation.mutate({ taskId: t.id, reason });
                        }}>Block</Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(tasks as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={6}>No refresh tasks. Verify an age-assurance record or generate tasks.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
