import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Search, Send, ShieldCheck, Trash2 } from "lucide-react";
import { OrgIdentityPrefill } from "@/components/OrgIdentityPrefill";

const CATEGORIES = [
  { value: "consent", label: "Consent violation" },
  { value: "breach", label: "Data breach" },
  { value: "cross_border", label: "Unlawful cross-border transfer" },
  { value: "dark_pattern", label: "Deceptive / dark pattern" },
  { value: "excessive_collection", label: "Excessive data collection" },
  { value: "minors", label: "Child / minor data" },
  { value: "other", label: "Other" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  received: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  acknowledged: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  under_review: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  linked_to_case: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  resolved: "bg-green-500/20 text-green-300 border-green-500/40",
  closed: "bg-muted text-muted-foreground border-border",
};

type AttachmentDraft = { filename: string; contentType?: string; contentBase64: string; sha256: string };

async function fileToAttachment(file: File): Promise<AttachmentDraft> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { filename: file.name, contentType: file.type || undefined, contentBase64: btoa(binary), sha256 };
}

function SubmitTab() {
  const [category, setCategory] = useState<string>("consent");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [controllerName, setControllerName] = useState("");
  const [controllerRef, setControllerRef] = useState("");
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [receipt, setReceipt] = useState<{ referenceCode: string; ackSlaDueAt: string } | null>(null);

  const submit = trpc.publicComplaints.submitComplaint.useMutation({
    onSuccess: (res) => {
      setReceipt({ referenceCode: res.referenceCode, ackSlaDueAt: String(res.ackSlaDueAt) });
      toast.success(`Complaint received — reference ${res.referenceCode}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (next.length >= 5) { toast.error("Maximum 5 attachments"); break; }
      if (file.size > 2 * 1024 * 1024) { toast.error(`${file.name}: exceeds 2 MiB limit`); continue; }
      next.push(await fileToAttachment(file));
    }
    setAttachments(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!controllerName && !controllerRef) {
      toast.error("Identify the data controller by name or NDPC registration reference");
      return;
    }
    submit.mutate({
      category: category as (typeof CATEGORIES)[number]["value"],
      subject,
      description,
      controllerName: controllerName || undefined,
      controllerRegistrationRef: controllerRef || undefined,
      state: state || undefined,
      lga: lga || undefined,
      complainantName: name || undefined,
      complainantEmail: email || undefined,
      complainantPhone: phone || undefined,
      attachments,
    });
  };

  if (receipt) {
    return (
      <Card className="border-green-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-400">
            <ShieldCheck className="h-5 w-5" /> Complaint received
          </CardTitle>
          <CardDescription>Keep your reference code — you will need it to track this complaint.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Your reference code</p>
            <p className="text-3xl font-mono font-bold tracking-wider mt-1">{receipt.referenceCode}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Acknowledgement due by {new Date(receipt.ackSlaDueAt).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="secondary" onClick={() => { setReceipt(null); setSubject(""); setDescription(""); setAttachments([]); }}>
              Submit another complaint
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">About the complaint</CardTitle>
          <CardDescription>Complaints are handled under NDPA 2023 s.46. Acknowledgement is due within 72 hours.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="pc-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="pc-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pc-subject">Subject</Label>
            <Input id="pc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary (min 4 characters)" required minLength={4} maxLength={512} />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="pc-description">Description</Label>
            <Textarea id="pc-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what happened, when, and what data was affected (min 20 characters)" required minLength={20} maxLength={20000} rows={5} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">The organisation you are complaining about</CardTitle>
          <CardDescription>If the organisation is registered with the NDPC, look it up once — the identity fields fill in automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OrgIdentityPrefill
            idPrefix="pc-controller"
            label="Controller identity lookup (RC/BN number or NDPC reference)"
            onResolved={(identity) => {
              if (identity.name) setControllerName((v) => v || identity.name!);
              const ref = identity.registrationRef ?? identity.cacNumber ?? identity.rcNumber;
              if (ref) setControllerRef((v) => v || ref);
              if (identity.state) setState((v) => v || identity.state!);
            }}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="pc-org">Organisation name</Label>
            <Input id="pc-org" value={controllerName} onChange={(e) => setControllerName(e.target.value)} placeholder="e.g. Acme Bank PLC" maxLength={256} />
          </div>
          <div>
            <Label htmlFor="pc-ref">NDPC registration reference (optional)</Label>
            <Input id="pc-ref" value={controllerRef} onChange={(e) => setControllerRef(e.target.value)} placeholder="If known" maxLength={64} />
          </div>
          <div>
            <Label htmlFor="pc-state">State (optional)</Label>
            <Input id="pc-state" value={state} onChange={(e) => setState(e.target.value)} maxLength={64} />
          </div>
          <div>
            <Label htmlFor="pc-lga">LGA (optional)</Label>
            <Input id="pc-lga" value={lga} onChange={(e) => setLga(e.target.value)} maxLength={128} />
          </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your details (optional)</CardTitle>
          <CardDescription>You may submit anonymously. If you provide contact details, you will need your email to track the complaint.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="pc-name">Name</Label>
            <Input id="pc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={256} />
          </div>
          <div>
            <Label htmlFor="pc-email">Email</Label>
            <Input id="pc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pc-phone">Phone</Label>
            <Input id="pc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={64} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Paperclip className="h-4 w-4" /> Evidence attachments (optional)</CardTitle>
          <CardDescription>Up to 5 files, 2 MiB each. Files are content-hashed (SHA-256) into the evidence vault.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input type="file" multiple onChange={(e) => addFiles(e.target.files)} />
          {attachments.length > 0 && (
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.sha256} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                  <span className="truncate">{a.filename} <span className="font-mono text-xs text-muted-foreground ml-2">{a.sha256.slice(0, 12)}…</span></span>
                  <button type="button" className="text-red-400 hover:text-red-300" onClick={() => setAttachments(attachments.filter((x) => x.sha256 !== a.sha256))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Button type="submit" size="lg" disabled={submit.isPending} className="w-full md:w-auto">
        {submit.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
        Submit complaint to the NDPC
      </Button>
    </form>
  );
}

function TrackTab() {
  const [referenceCode, setReferenceCode] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState<{ referenceCode: string; complainantEmail?: string } | null>(null);

  const track = trpc.publicComplaints.trackComplaint.useQuery(
    { referenceCode: submitted?.referenceCode ?? "", complainantEmail: submitted?.complainantEmail || undefined },
    { enabled: !!submitted, retry: false }
  );

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    if (referenceCode.trim().length < 10) { toast.error("Enter the full reference code (NDPC-CMP-YYYY-NNNNNN)"); return; }
    setSubmitted({ referenceCode: referenceCode.trim().toUpperCase(), complainantEmail: email.trim() || undefined });
  };

  const result: any = track.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Track a complaint</CardTitle>
          <CardDescription>
            Enter your reference code. If you gave contact details at submission, also enter your email. Fully anonymous complaints need the reference code only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleTrack} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <Label htmlFor="pc-track-ref">Reference code</Label>
              <Input id="pc-track-ref" value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} placeholder="NDPC-CMP-2026-000123" className="font-mono" />
            </div>
            <div>
              <Label htmlFor="pc-track-email">Email (if provided)</Label>
              <Input id="pc-track-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" disabled={track.isFetching}>
              {track.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Track
            </Button>
          </form>
          {track.isError && <p className="text-sm text-red-400 mt-3">{track.error.message}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-lg">
              <FileText className="h-5 w-5" /> {result.reference_code}
              <Badge variant="outline" className={STATUS_BADGE[result.status] ?? ""}>{String(result.status).replaceAll("_", " ")}</Badge>
            </CardTitle>
            <CardDescription>{result.subject}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <p><span className="text-muted-foreground">Category:</span> {String(result.category).replaceAll("_", " ")}</p>
              <p><span className="text-muted-foreground">Received:</span> {new Date(result.received_at).toLocaleString()}</p>
              {result.ack_sla_state && (
                <p>
                  <span className="text-muted-foreground">Acknowledgement SLA:</span>{" "}
                  <span className={result.ack_sla_state === "breached" ? "text-red-400" : "text-green-400"}>{result.ack_sla_state}</span>
                </p>
              )}
              {(["acknowledged_at", "under_review_at", "resolved_at", "closed_at"] as const).map((k) =>
                result[k] ? (
                  <p key={k}><span className="text-muted-foreground">{k.replaceAll("_", " ")}:</span> {new Date(result[k]).toLocaleString()}</p>
                ) : null
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function PublicComplaintPortal() {
  const [tab, setTab] = useState<"submit" | "track">("submit");
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold">NDPC Public Complaints Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Nigeria Data Protection Commission — report unlawful processing of personal data under the Nigeria Data Protection Act 2023.
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant={tab === "submit" ? "default" : "outline"} onClick={() => setTab("submit")}>Submit a complaint</Button>
            <Button variant={tab === "track" ? "default" : "outline"} onClick={() => setTab("track")}>Track a complaint</Button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-6">
        {tab === "submit" ? <SubmitTab /> : <TrackTab />}
      </main>
    </div>
  );
}
