import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Handshake, RefreshCw } from "lucide-react";

const ICOOP_STATUSES = ["draft", "sent", "acknowledged", "fulfilled", "declined", "withdrawn"] as const;
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  sent: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  acknowledged: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  fulfilled: "bg-green-500/20 text-green-300 border-green-500/40",
  declined: "bg-red-500/20 text-red-300 border-red-500/40",
  withdrawn: "bg-muted text-muted-foreground border-border",
};

export default function InternationalCooperation() {
  const counterparts = trpc.internationalCooperation.listCounterparts.useQuery({});
  const mous = trpc.internationalCooperation.listMous.useQuery({});
  const [direction, setDirection] = useState<string>("");
  const requests = trpc.internationalCooperation.listRequests.useQuery({
    direction: (direction || undefined) as "outbound" | "inbound" | undefined,
  });
  const deadlines = trpc.internationalCooperation.inboundDeadlineDashboard.useQuery();
  const evidencePkgs = trpc.internationalCooperation.listEvidencePackages.useQuery({});

  const refresh = () => { counterparts.refetch(); mous.refetch(); requests.refetch(); deadlines.refetch(); evidencePkgs.refetch(); };

  const [reqForm, setReqForm] = useState({ direction: "outbound" as "outbound" | "inbound", counterpart_dpa_id: "", subject: "", legal_basis: "", statutory_deadline: "" });
  const createRequest = trpc.internationalCooperation.createRequest.useMutation({
    onSuccess: () => { toast.success("Cooperation request created"); setReqForm({ ...reqForm, subject: "", legal_basis: "", statutory_deadline: "" }); requests.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const transition = trpc.internationalCooperation.transitionRequest.useMutation({
    onSuccess: () => { toast.success("Request transitioned"); requests.refetch(); deadlines.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [declineFor, setDeclineFor] = useState<number | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const [mouForm, setMouForm] = useState({ title: "", counterpart_dpa_id: "", signed_date: "", effective_date: "" });
  const registerMou = trpc.internationalCooperation.registerMou.useMutation({
    onSuccess: () => { toast.success("Instrument registered"); setMouForm({ title: "", counterpart_dpa_id: "", signed_date: "", effective_date: "" }); mous.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "International Cooperation" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Handshake className="h-6 w-6" /> International Cooperation</h1>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="deadlines">Inbound deadlines</TabsTrigger>
          <TabsTrigger value="counterparts">Counterpart DPAs</TabsTrigger>
          <TabsTrigger value="instruments">MoUs &amp; instruments</TabsTrigger>
          <TabsTrigger value="evidence">Shared evidence</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">New cooperation request</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div>
                <Label>Direction</Label>
                <Select value={reqForm.direction} onValueChange={(v) => setReqForm({ ...reqForm, direction: v as "outbound" | "inbound" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Counterpart DPA</Label>
                <Select value={reqForm.counterpart_dpa_id} onValueChange={(v) => setReqForm({ ...reqForm, counterpart_dpa_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {((counterparts.data as any[]) ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.country})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Subject (min 5 chars)</Label>
                <Input value={reqForm.subject} onChange={(e) => setReqForm({ ...reqForm, subject: e.target.value })} />
              </div>
              <div>
                <Label>Statutory deadline</Label>
                <Input type="date" value={reqForm.statutory_deadline} onChange={(e) => setReqForm({ ...reqForm, statutory_deadline: e.target.value })} />
              </div>
              <div className="md:col-span-4">
                <Label>Legal basis (optional)</Label>
                <Textarea value={reqForm.legal_basis} onChange={(e) => setReqForm({ ...reqForm, legal_basis: e.target.value })} rows={2} />
              </div>
              <Button
                disabled={createRequest.isPending || !reqForm.counterpart_dpa_id || reqForm.subject.trim().length < 5}
                onClick={() => createRequest.mutate({
                  direction: reqForm.direction,
                  counterpart_dpa_id: Number(reqForm.counterpart_dpa_id),
                  subject: reqForm.subject.trim(),
                  legal_basis: reqForm.legal_basis || undefined,
                  statutory_deadline: reqForm.statutory_deadline || undefined,
                })}
              >Create</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Requests</CardTitle>
              <div className="pt-2">
                <Select value={direction || "all"} onValueChange={(v) => setDirection(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Both directions</SelectItem>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>Direction</TableHead><TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead><TableHead>Deadline</TableHead><TableHead className="text-right">Transition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((requests.data as any[]) ?? []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.id}</TableCell>
                      <TableCell>{r.direction}</TableCell>
                      <TableCell className="max-w-[260px] truncate">{r.subject}</TableCell>
                      <TableCell><Badge variant="outline" className={STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.statutory_deadline ? String(r.statutory_deadline).slice(0, 10) : "—"}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {!["fulfilled", "declined", "withdrawn"].includes(r.status) && (
                          <>
                            <Select onValueChange={(v) => {
                              if (v === "declined") { setDeclineFor(r.id); setDeclineReason(""); }
                              else transition.mutate({ id: r.id, to: v as (typeof ICOOP_STATUSES)[number] });
                            }}>
                              <SelectTrigger className="w-36 h-8 inline-flex"><SelectValue placeholder="Move to…" /></SelectTrigger>
                              <SelectContent>
                                {ICOOP_STATUSES.filter((s) => s !== r.status).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {((requests.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No requests.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {declineFor != null && (
                <div className="border border-red-500/40 rounded-lg p-3 flex gap-2 items-end">
                  <div className="flex-1">
                    <Label htmlFor="ic-decline">Decline reason (min 5 chars)</Label>
                    <Input id="ic-decline" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
                  </div>
                  <Button size="sm" variant="destructive" disabled={transition.isPending || declineReason.trim().length < 5} onClick={() => transition.mutate({ id: declineFor, to: "declined", decline_reason: declineReason.trim() })}>Decline</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeclineFor(null)}>Cancel</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deadlines" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Inbound statutory deadlines</CardTitle>
              <CardDescription>NDPC obligations to respond to counterpart DPAs within statutory windows.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead>Deadline</TableHead><TableHead>State</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {((deadlines.data as any[]) ?? []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.id}</TableCell>
                      <TableCell className="max-w-[280px] truncate">{r.subject}</TableCell>
                      <TableCell><Badge variant="outline" className={STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge></TableCell>
                      <TableCell className="text-sm">{r.statutory_deadline ? String(r.statutory_deadline).slice(0, 10) : "—"}</TableCell>
                      <TableCell>
                        <span className={r.deadline_state === "breached" ? "text-red-400" : r.deadline_state === "due_soon" ? "text-yellow-400" : "text-green-400"}>
                          {String(r.deadline_state ?? "—").replaceAll("_", " ")}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {((deadlines.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No inbound requests with deadlines.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="counterparts" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Counterpart data protection authorities</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Name</TableHead><TableHead>Country</TableHead><TableHead>Region</TableHead><TableHead>Networks</TableHead><TableHead>Active</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {((counterparts.data as any[]) ?? []).map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.country}</TableCell>
                      <TableCell>{c.region}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{Array.isArray(c.networks) ? c.networks.join(", ") : (c.networks ?? "—")}</TableCell>
                      <TableCell>{c.active ? "yes" : "no"}</TableCell>
                    </TableRow>
                  ))}
                  {((counterparts.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No counterpart DPAs registered.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="instruments" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Register MoU / instrument</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div className="md:col-span-2">
                <Label>Title (min 5 chars)</Label>
                <Input value={mouForm.title} onChange={(e) => setMouForm({ ...mouForm, title: e.target.value })} />
              </div>
              <div>
                <Label>Counterpart DPA</Label>
                <Select value={mouForm.counterpart_dpa_id} onValueChange={(v) => setMouForm({ ...mouForm, counterpart_dpa_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {((counterparts.data as any[]) ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Signed</Label>
                <Input type="date" value={mouForm.signed_date} onChange={(e) => setMouForm({ ...mouForm, signed_date: e.target.value })} />
              </div>
              <Button
                disabled={registerMou.isPending || mouForm.title.trim().length < 5 || !mouForm.counterpart_dpa_id}
                onClick={() => registerMou.mutate({
                  title: mouForm.title.trim(),
                  counterpart_dpa_id: Number(mouForm.counterpart_dpa_id),
                  signed_date: mouForm.signed_date || undefined,
                  effective_date: mouForm.effective_date || undefined,
                })}
              >Register</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Registered instruments</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Counterpart</TableHead><TableHead>Signed</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {((mous.data as any[]) ?? []).map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.title}</TableCell>
                      <TableCell>{String(m.instrument_type ?? "mou").replaceAll("_", " ")}</TableCell>
                      <TableCell>{m.counterpart_name ?? `#${m.counterpart_dpa_id}`}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.signed_date ? String(m.signed_date).slice(0, 10) : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {((mous.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No instruments registered.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Shared evidence packages</CardTitle>
              <CardDescription>Evidence packages shared with / received from counterpart authorities.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Request</TableHead><TableHead>Package</TableHead><TableHead>Shared</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(((evidencePkgs.data as any)?.rows ?? (evidencePkgs.data as any[])) ?? []).map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono">{p.id}</TableCell>
                      <TableCell>#{p.request_id}</TableCell>
                      <TableCell className="text-sm">{p.package_ref ?? p.title ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.shared_at ?? p.created_at ? new Date(p.shared_at ?? p.created_at).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(((evidencePkgs.data as any)?.rows ?? (evidencePkgs.data as any[])) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No evidence packages shared.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
