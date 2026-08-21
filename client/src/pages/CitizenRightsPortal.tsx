import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { Users, Plus, Clock, CheckCircle, Shield, Search, ChevronRight, RefreshCw, AlertCircle, XCircle, CheckCircle2 , Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const REQUEST_TYPES = [
  { value: "access", label: "Right of Access", desc: "Request a copy of your personal data held by an organisation" },
  { value: "erasure", label: "Right to Erasure", desc: "Request deletion of your personal data ('right to be forgotten')" },
  { value: "portability", label: "Data Portability", desc: "Receive your data in a machine-readable format" },
  { value: "rectification", label: "Right to Rectification", desc: "Correct inaccurate or incomplete personal data" },
  { value: "restriction", label: "Restrict Processing", desc: "Limit how an organisation uses your data" },
  { value: "objection", label: "Right to Object", desc: "Object to processing of your data for specific purposes" },
];

const STATUS_ICONS: Record<string, React.ReactNode> = {
  submitted: <Clock className="w-3 h-3" />,
  acknowledged: <AlertCircle className="w-3 h-3" />,
  in_progress: <RefreshCw className="w-3 h-3" />,
  completed: <CheckCircle2 className="w-3 h-3" />,
  rejected: <XCircle className="w-3 h-3" />,
  escalated: <AlertCircle className="w-3 h-3" />,
};

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  acknowledged: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  in_progress: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  escalated: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export default function CitizenRightsPortal() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"portal" | "tracker" | "admin">("portal");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showSubmit, setShowSubmit] = useState(false);
  const [showReview, setShowReview] = useState<any>(null);
  const [form, setForm] = useState({ requestType: "access", citizenName: "", citizenEmail: "", citizenNin: "", description: "", organizationId: "" });
  const [reviewForm, setReviewForm] = useState({ status: "", responseNotes: "" });
  const [trackingEmail, setTrackingEmail] = useState("");
  const [trackingResults, setTrackingResults] = useState<any[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: requests = [], refetch, isLoading } = trpc.citizenRights.list.useQuery(
    { status: statusFilter === "all" ? undefined : statusFilter },
    { enabled: activeTab === "admin" }
  );
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });

  const submitMutation = trpc.citizenRights.submit.useMutation({
    onSuccess: () => {
      toast.success("Your request has been submitted. You will receive a confirmation within 24 hours.");
      setShowSubmit(false);
      setForm({ requestType: "access", citizenName: "", citizenEmail: "", citizenNin: "", description: "", organizationId: "" });
      refetch();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const handleTrack = () => {
    if (!trackingEmail) return;
    const filtered = (requests as any[]).filter((r: any) => r.citizenEmail?.toLowerCase() === trackingEmail.toLowerCase());
    setTrackingResults(filtered);
  };

  const filteredRequests = (requests as any[]).filter((r: any) => {
    if (!searchQuery) return true;
    return r.citizenName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.citizenEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.requestType?.toLowerCase().includes(searchQuery.toLowerCase());
  });
  const updateMutation = trpc.citizenRights.update.useMutation({
    onSuccess: () => { toast.success("Request updated"); setShowReview(null); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const stats = {
    total: (requests as any[]).length,
    pending: (requests as any[]).filter((r: any) => ["submitted", "acknowledged", "in_progress"].includes(r.status)).length,
    completed: (requests as any[]).filter((r: any) => r.status === "completed").length,
    overdue: (requests as any[]).filter((r: any) => r.dueDate && new Date(r.dueDate) < new Date() && r.status !== "completed").length,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Breadcrumbs items={[{ label: "Portal", href: "/" }, { label: "Citizen Rights Portal" }]} className="mb-4" />
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-teal-900/40 via-gray-900 to-gray-950 border-b border-border">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-teal-600/20 border border-teal-500/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-teal-400" />
            </div>
            <div>
              <div className="text-xs text-teal-400 font-mono uppercase tracking-widest">Nigeria Data Protection Act 2023</div>
              <h1 className="text-2xl font-bold text-foreground">Citizen Data Rights Portal</h1>
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            Under the <strong className="text-teal-300">NDPA 2023</strong>, every Nigerian citizen has the right to access, correct, delete, or restrict processing of their personal data. Submit your request and we will ensure it is processed within the statutory 30-day window.
          </p>
          <div className="flex gap-1 mt-5 bg-background/60 rounded-lg p-1 w-fit border border-border">
            {(["portal", "tracker", ...(user ? ["admin"] : [])] as string[]).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab as any)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab ? "bg-teal-600 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                {tab === "portal" ? "Submit Request" : tab === "tracker" ? "Track My Request" : "Admin Review"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* SUBMIT REQUEST TAB */}
        {activeTab === "portal" && (
          <div>
            {!showSubmit ? (
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4">Your Rights Under NDPA 2023</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                  {REQUEST_TYPES.map((rt) => (
                    <div key={rt.value}
                      className="bg-background border border-border rounded-xl p-4 cursor-pointer hover:border-teal-500/50 transition-all group"
                      onClick={() => { setForm(f => ({ ...f, requestType: rt.value })); setShowSubmit(true); }}>
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold text-foreground text-sm">{rt.label}</h3>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-teal-400 transition-colors" />
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{rt.desc}</p>
                      <div className="mt-3"><span className="text-xs text-teal-400 font-mono">Section 34 NDPA</span></div>
                    </div>
                  ))}
                </div>
                <div className="bg-background border border-border rounded-xl p-5">
                  <h3 className="font-semibold text-foreground mb-4">How It Works</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[
                      { step: "1", title: "Submit Request", desc: "Fill in your details and describe your request" },
                      { step: "2", title: "Acknowledgement", desc: "You receive confirmation within 24 hours" },
                      { step: "3", title: "Processing", desc: "The organisation reviews and processes your request" },
                      { step: "4", title: "Resolution", desc: "Response delivered within 30 days (NDPA mandate)" },
                    ].map((s) => (
                      <div key={s.step} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-teal-600/20 border border-teal-500/30 flex items-center justify-center text-teal-400 text-sm font-bold flex-shrink-0">{s.step}</div>
                        <div><div className="text-sm font-medium text-foreground">{s.title}</div><div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-2xl">
                <div className="flex items-center gap-3 mb-5">
                  <Button variant="outline" size="sm" onClick={() => setShowSubmit(false)} className="border-border text-muted-foreground">← Back</Button>
                  <h2 className="text-lg font-semibold text-foreground">{REQUEST_TYPES.find(r => r.value === form.requestType)?.label}</h2>
                </div>
                <div className="bg-background border border-border rounded-xl p-6 space-y-4">
                  <div>
                    <Label className="text-muted-foreground text-sm">Request Type</Label>
                    <Select value={form.requestType} onValueChange={v => setForm(p => ({ ...p, requestType: v }))}>
                      <SelectTrigger className="bg-card border-border mt-1 text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {REQUEST_TYPES.map(rt => <SelectItem key={rt.value} value={rt.value} className="text-foreground">{rt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><Label className="text-muted-foreground text-sm">Full Name <span className="text-red-400">*</span></Label><Input value={form.citizenName} onChange={e => setForm(p => ({ ...p, citizenName: e.target.value }))} className="bg-card border-border mt-1 text-foreground" placeholder="Your full legal name" /></div>
                    <div><Label className="text-muted-foreground text-sm">Email Address <span className="text-red-400">*</span></Label><Input type="email" value={form.citizenEmail} onChange={e => setForm(p => ({ ...p, citizenEmail: e.target.value }))} className="bg-card border-border mt-1 text-foreground" placeholder="your@email.com" /></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><Label className="text-muted-foreground text-sm">NIN (optional)</Label><Input value={form.citizenNin} onChange={e => setForm(p => ({ ...p, citizenNin: e.target.value }))} className="bg-card border-border mt-1 text-foreground" placeholder="National ID Number" /></div>
                    <div>
                      <Label className="text-muted-foreground text-sm">Organisation (optional)</Label>
                      <Select value={form.organizationId} onValueChange={v => setForm(p => ({ ...p, organizationId: v }))}>
                        <SelectTrigger className="bg-card border-border mt-1 text-foreground"><SelectValue placeholder="Select organisation..." /></SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-48">
                          {(orgs as any[]).map((org: any) => <SelectItem key={org.id} value={String(org.id)} className="text-foreground">{org.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label className="text-muted-foreground text-sm">Description <span className="text-red-400">*</span></Label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="bg-card border-border mt-1 text-foreground" rows={4} placeholder="Describe your request in detail..." /></div>
                  <div className="bg-teal-900/20 border border-teal-500/20 rounded-lg p-3 text-xs text-teal-300">
                    Organisations must acknowledge within 24 hours and respond within 30 days. Non-compliance may result in NITDA regulatory action.
                  </div>
                  <div className="flex gap-3 pt-1">
                    <Button variant="outline" onClick={() => setShowSubmit(false)} className="border-border text-muted-foreground">Cancel</Button>
                    <Button onClick={() => submitMutation.mutate({ ...form, organizationId: form.organizationId ? Number(form.organizationId) : undefined } as any)} disabled={!form.citizenName || !form.citizenEmail || !form.description || submitMutation.isPending} className="bg-teal-600 hover:bg-teal-700 text-foreground">
                      {submitMutation.isPending ? "Submitting..." : "Submit Request"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TRACK REQUEST TAB */}
        {activeTab === "tracker" && (
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-foreground mb-2">Track Your Request</h2>
            <p className="text-sm text-muted-foreground mb-5">Enter the email address you used when submitting your request.</p>
            <div className="bg-background border border-border rounded-xl p-6">
              <div className="flex gap-3 mb-5">
                <Input type="email" value={trackingEmail} onChange={e => setTrackingEmail(e.target.value)} placeholder="your@email.com" className="bg-card border-border text-foreground" onKeyDown={e => e.key === "Enter" && handleTrack()} />
                <Button onClick={handleTrack} className="bg-teal-600 hover:bg-teal-700 text-foreground flex-shrink-0"><Search className="w-4 h-4 mr-2" /> Track</Button>
              </div>
              {trackingResults !== null && (
                trackingResults.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground"><Users className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No requests found for this email address.</p></div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">{trackingResults.length} request(s) found</p>
                    {trackingResults.map((r: any) => (
                      <div key={r.id} className="bg-card rounded-lg p-4 border border-border">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="text-sm font-medium text-foreground capitalize">{r.requestType?.replace("_", " ")} Request</div>
                            <div className="text-xs text-muted-foreground mt-0.5">Submitted {new Date(r.submittedAt).toLocaleDateString()}</div>
                          </div>
                          <Badge className={`text-xs border ${STATUS_COLORS[r.status] || ""} flex items-center gap-1`}>{STATUS_ICONS[r.status]}{r.status?.replace("_", " ")}</Badge>
                        </div>
                        {r.responseNotes && <div className="mt-2 pt-2 border-t border-border"><div className="text-xs text-muted-foreground mb-1">Response:</div><div className="text-xs text-muted-foreground">{r.responseNotes}</div></div>}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
            <div className="mt-5 bg-background border border-border rounded-xl p-4">
              <h3 className="text-sm font-medium text-foreground mb-2">Need Help?</h3>
              <p className="text-xs text-muted-foreground">If unresolved within 30 days, escalate to <strong className="text-teal-300">NITDA</strong> at <a href="mailto:complaints@nitda.gov.ng" className="text-teal-400 underline">complaints@nitda.gov.ng</a>.</p>
            </div>
          </div>
        )}

        {/* ADMIN REVIEW TAB */}
        {activeTab === "admin" && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              {[{ label: "Total", value: (requests as any[]).length, color: "text-foreground" }, { label: "Pending", value: (requests as any[]).filter((r: any) => ["submitted","acknowledged","in_progress"].includes(r.status)).length, color: "text-yellow-400" }, { label: "Completed", value: (requests as any[]).filter((r: any) => r.status === "completed").length, color: "text-green-400" }, { label: "Overdue", value: (requests as any[]).filter((r: any) => r.dueDate && new Date(r.dueDate) < new Date() && r.status !== "completed").length, color: "text-red-400" }].map(({ label, value, color }) => (
                <div key={label} className="bg-background border border-border rounded-xl p-4"><div className={`text-2xl font-bold ${color}`}>{value}</div><div className="text-xs text-muted-foreground mt-1">{label}</div></div>
              ))}
            </div>
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by name, email, type..." className="bg-background border-border text-foreground pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all" className="text-foreground">All Statuses</SelectItem>
                  {Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="border-border text-muted-foreground"><RefreshCw className="w-4 h-4 mr-1" /> Refresh</Button>
              <Button onClick={() => setShowSubmit(true)} className="bg-teal-600 hover:bg-teal-700"><Plus className="w-4 h-4 mr-2" /> New Request</Button>
            </div>
            <div className="bg-background border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-background/80">
                  <tr>{["Citizen", "Request Type", "Status", "Submitted", "Due Date", "Actions"].map(h => <th key={h} className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={6} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></td></tr>
                  ) : filteredRequests.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground"><Users className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No requests found</p></td></tr>
                  ) : filteredRequests.map((r: any) => (
                    <tr key={r.id} className="border-b border-border hover:bg-card/30">
                      <td className="px-4 py-3"><div className="font-medium text-foreground text-sm">{r.citizenName}</div><div className="text-xs text-muted-foreground">{r.citizenEmail}</div></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{r.requestType?.replace("_", " ")}</td>
                      <td className="px-4 py-3"><Badge className={`text-xs border ${STATUS_COLORS[r.status] || ""} flex items-center gap-1 w-fit`}>{STATUS_ICONS[r.status]}{r.status?.replace("_", " ")}</Badge></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3"><Button size="sm" variant="outline" className="text-xs border-border text-muted-foreground" onClick={() => { setShowReview(r); setReviewForm({ status: r.status, responseNotes: r.responseNotes || "" }); }}>Review</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {/* Submit Dialog for admin tab */}
      <Dialog open={showSubmit && activeTab === "admin"} onOpenChange={setShowSubmit}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Submit Citizen Rights Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Request Type</Label>
              <Select value={form.requestType} onValueChange={v => setForm(p => ({ ...p, requestType: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="access">Right of Access</SelectItem><SelectItem value="erasure">Right to Erasure</SelectItem><SelectItem value="portability">Data Portability</SelectItem><SelectItem value="rectification">Rectification</SelectItem><SelectItem value="restriction">Restriction of Processing</SelectItem><SelectItem value="objection">Right to Object</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Full Name</Label><Input value={form.citizenName} onChange={e => setForm(p => ({ ...p, citizenName: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>Email</Label><Input type="email" value={form.citizenEmail} onChange={e => setForm(p => ({ ...p, citizenEmail: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>NIN (optional)</Label><Input value={form.citizenNin} onChange={e => setForm(p => ({ ...p, citizenNin: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="bg-card border-border mt-1" rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button onClick={() => submitMutation.mutate(form)} disabled={!form.citizenName || !form.citizenEmail || submitMutation.isPending}>{submitMutation.isPending ? "Submitting..." : "Submit Request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!showReview} onOpenChange={() => setShowReview(null)}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Review Request: {showReview?.citizenName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-card rounded p-3 text-sm text-muted-foreground">{showReview?.description}</div>
            <div><Label>Update Status</Label>
              <Select value={reviewForm.status} onValueChange={v => setReviewForm(p => ({ ...p, status: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Response Notes</Label><Textarea value={reviewForm.responseNotes} onChange={e => setReviewForm(p => ({ ...p, responseNotes: e.target.value }))} className="bg-card border-border mt-1" rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReview(null)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate({ id: showReview.id, ...reviewForm })} disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
