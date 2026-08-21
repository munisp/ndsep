import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Shield, Eye, EyeOff, AlertTriangle, Lock, CheckCircle } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const statusColors: Record<string, string> = {
  received: "bg-blue-500/20 text-blue-400",
  under_review: "bg-yellow-500/20 text-yellow-400",
  investigating: "bg-orange-500/20 text-orange-400",
  resolved: "bg-green-500/20 text-green-400",
  dismissed: "bg-muted0/20 text-muted-foreground",
};

const EMPTY_FORM = {
  reportType: "data_breach" as const,
  description: "",
  orgName: "",
  isAnonymous: true,
  contactEmail: "",
};

export default function WhistleblowerPortal() {
  const [showSubmit, setShowSubmit] = useState(false);
  const [showTrack, setShowTrack] = useState(false);
  const [trackRef, setTrackRef] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const { data: reports, refetch } = trpc.phase12.whistleblower.list.useQuery({ status: undefined });

  const trackedReport = showTrack && trackRef.length > 5
    ? reports?.find(r => r.report_ref === trackRef)
    : null;

  const submit = trpc.phase12.whistleblower.submit.useMutation({
    onSuccess: (data: any) => {
      setSubmittedRef(data.report_ref);
      setShowSubmit(false);
      setForm(EMPTY_FORM);
      toast.success(`Report submitted. Reference: ${data.report_ref}`);
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const updateStatus = trpc.phase12.whistleblower.updateStatus.useMutation({
    onSuccess: () => { refetch(); toast.success("Status updated"); },
  });

  const pendingCount = reports?.filter((r: any) => r.status === "received" || r.status === "under_review").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Whistleblower Portal" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-400" /> Whistleblower Portal
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Confidential reporting of NDPA violations — protected under Nigerian Whistleblower Protection Act 2022</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setShowTrack(true)}>
            <Eye className="w-4 h-4 mr-2" /> Track Report
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowSubmit(true)}>
            <AlertTriangle className="w-4 h-4 mr-2" /> Submit Report
          </Button>
        </div>
      </div>

      <Card className="bg-blue-900/20 border-blue-700/40">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 font-medium text-sm">Your identity is protected</p>
              <p className="text-muted-foreground text-sm">All reports are encrypted end-to-end. Anonymous submissions are fully supported. Retaliation against whistleblowers is a criminal offence under Section 12 of the Whistleblower Protection Act.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Reports</p>
            <p className="text-2xl font-bold text-foreground">{reports?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-900/20 border-yellow-700/40">
          <CardContent className="p-4">
            <p className="text-yellow-400 text-xs">Pending Review</p>
            <p className="text-2xl font-bold text-yellow-300">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-900/20 border-green-700/40">
          <CardContent className="p-4">
            <p className="text-green-400 text-xs">Resolved</p>
            <p className="text-2xl font-bold text-green-300">
              {reports?.filter((r: any) => r.status === "resolved").length ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Anonymous</p>
            <p className="text-2xl font-bold text-foreground">
              {reports?.filter((r: any) => r.is_anonymous).length ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader><CardTitle className="text-foreground text-base">Reports (Admin View)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Reference</TableHead>
                <TableHead className="text-muted-foreground">Category</TableHead>
                <TableHead className="text-muted-foreground">Organisation</TableHead>
                <TableHead className="text-muted-foreground">Identity</TableHead>
                <TableHead className="text-muted-foreground">Submitted</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports?.map((r: any) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="text-foreground font-mono text-sm">{r.report_ref}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-border text-muted-foreground capitalize">
                      {String(r.category ?? "").replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.org_name ?? "—"}</TableCell>
                  <TableCell>
                    {r.is_anonymous
                      ? <span className="flex items-center gap-1 text-muted-foreground text-xs"><EyeOff className="w-3 h-3" /> Anonymous</span>
                      : <span className="flex items-center gap-1 text-blue-400 text-xs"><Eye className="w-3 h-3" /> Identified</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[r.status ?? "received"] ?? ""}>{String(r.status ?? "").replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Select value={r.status ?? "received"}
                      onValueChange={v => updateStatus.mutate({ id: r.id, status: v as any })}>
                      <SelectTrigger className="h-7 bg-muted border-border text-foreground text-xs w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="received">Received</SelectItem>
                        <SelectItem value="under_review">Under Review</SelectItem>
                        <SelectItem value="investigating">Investigating</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                        <SelectItem value="dismissed">Dismissed</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Submit Dialog */}
      <Dialog open={showSubmit} onOpenChange={setShowSubmit}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-400" /> Submit Confidential Report
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-sm">Category</Label>
              <Select value={form.reportType} onValueChange={v => setForm(f => ({ ...f, reportType: v as any }))}>
                <SelectTrigger className="mt-1 bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="data_breach">Data Breach</SelectItem>
                  <SelectItem value="unlawful_processing">Unlawful Processing</SelectItem>
                  <SelectItem value="consent_violation">Consent Violation</SelectItem>
                  <SelectItem value="cross_border">Cross-Border Violation</SelectItem>
                  <SelectItem value="bribery">Bribery/Corruption</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Description (min 50 characters)</Label>
              <Textarea className="mt-1 bg-muted border-border text-foreground min-h-[100px]"
                placeholder="Describe the violation in detail..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              <p className="text-muted-foreground text-xs mt-1">{form.description.length}/50 minimum</p>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="anon" checked={form.isAnonymous}
                onChange={e => setForm(f => ({ ...f, isAnonymous: e.target.checked }))} className="w-4 h-4" />
              <Label htmlFor="anon" className="text-muted-foreground text-sm cursor-pointer">Submit anonymously (recommended)</Label>
            </div>
            {!form.isAnonymous && (
              <div>
                <Label className="text-muted-foreground text-sm">Contact Email</Label>
                <Input type="email" className="mt-1 bg-muted border-border text-foreground" value={form.contactEmail}
                  onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700"
              disabled={form.description.length < 50 || submit.isPending}
              onClick={() => submit.mutate({
                category: form.reportType,
                description: form.description,
                isAnonymous: form.isAnonymous,
                reporterEmail: form.contactEmail || undefined,
              })}>
              Submit Securely
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Track Dialog */}
      <Dialog open={showTrack} onOpenChange={setShowTrack}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader><DialogTitle>Track Your Report</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-sm">Report Reference Number</Label>
              <Input className="mt-1 bg-muted border-border text-foreground font-mono"
                placeholder="WBR-2026-XXXXXX"
                value={trackRef}
                onChange={e => setTrackRef(e.target.value.toUpperCase())} />
            </div>
            {trackedReport && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Status</span>
                  <Badge className={statusColors[trackedReport.status ?? "received"] ?? ""}>{String(trackedReport.status ?? "").replace(/_/g, " ")}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Category</span>
                  <span className="text-foreground text-sm capitalize">{String(trackedReport.category ?? "").replace(/_/g, " ")}</span>
                </div>
              </div>
            )}
            {showTrack && trackRef.length > 5 && !trackedReport && (
              <p className="text-muted-foreground text-sm">No report found with reference {trackRef}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {submittedRef && (
        <Card className="bg-green-900/20 border-green-700/40">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <div>
              <p className="text-green-300 font-medium">Report submitted successfully</p>
              <p className="text-muted-foreground text-sm">Reference: <span className="font-mono text-foreground">{submittedRef}</span></p>
            </div>
            <Button variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setSubmittedRef(null)}>×</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
