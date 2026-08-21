import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileText, Plus, Search, CheckCircle, XCircle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive"> = {
  approved: "default",
  under_review: "secondary",
  draft: "secondary",
  rejected: "destructive",
};

export default function Phase13Article40() {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code_name: "", sector: "", description: "", submitted_by: "", document_url: "" });

  const utils = trpc.useUtils();
  const { data: records, isLoading } = trpc.phase13.article40.list.useQuery({ search, sector: sector === "all" ? undefined : sector || undefined });
  const create = trpc.phase13.article40.create.useMutation({
    onSuccess: () => {
      utils.phase13.article40.list.invalidate();
      setOpen(false);
      toast.success("Article 40 framework record created");
      setForm({ code_name: "", sector: "", description: "", submitted_by: "", document_url: "" });
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const updateStatus = trpc.phase13.article40.updateStatus.useMutation({
    onSuccess: () => { utils.phase13.article40.list.invalidate(); toast.success("Status updated"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteRecord = trpc.phase13.article40.delete.useMutation({
    onSuccess: () => { utils.phase13.article40.list.invalidate(); toast.success("Record deleted"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (records as any[]) ?? [];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-indigo-600" />
              Article 40 Tracker
            </h1>
            <p className="text-muted-foreground mt-1">NDPA Article 40 — Regulatory Framework Compliance Records</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Record</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Article 40 Framework Record</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Input placeholder="Framework Code Name (e.g. NDPA-2023-FIN)" value={form.code_name} onChange={e => setForm(f => ({ ...f, code_name: e.target.value }))} />
                <Select value={form.sector} onValueChange={v => setForm(f => ({ ...f, sector: v }))}>
                  <SelectTrigger><SelectValue placeholder="Sector" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="banking">Banking & Finance</SelectItem>
                    <SelectItem value="telecom">Telecommunications</SelectItem>
                    <SelectItem value="healthcare">Healthcare</SelectItem>
                    <SelectItem value="government">Government</SelectItem>
                    <SelectItem value="education">Education</SelectItem>
                    <SelectItem value="retail">Retail & E-Commerce</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                <Input placeholder="Submitted By" value={form.submitted_by} onChange={e => setForm(f => ({ ...f, submitted_by: e.target.value }))} />
                <Input placeholder="Document URL (optional)" value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} />
                <Button className="w-full" onClick={() => create.mutate({ code_name: form.code_name, sector: form.sector, description: form.description || undefined, submitted_by: form.submitted_by || undefined, document_url: form.document_url || undefined })} disabled={create.isPending || !form.code_name || !form.sector}>
                  {create.isPending ? "Creating..." : "Create Record"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by code name..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={sector} onValueChange={setSector}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Sectors" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sectors</SelectItem>
              <SelectItem value="banking">Banking</SelectItem>
              <SelectItem value="telecom">Telecom</SelectItem>
              <SelectItem value="healthcare">Healthcare</SelectItem>
              <SelectItem value="government">Government</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Framework Records ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading records...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No Article 40 records found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Code Name</th>
                      <th className="text-left py-2 px-3">Sector</th>
                      <th className="text-left py-2 px-3">Submitted By</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Created</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium font-mono text-xs">{r.code_name}</td>
                        <td className="py-2 px-3">{r.sector}</td>
                        <td className="py-2 px-3">{r.submitted_by ?? "—"}</td>
                        <td className="py-2 px-3">
                          <Badge variant={STATUS_COLORS[r.status] ?? "secondary"}>{r.status?.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            {r.status !== "approved" && (
                              <Button size="sm" variant="ghost" title="Approve" onClick={() => updateStatus.mutate({ id: r.id, status: "approved" })}>
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              </Button>
                            )}
                            {r.status === "draft" && (
                              <Button size="sm" variant="ghost" title="Submit for Review" onClick={() => updateStatus.mutate({ id: r.id, status: "under_review" })}>
                                <FileText className="h-3 w-3 text-blue-600" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" title="Delete" onClick={() => deleteRecord.mutate({ id: r.id })}>
                              <XCircle className="h-3 w-3 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
