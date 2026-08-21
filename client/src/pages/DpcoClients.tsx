import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Plus, Calendar, TrendingUp, FileCheck, AlertTriangle, RefreshCw, Building2 , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  completed: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  suspended: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  terminated: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

const ENGAGEMENT_LABELS: Record<string, string> = {
  audit: "Compliance Audit",
  dpo_outsourced: "DPO Outsourced",
  training: "Training",
  advisory: "Advisory",
  policy_drafting: "Policy Drafting",
  breach_support: "Breach Support",
  due_diligence: "Due Diligence",
  full_service: "Full Service",
};

export default function DpcoClients() {
  const [showAdd, setShowAdd] = useState(false);
  const [filterDpco, setFilterDpco] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [form, setForm] = useState({
    dpcoOrganisationId: "", organisationId: "", engagementType: "audit",
    status: "active", engagementStart: "", engagementEnd: "",
    contractReference: "", scope: "", retainerFee: "", nextAuditDue: "", notes: "",
  });

  const { data: clients, isLoading, refetch } = trpc.dpco.listClients.useQuery({
    dpcoOrgId: filterDpco !== "all" ? Number(filterDpco) : undefined,
    status: filterStatus !== "all" ? filterStatus : undefined,
  });

  const { data: dpcoList } = trpc.dpco.listOrganisations.useQuery({ status: "active", limit: 100 });
  const { data: orgList } = trpc.organizations.list.useQuery({ limit: 200 });

  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const upsert = trpc.dpco.upsertClient.useMutation({
    onSuccess: () => { toast.success("Client engagement saved"); setShowAdd(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMutation = trpc.dpco.upsertClient.useMutation({
    onSuccess: () => { toast.success("Client engagement removed"); setDeleteId(null); utils.dpco.listClients.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const rows = clients ?? [];
  const activeCount = rows.filter((r: any) => r.status === "active").length;
  const overdueAudits = rows.filter((r: any) => r.next_audit_due && new Date(r.next_audit_due) < new Date()).length;

  return (
    <div className="px-6 py-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Dpco Clients" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary font-mono">DPCO Client Portfolio</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage client engagements, audit schedules, and SLA compliance rates</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-input text-foreground">
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white">
                <Plus className="w-4 h-4 mr-2" /> Add Client
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-background border-border max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-primary">Add Client Engagement</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <Label className="text-foreground text-xs">DPCO Organisation *</Label>
                  <Select value={form.dpcoOrganisationId} onValueChange={v => setForm(f => ({ ...f, dpcoOrganisationId: v }))}>
                    <SelectTrigger className="bg-card border-input text-foreground mt-1">
                      <SelectValue placeholder="Select DPCO" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-48">
                      {(dpcoList?.rows ?? []).map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)} className="text-foreground">{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground text-xs">Client Organisation *</Label>
                  <Select value={form.organisationId} onValueChange={v => setForm(f => ({ ...f, organisationId: v }))}>
                    <SelectTrigger className="bg-card border-input text-foreground mt-1">
                      <SelectValue placeholder="Select organisation" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-48">
                      {((orgList as any)?.organizations ?? []).map((o: any) => (
                        <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground text-xs">Engagement Type</Label>
                  <Select value={form.engagementType} onValueChange={v => setForm(f => ({ ...f, engagementType: v }))}>
                    <SelectTrigger className="bg-card border-input text-foreground mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {Object.entries(ENGAGEMENT_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-foreground">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground text-xs">Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger className="bg-card border-input text-foreground mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {["active","completed","suspended","terminated"].map(s => (
                        <SelectItem key={s} value={s} className="text-foreground">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {[
                  { label: "Contract Reference", key: "contractReference" },
                  { label: "Retainer Fee (₦)", key: "retainerFee", type: "number" },
                  { label: "Engagement Start", key: "engagementStart", type: "date" },
                  { label: "Engagement End", key: "engagementEnd", type: "date" },
                  { label: "Next Audit Due", key: "nextAuditDue", type: "date" },
                ].map(({ label, key, type: t }) => (
                  <div key={key}>
                    <Label className="text-foreground text-xs">{label}</Label>
                    <Input
                      type={t ?? "text"}
                      value={(form as any)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="bg-card border-input text-foreground mt-1"
                    />
                  </div>
                ))}
                <div className="col-span-2">
                  <Label className="text-foreground text-xs">Scope</Label>
                  <textarea
                    value={form.scope}
                    onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
                    className="w-full bg-card border border-input text-foreground rounded-md px-3 py-2 text-sm mt-1 h-20 resize-none"
                    placeholder="Describe the engagement scope..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowAdd(false)} className="border-input text-foreground">Cancel</Button>
                <Button
                  className="bg-primary hover:bg-primary/90 text-white"
                  onClick={() => upsert.mutate({ ...form, dpcoOrganisationId: Number(form.dpcoOrganisationId), organisationId: Number(form.organisationId), retainerFee: form.retainerFee ? Number(form.retainerFee) : undefined } as any)}
                  disabled={!form.dpcoOrganisationId || !form.organisationId || upsert.isPending}
                >
                  {upsert.isPending ? "Saving..." : "Add Client"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Engagements", value: rows.length, icon: Users, color: "text-primary" },
          { label: "Active", value: activeCount, icon: TrendingUp, color: "text-emerald-600" },
          { label: "Overdue Audits", value: overdueAudits, icon: AlertTriangle, color: "text-red-600" },
          { label: "Avg SLA Rate", value: rows.length ? `${Math.round(rows.reduce((a: number, r: any) => a + (r.sla_compliance_rate ?? 100), 0) / rows.length)}%` : "—", icon: FileCheck, color: "text-blue-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
            <Icon className={`w-8 h-8 ${color}`} />
            <div>
              <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
              <div className="text-muted-foreground text-xs">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={filterDpco} onValueChange={setFilterDpco}>
          <SelectTrigger className="w-56 bg-card border-input text-foreground">
            <SelectValue placeholder="All DPCOs" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-48">
            <SelectItem value="all" className="text-foreground">All DPCOs</SelectItem>
            {(dpcoList?.rows ?? []).map((d: any) => (
              <SelectItem key={d.id} value={String(d.id)} className="text-foreground">{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 bg-card border-input text-foreground">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {["all","active","completed","suspended","terminated"].map(s => (
              <SelectItem key={s} value={s} className="text-foreground">{s === "all" ? "All Status" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {["Client Organisation", "DPCO", "Engagement Type", "Contract Ref", "Next Audit Due", "SLA Rate", "CARs", "Status"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-muted-foreground font-mono text-xs font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Loading client portfolio...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No client engagements found. Add your first client above.</td></tr>
              ) : rows.map((c: any) => {
                const overdue = c.next_audit_due && new Date(c.next_audit_due) < new Date();
                return (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-foreground font-medium text-xs">{c.org_name ?? `Org #${c.organisation_id}`}</div>
                      <div className="text-muted-foreground text-xs">{c.org_sector ?? ""}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{c.dpco_name ?? `DPCO #${c.dpco_organisation_id}`}</td>
                    <td className="px-4 py-3 text-foreground text-xs">{ENGAGEMENT_LABELS[c.engagement_type] ?? c.engagement_type}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{c.contract_reference ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className={`text-xs ${overdue ? "text-red-600" : "text-muted-foreground"}`}>
                        {c.next_audit_due ? new Date(c.next_audit_due).toLocaleDateString() : "—"}
                      </div>
                      {overdue && <div className="text-red-500 text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Overdue</div>}
                    </td>
                    <td className="px-4 py-3">
                      {c.sla_compliance_rate != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-muted rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${c.sla_compliance_rate >= 90 ? "bg-emerald-500" : c.sla_compliance_rate >= 70 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${c.sla_compliance_rate}%` }} />
                          </div>
                          <span className="text-xs text-foreground">{Math.round(c.sla_compliance_rate)}%</span>
                        </div>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground text-xs font-mono">{c.cars_completed ?? 0}/{(c.cars_completed ?? 0) + (c.cars_pending ?? 0)}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs border ${STATUS_COLORS[c.status] ?? "bg-muted text-foreground"}`}>{c.status}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border text-muted-foreground text-xs">
          {rows.length} client engagement{rows.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
