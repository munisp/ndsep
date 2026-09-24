import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Scale, CalendarClock, Gavel, PauseCircle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STAY_COLORS: Record<string, string> = {
  active: "text-yellow-400 bg-yellow-900/30",
  lifted: "text-green-400 bg-green-900/30",
  expired: "text-muted-foreground bg-card",
};

export default function AppealsDueProcess() {
  const [deadlinePenaltyId, setDeadlinePenaltyId] = useState("");
  const [hearingForm, setHearingForm] = useState({ appealId: "", hearingDate: "", location: "", mode: "in_person" });
  const [escalateForm, setEscalateForm] = useState({ appealId: "", tribunalName: "", caseNumber: "" });

  const { data: appeals = [], refetch: refetchAppeals } = trpc.appealsDueProcess.listAppealsWithDeadlines.useQuery({});
  const { data: hearings = [], refetch: refetchHearings } = trpc.appealsDueProcess.listAppealHearings.useQuery({});
  const { data: stays = [], refetch: refetchStays } = trpc.appealsDueProcess.listStays.useQuery({});
  const { data: escalations = [] } = trpc.appealsDueProcess.listTribunalEscalations.useQuery({});

  const deadlineQuery = trpc.appealsDueProcess.computeAppealDeadline.useQuery(
    { penaltyId: Number(deadlinePenaltyId) },
    { enabled: false, retry: false }
  );

  const hearingMutation = trpc.appealsDueProcess.scheduleAppealHearing.useMutation({
    onSuccess: () => { toast.success("Hearing scheduled"); setHearingForm({ appealId: "", hearingDate: "", location: "", mode: "in_person" }); refetchHearings(); refetchAppeals(); },
    onError: (e) => toast.error(e.message),
  });
  const escalateMutation = trpc.appealsDueProcess.escalateToTribunal.useMutation({
    onSuccess: () => { toast.success("Escalated to tribunal"); setEscalateForm({ appealId: "", tribunalName: "", caseNumber: "" }); },
    onError: (e) => toast.error(e.message),
  });
  const liftStayMutation = trpc.appealsDueProcess.liftStay.useMutation({
    onSuccess: () => { toast.success("Stay lifted — enforcement resumes"); refetchStays(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Appeals Due Process" }]} />
      <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" /> Appeals Due Process</h1>

      {/* Deadline checker */}
      <section className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Appeal Deadline (30 days from penalty decision)</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!deadlinePenaltyId) return;
            const r = await deadlineQuery.refetch();
            if (r.error) toast.error((r.error as any).message ?? "Lookup failed");
          }}
          className="flex gap-2 items-end"
        >
          <div><Label>Penalty ID</Label><Input type="number" value={deadlinePenaltyId} onChange={(e) => setDeadlinePenaltyId(e.target.value)} /></div>
          <Button type="submit" variant="secondary">Compute</Button>
        </form>
        {deadlineQuery.data && (
          <p className="text-sm">
            Deadline: <strong>{new Date((deadlineQuery.data as any).appeal_deadline).toLocaleDateString()}</strong>
            {" — "}
            {(deadlineQuery.data as any).appeal_expired
              ? <span className="text-red-400">appeal window EXPIRED</span>
              : <span className="text-green-400">{(deadlineQuery.data as any).days_remaining} day(s) remaining</span>}
          </p>
        )}
      </section>

      {/* Appeals with stays */}
      <section className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">Appeals</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">#</th><th className="p-2">Penalty</th><th className="p-2">Submitted by</th><th className="p-2">Status</th><th className="p-2">Days remaining</th><th className="p-2">Stay</th><th className="p-2">Hearings</th></tr></thead>
          <tbody>
            {(appeals as any[]).map((a) => (
              <tr key={a.id} className="border-b">
                <td className="p-2">{a.id}</td>
                <td className="p-2">#{a.penalty_id}</td>
                <td className="p-2">{a.submitted_by}</td>
                <td className="p-2">{a.status}</td>
                <td className="p-2">{a.days_remaining}</td>
                <td className="p-2">{a.stay_status ? <span className={`px-2 py-0.5 rounded text-xs ${STAY_COLORS[a.stay_status] ?? ""}`}>{a.stay_status}</span> : "—"}</td>
                <td className="p-2">{a.hearing_count}</td>
              </tr>
            ))}
            {(appeals as any[]).length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={7}>No appeals on record.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hearing scheduling */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!hearingForm.appealId || !hearingForm.hearingDate) return toast.error("Appeal ID and hearing date required");
            hearingMutation.mutate({
              appealId: Number(hearingForm.appealId),
              hearingDate: new Date(hearingForm.hearingDate).toISOString(),
              location: hearingForm.location || undefined,
              mode: hearingForm.mode as any,
            });
          }}
          className="border rounded-lg p-4 space-y-3"
        >
          <h2 className="font-semibold">Schedule Hearing</h2>
          <div><Label>Appeal ID</Label><Input type="number" value={hearingForm.appealId} onChange={(e) => setHearingForm({ ...hearingForm, appealId: e.target.value })} /></div>
          <div><Label>Hearing date</Label><Input type="datetime-local" value={hearingForm.hearingDate} onChange={(e) => setHearingForm({ ...hearingForm, hearingDate: e.target.value })} /></div>
          <div><Label>Location</Label><Input value={hearingForm.location} onChange={(e) => setHearingForm({ ...hearingForm, location: e.target.value })} /></div>
          <div>
            <Label>Mode</Label>
            <Select value={hearingForm.mode} onValueChange={(v) => setHearingForm({ ...hearingForm, mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in_person">In person</SelectItem>
                <SelectItem value="virtual">Virtual</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={hearingMutation.isPending}>Schedule</Button>
          <ul className="text-sm space-y-1 pt-2">
            {(hearings as any[]).slice(0, 10).map((h) => (
              <li key={h.id} className="flex justify-between border rounded px-2 py-1">
                <span>Appeal #{h.appeal_id} — {new Date(h.hearing_date).toLocaleString()} ({h.mode})</span>
                <span className="text-muted-foreground">{h.status}</span>
              </li>
            ))}
          </ul>
        </form>

        <div className="space-y-4">
          {/* Stays */}
          <section className="border rounded-lg p-4 space-y-2">
            <h2 className="font-semibold flex items-center gap-2"><PauseCircle className="h-4 w-4" /> Enforcement Stays</h2>
            <ul className="text-sm space-y-1">
              {(stays as any[]).slice(0, 10).map((s) => (
                <li key={s.id} className="flex justify-between items-center border rounded px-2 py-1">
                  <span>Penalty #{s.penalty_id} (appeal #{s.appeal_id})</span>
                  <span className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${STAY_COLORS[s.status] ?? ""}`}>{s.status}</span>
                    {s.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => {
                        const reason = window.prompt("Reason for lifting the stay (min 10 chars):");
                        if (reason && reason.length >= 10) liftStayMutation.mutate({ stayId: s.id, liftReason: reason });
                      }}>Lift</Button>
                    )}
                  </span>
                </li>
              ))}
              {(stays as any[]).length === 0 && <li className="text-muted-foreground">No stays recorded.</li>}
            </ul>
          </section>

          {/* Tribunal escalation */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!escalateForm.appealId) return toast.error("Appeal ID required");
              escalateMutation.mutate({
                appealId: Number(escalateForm.appealId),
                tribunalName: escalateForm.tribunalName || undefined,
                caseNumber: escalateForm.caseNumber || undefined,
              });
            }}
            className="border rounded-lg p-4 space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2"><Gavel className="h-4 w-4" /> Tribunal Escalation</h2>
            <div><Label>Appeal ID</Label><Input type="number" value={escalateForm.appealId} onChange={(e) => setEscalateForm({ ...escalateForm, appealId: e.target.value })} /></div>
            <div><Label>Tribunal name</Label><Input value={escalateForm.tribunalName} onChange={(e) => setEscalateForm({ ...escalateForm, tribunalName: e.target.value })} placeholder="Data Protection Tribunal" /></div>
            <div><Label>Case number</Label><Input value={escalateForm.caseNumber} onChange={(e) => setEscalateForm({ ...escalateForm, caseNumber: e.target.value })} /></div>
            <Button type="submit" variant="secondary" disabled={escalateMutation.isPending}>Escalate</Button>
            <ul className="text-sm space-y-1 pt-2">
              {(escalations as any[]).slice(0, 10).map((t) => (
                <li key={t.id} className="flex justify-between border rounded px-2 py-1">
                  <span>Appeal #{t.appeal_id} — {t.tribunal_name} {t.case_number ? `(${t.case_number})` : ""}</span>
                  <span className="text-muted-foreground">{t.status}</span>
                </li>
              ))}
            </ul>
          </form>
        </div>
      </div>
    </div>
  );
}
