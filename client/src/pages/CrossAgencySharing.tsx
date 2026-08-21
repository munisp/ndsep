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
import { Share2, Plus, ArrowRight, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const statusColors: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-green-500/20 text-green-400",
  active: "bg-blue-500/20 text-blue-400",
  suspended: "bg-orange-500/20 text-orange-400",
  terminated: "bg-red-500/20 text-red-400",
};

const EMPTY_FORM = {
  requestingAgency: "",
  providingAgency: "",
  datasetName: "",
  purpose: "",
  legalBasis: "public_interest",
  dataCategories: "",
  retentionDays: 90,
};

export default function CrossAgencySharing() {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: agreements, refetch } = trpc.phase12.crossAgency.list.useQuery({});
  const { data: stats } = trpc.phase12.crossAgency.getStats.useQuery();

  const create = trpc.phase12.crossAgency.create.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); setForm(EMPTY_FORM); toast.success("Data sharing agreement created"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const approve = trpc.phase12.crossAgency.approve.useMutation({
    onSuccess: () => { refetch(); toast.success("Agreement approved"); },
  });
  const suspend = trpc.phase12.crossAgency.suspend.useMutation({
    onSuccess: () => { refetch(); toast.success("Agreement suspended"); },
  });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Cross Agency Sharing" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Share2 className="w-6 h-6 text-teal-400" /> Cross-Agency Data Sharing
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Inter-agency data sharing agreements — NDPA Section 24 Public Interest Derogation Framework</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="w-4 h-4 mr-2" /> New Agreement
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Agreements</p>
            <p className="text-2xl font-bold text-foreground">{stats?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-900/20 border-blue-700/40">
          <CardContent className="p-4">
            <p className="text-blue-400 text-xs">Active</p>
            <p className="text-2xl font-bold text-blue-300">{stats?.active ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-900/20 border-yellow-700/40">
          <CardContent className="p-4">
            <p className="text-yellow-400 text-xs">Pending Approval</p>
            <p className="text-2xl font-bold text-yellow-300">{stats?.pending ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-teal-900/20 border-teal-700/40">
          <CardContent className="p-4">
            <p className="text-teal-400 text-xs">Data Transfers (30d)</p>
            <p className="text-2xl font-bold text-teal-300">{stats?.transfers30d ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Agreements Table */}
      <Card className="bg-card/50 border-border">
        <CardHeader><CardTitle className="text-foreground text-base">Data Sharing Agreements</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Reference</TableHead>
                <TableHead className="text-muted-foreground">Flow</TableHead>
                <TableHead className="text-muted-foreground">Dataset</TableHead>
                <TableHead className="text-muted-foreground">Legal Basis</TableHead>
                <TableHead className="text-muted-foreground">Retention</TableHead>
                <TableHead className="text-muted-foreground">Transfers</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agreements?.map((a: any) => (
                <TableRow key={a.id} className="border-border">
                  <TableCell className="text-foreground font-mono text-xs">{a.share_ref}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <span className="text-muted-foreground">{a.requesting_agency}</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <span className="text-muted-foreground">{a.providing_agency}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{a.dataset_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-border text-muted-foreground capitalize text-xs">
                      {String(a.legal_basis ?? "").replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{90}d</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{a.records_shared ?? 0}</TableCell>
                  <TableCell>
                    <Badge className={statusColors[a.status ?? "pending"] ?? ""}>{a.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {a.status === "pending" && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-green-400"
                          onClick={() => approve.mutate({ id: a.id, approvedBy: 'NDPC Admin' })}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      )}
                      {a.status === "active" && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-orange-400"
                          onClick={() => suspend.mutate({ agreementId: a.id, reason: 'Manual suspension' })}>
                          <XCircle className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>New Data Sharing Agreement</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-muted-foreground text-sm">Requesting Agency</Label>
                <Input className="mt-1 bg-muted border-border text-foreground" value={form.requestingAgency}
                  placeholder="e.g. FIRS"
                  onChange={e => setForm(f => ({ ...f, requestingAgency: e.target.value }))} />
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Providing Agency</Label>
                <Input className="mt-1 bg-muted border-border text-foreground" value={form.providingAgency}
                  placeholder="e.g. NIMC"
                  onChange={e => setForm(f => ({ ...f, providingAgency: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Purpose</Label>
              <Input className="mt-1 bg-muted border-border text-foreground" value={form.datasetName}
                onChange={e => setForm(f => ({ ...f, datasetName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Purpose</Label>
              <Textarea className="mt-1 bg-muted border-border text-foreground" value={form.purpose}
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-muted-foreground text-sm">Legal Basis</Label>
                <Select value={form.legalBasis} onValueChange={v => setForm(f => ({ ...f, legalBasis: v }))}>
                  <SelectTrigger className="mt-1 bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="public_interest">Public Interest</SelectItem>
                    <SelectItem value="legal_obligation">Legal Obligation</SelectItem>
                    <SelectItem value="vital_interests">Vital Interests</SelectItem>
                    <SelectItem value="official_authority">Official Authority</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Retention (days)</Label>
                <Input type="number" className="mt-1 bg-muted border-border text-foreground"
                  value={form.retentionDays}
                  onChange={e => setForm(f => ({ ...f, retentionDays: parseInt(e.target.value) || 90 }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-700"
              disabled={!form.requestingAgency || !form.providingAgency || !form.datasetName || create.isPending}
              onClick={() => create.mutate({
                requestingAgency: form.requestingAgency,
                providingAgency: form.providingAgency,
                purpose: form.purpose,
                legalBasis: form.legalBasis as any,
                dataCategories: form.dataCategories.split(",").map(s => s.trim()).filter(Boolean),
              })}>
              Create Agreement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
