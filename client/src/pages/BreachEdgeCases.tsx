import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, Clock, FilePlus } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const PENALTY_STATUS_COLORS: Record<string, string> = {
  draft: "text-yellow-400 bg-yellow-900/30",
  confirmed: "text-red-400 bg-red-900/30",
  waived: "text-green-400 bg-green-900/30",
  cancelled: "text-muted-foreground bg-card",
};

export default function BreachEdgeCases() {
  const [classifyForm, setClassifyForm] = useState({ breach_id: "", joint_controller_ids: "", is_cross_border: false, affected_jurisdictions: "", ransomware_data_exfiltrated: false, processor_origin: false, originating_processor_id: "" });
  const [notifyForm, setNotifyForm] = useState({ breach_id: "", notified_at: "" });
  const [suppForm, setSuppForm] = useState({ breach_id: "", details: "", reason: "" });

  const { data: latePenalties = [], refetch: refetchPenalties } = trpc.breachEdgeCases.listLatePenalties.useQuery({});

  const classifyMutation = trpc.breachEdgeCases.classifyBreach.useMutation({
    onSuccess: () => toast.success("Breach classification updated"),
    onError: (e) => toast.error(e.message),
  });
  const notifyMutation = trpc.breachEdgeCases.recordNdpcNotification.useMutation({
    onSuccess: (r: any) => {
      if (r.notified_late) {
        toast.warning(`LATE notification — ${r.hours_late}h over the 72h window. Penalty draft created (NGN ${r.penalty_draft?.proposed_amount}).`);
      } else {
        toast.success("Notification recorded within the 72-hour window");
      }
      refetchPenalties();
    },
    onError: (e) => toast.error(e.message),
  });
  const confirmMutation = trpc.breachEdgeCases.confirmLatePenalty.useMutation({
    onSuccess: () => { toast.success("Penalty confirmed"); refetchPenalties(); },
    onError: (e) => toast.error(e.message),
  });
  const waiveMutation = trpc.breachEdgeCases.waiveLatePenalty.useMutation({
    onSuccess: () => { toast.success("Penalty waived"); refetchPenalties(); },
    onError: (e) => toast.error(e.message),
  });
  const supplementMutation = trpc.breachEdgeCases.submitSupplement.useMutation({
    onSuccess: () => { toast.success("Supplement submitted"); setSuppForm({ breach_id: "", details: "", reason: "" }); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Breach Edge Cases" }]} />
      <h1 className="text-2xl font-bold flex items-center gap-2"><AlertTriangle className="h-6 w-6" /> Breach Edge Cases</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Extended classification */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!classifyForm.breach_id) return toast.error("Breach ID required");
            classifyMutation.mutate({
              breach_id: Number(classifyForm.breach_id),
              joint_controller_ids: classifyForm.joint_controller_ids ? classifyForm.joint_controller_ids.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : undefined,
              is_cross_border: classifyForm.is_cross_border,
              affected_jurisdictions: classifyForm.affected_jurisdictions ? classifyForm.affected_jurisdictions.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
              ransomware_data_exfiltrated: classifyForm.ransomware_data_exfiltrated,
              processor_origin: classifyForm.processor_origin,
              originating_processor_id: classifyForm.originating_processor_id ? Number(classifyForm.originating_processor_id) : undefined,
            });
          }}
          className="border rounded-lg p-4 space-y-3"
        >
          <h2 className="font-semibold">Extended Classification</h2>
          <div><Label>Breach ID</Label><Input type="number" value={classifyForm.breach_id} onChange={(e) => setClassifyForm({ ...classifyForm, breach_id: e.target.value })} /></div>
          <div><Label>Joint controller IDs (comma-separated)</Label><Input value={classifyForm.joint_controller_ids} onChange={(e) => setClassifyForm({ ...classifyForm, joint_controller_ids: e.target.value })} placeholder="12, 34" /></div>
          <div><Label>Affected jurisdictions (comma-separated)</Label><Input value={classifyForm.affected_jurisdictions} onChange={(e) => setClassifyForm({ ...classifyForm, affected_jurisdictions: e.target.value })} placeholder="NG, GH, EU" /></div>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={classifyForm.is_cross_border} onChange={(e) => setClassifyForm({ ...classifyForm, is_cross_border: e.target.checked })} /> Cross-border</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={classifyForm.ransomware_data_exfiltrated} onChange={(e) => setClassifyForm({ ...classifyForm, ransomware_data_exfiltrated: e.target.checked })} /> Ransomware exfiltration</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={classifyForm.processor_origin} onChange={(e) => setClassifyForm({ ...classifyForm, processor_origin: e.target.checked })} /> Processor-originated</label>
          </div>
          {classifyForm.processor_origin && (
            <div><Label>Originating processor ID</Label><Input type="number" value={classifyForm.originating_processor_id} onChange={(e) => setClassifyForm({ ...classifyForm, originating_processor_id: e.target.value })} /></div>
          )}
          <Button type="submit" disabled={classifyMutation.isPending}>Save Classification</Button>
        </form>

        <div className="space-y-4">
          {/* Notification recording */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!notifyForm.breach_id) return toast.error("Breach ID required");
              notifyMutation.mutate({ breach_id: Number(notifyForm.breach_id), notified_at: notifyForm.notified_at || undefined, complete: true });
            }}
            className="border rounded-lg p-4 space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4" /> Record NDPC Notification (72h rule)</h2>
            <div><Label>Breach ID</Label><Input type="number" value={notifyForm.breach_id} onChange={(e) => setNotifyForm({ ...notifyForm, breach_id: e.target.value })} /></div>
            <div><Label>Notified at (blank = now)</Label><Input type="datetime-local" value={notifyForm.notified_at} onChange={(e) => setNotifyForm({ ...notifyForm, notified_at: e.target.value })} /></div>
            <Button type="submit" disabled={notifyMutation.isPending}>Record Notification</Button>
          </form>

          {/* Supplementation */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!suppForm.breach_id || suppForm.details.length < 10) return toast.error("Breach ID and details (min 10 chars) required");
              supplementMutation.mutate({ breach_id: Number(suppForm.breach_id), supplementary_details: suppForm.details, reason: suppForm.reason || undefined });
            }}
            className="border rounded-lg p-4 space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2"><FilePlus className="h-4 w-4" /> Supplement Incomplete Notification</h2>
            <div><Label>Breach ID</Label><Input type="number" value={suppForm.breach_id} onChange={(e) => setSuppForm({ ...suppForm, breach_id: e.target.value })} /></div>
            <div><Label>Supplementary details</Label><Textarea value={suppForm.details} onChange={(e) => setSuppForm({ ...suppForm, details: e.target.value })} /></div>
            <div><Label>Reason for supplementation</Label><Input value={suppForm.reason} onChange={(e) => setSuppForm({ ...suppForm, reason: e.target.value })} /></div>
            <Button type="submit" variant="secondary" disabled={supplementMutation.isPending}>Submit Supplement</Button>
          </form>
        </div>
      </div>

      {/* Late penalties */}
      <section className="border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Late-Notification Penalty Drafts (auto-generated)</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Breach</th><th className="p-2">Hours late</th><th className="p-2">Proposed (NGN)</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead>
          <tbody>
            {(latePenalties as any[]).map((p) => (
              <tr key={p.id} className="border-b">
                <td className="p-2">#{p.breach_id} — {p.breach_title}</td>
                <td className="p-2">{Number(p.hours_late).toFixed(1)}</td>
                <td className="p-2">{Number(p.proposed_amount).toLocaleString()}</td>
                <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${PENALTY_STATUS_COLORS[p.status] ?? ""}`}>{p.status}</span></td>
                <td className="p-2 space-x-1">
                  {p.status === "draft" && (
                    <>
                      <Button size="sm" variant="destructive" onClick={() => confirmMutation.mutate({ id: p.id })}>Confirm</Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        const reason = window.prompt("Waiver reason (min 10 chars):");
                        if (reason && reason.length >= 10) waiveMutation.mutate({ id: p.id, reason });
                      }}>Waive</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(latePenalties as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={5}>No late-notification penalties.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
