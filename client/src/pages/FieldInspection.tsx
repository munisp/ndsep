import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ClipboardList, CloudOff, CloudUpload, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const QUEUE_KEY = "ndsep_field_inspection_queue";
const DEVICE_KEY = "ndsep_field_inspection_device";

type QueuedEvidence = {
  evidence_uuid: string;
  evidence_type: "photo" | "document" | "interview_note" | "observation" | "screenshot";
  payload: Record<string, unknown>;
  captured_at: string;
  client_updated_at: string;
  version_vector: Record<string, number>;
  deleted: boolean;
};

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function loadQueue(): QueuedEvidence[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveQueue(items: QueuedEvidence[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

const STATUS_COLORS: Record<string, string> = {
  open: "text-blue-400 bg-blue-900/30",
  in_field: "text-yellow-400 bg-yellow-900/30",
  synced: "text-green-400 bg-green-900/30",
  closed: "text-muted-foreground bg-card",
};

export default function FieldInspection() {
  const deviceId = useMemo(getDeviceId, []);
  const [caseUuid, setCaseUuid] = useState<string>("");
  const [caseTitle, setCaseTitle] = useState("");
  const [caseScope, setCaseScope] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceType, setEvidenceType] = useState<QueuedEvidence["evidence_type"]>("observation");
  const [queue, setQueue] = useState<QueuedEvidence[]>(loadQueue);
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const { data: cases = [], refetch: refetchCases } = trpc.fieldInspection.listCases.useQuery({});
  const { data: syncedEvidence = [], refetch: refetchEvidence } = trpc.fieldInspection.listEvidence.useQuery(
    { case_uuid: caseUuid, includeDeleted: false },
    { enabled: /^[0-9a-f-]{36}$/i.test(caseUuid) }
  );

  const createCaseMutation = trpc.fieldInspection.createCase.useMutation({
    onSuccess: (row: any) => {
      toast.success(`Case opened: ${row.title}`);
      setCaseUuid(row.case_uuid);
      refetchCases();
    },
    onError: (err) => toast.error(err.message),
  });

  const syncMutation = trpc.fieldInspection.syncBatch.useMutation({
    onSuccess: (result: any) => {
      const outcomes = result.results as Array<{ outcome: string }>;
      const conflicts = outcomes.filter((r) => r.outcome.startsWith("conflict")).length;
      toast.success(`Synced ${result.processed} item(s)${conflicts ? ` — ${conflicts} conflict(s) resolved` : ""}`);
      setQueue([]);
      saveQueue([]);
      refetchEvidence();
      refetchCases();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreateCase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseTitle) {
      toast.error("Enter a case title");
      return;
    }
    const uuid = crypto.randomUUID();
    setCaseUuid(uuid);
    createCaseMutation.mutate({ case_uuid: uuid, title: caseTitle, scope: caseScope || undefined });
  };

  const handleQueueEvidence = (e: React.FormEvent) => {
    e.preventDefault();
    if (!evidenceNote) {
      toast.error("Enter an observation note");
      return;
    }
    const now = new Date().toISOString();
    const item: QueuedEvidence = {
      evidence_uuid: crypto.randomUUID(),
      evidence_type: evidenceType,
      payload: { note: evidenceNote },
      captured_at: now,
      client_updated_at: now,
      version_vector: { [deviceId]: Date.now() },
      deleted: false,
    };
    const next = [...queue, item];
    setQueue(next);
    saveQueue(next);
    setEvidenceNote("");
    toast.info("Evidence queued locally — sync when back online");
  };

  const removeQueued = (uuid: string) => {
    const next = queue.filter((q) => q.evidence_uuid !== uuid);
    setQueue(next);
    saveQueue(next);
  };

  const handleSync = () => {
    if (!caseUuid) {
      toast.error("Create or select a case first");
      return;
    }
    if (!queue.length) {
      toast.info("Queue is empty");
      return;
    }
    syncMutation.mutate({ case_uuid: caseUuid, client_device_id: deviceId, items: queue });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Field Inspection" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" /> Offline Field Inspection
        </h1>
        <span className={`text-sm px-3 py-1 rounded-full ${online ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
          {online ? "Online" : "Offline — queueing locally"}
        </span>
      </div>

      {/* Case creation / selection */}
      <section className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">Inspection Case</h2>
        <form onSubmit={handleCreateCase} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="fi-title">Title</Label>
            <Input id="fi-title" value={caseTitle} onChange={(e) => setCaseTitle(e.target.value)} placeholder="e.g. On-site audit — Acme Bank" />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="fi-scope">Scope</Label>
            <Input id="fi-scope" value={caseScope} onChange={(e) => setCaseScope(e.target.value)} placeholder="Systems and premises covered" />
          </div>
          <div className="md:col-span-3">
            <Button type="submit" disabled={createCaseMutation.isPending}>Open Case</Button>
          </div>
        </form>
        {Array.isArray(cases) && cases.length > 0 && (
          <div className="pt-2">
            <Label>Existing cases</Label>
            <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
              {(cases as any[]).map((c) => (
                <button
                  key={c.case_uuid}
                  onClick={() => setCaseUuid(c.case_uuid)}
                  className={`w-full text-left px-3 py-2 rounded border text-sm flex justify-between ${caseUuid === c.case_uuid ? "border-primary" : "border-border"}`}
                >
                  <span>{c.title} <span className="text-muted-foreground">({c.evidence_count} evidence)</span></span>
                  <span className={`px-2 rounded text-xs ${STATUS_COLORS[c.status] ?? ""}`}>{c.status}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Evidence capture + offline queue */}
      <section className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <CloudOff className="h-4 w-4" /> Capture Evidence (queued offline)
        </h2>
        <form onSubmit={handleQueueEvidence} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={evidenceType} onValueChange={(v) => setEvidenceType(v as QueuedEvidence["evidence_type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="observation">Observation</SelectItem>
                  <SelectItem value="photo">Photo</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="interview_note">Interview Note</SelectItem>
                  <SelectItem value="screenshot">Screenshot</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="fi-note">Note</Label>
              <Textarea id="fi-note" value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} placeholder="Describe what was observed in the field" />
            </div>
          </div>
          <Button type="submit" variant="secondary">
            <Plus className="h-4 w-4 mr-1" /> Queue Evidence
          </Button>
        </form>

        <div>
          <div className="flex items-center justify-between mt-4">
            <h3 className="font-medium">Local queue ({queue.length})</h3>
            <Button onClick={handleSync} disabled={syncMutation.isPending || !queue.length}>
              <CloudUpload className="h-4 w-4 mr-1" />
              {syncMutation.isPending ? "Syncing…" : "Sync to Server"}
            </Button>
          </div>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">No queued items.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {queue.map((q) => (
                <li key={q.evidence_uuid} className="flex justify-between items-center border rounded px-3 py-2 text-sm">
                  <span>
                    <span className="font-mono text-xs text-muted-foreground mr-2">{q.evidence_uuid.slice(0, 8)}</span>
                    [{q.evidence_type}] {String(q.payload.note ?? "")}
                  </span>
                  <button onClick={() => removeQueued(q.evidence_uuid)} className="text-red-400 hover:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Synced evidence */}
      <section className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Synced Evidence</h2>
          <Button variant="ghost" size="sm" onClick={() => refetchEvidence()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {!caseUuid ? (
          <p className="text-sm text-muted-foreground">Select a case to view synced evidence.</p>
        ) : (syncedEvidence as any[]).length === 0 ? (
          <p className="text-sm text-muted-foreground">No evidence synced yet for this case.</p>
        ) : (
          <ul className="space-y-1">
            {(syncedEvidence as any[]).map((e) => (
              <li key={e.evidence_uuid} className="border rounded px-3 py-2 text-sm flex justify-between">
                <span>[{e.evidence_type}] {String(e.payload?.note ?? "")}</span>
                <span className="text-muted-foreground text-xs">{new Date(e.captured_at ?? e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
