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
import { ShieldCheck, Plus, Download, FileText, CheckCircle, Clock, XCircle, RefreshCw, Key , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted-foreground/20 text-foreground border-border/30",
  issued: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  submitted: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  revoked: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  expired: "bg-orange-500/20 text-orange-600 border-orange-500/30",
};

const AUDIT_TYPE_LABELS: Record<string, string> = {
  annual_car: "Annual CAR",
  ad_hoc: "Ad-hoc Audit",
  initial: "Initial Assessment",
  follow_up: "Follow-up Review",
  special: "Special Investigation",
};

export default function DpcoVerification() {
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDpco, setFilterDpco] = useState("all");
  const [form, setForm] = useState({
    dpcoOrganisationId: "", organisationId: "", auditType: "annual_car",
    auditPeriodStart: "", auditPeriodEnd: "", auditScope: "",
    keyFindings: "", overallRating: "compliant", ndpcFilingReference: "",
    validUntil: "", remarks: "",
  });

  const { data: statements, isLoading, refetch } = trpc.dpco.listVerificationStatements.useQuery({
    dpcoOrgId: filterDpco !== "all" ? Number(filterDpco) : undefined,
    status: filterStatus !== "all" ? filterStatus : undefined,
  });

  const { data: dpcoList } = trpc.dpco.listOrganisations.useQuery({ status: "active", limit: 100 });
  const { data: orgList } = trpc.organizations.list.useQuery({ limit: 200 });

  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const create = trpc.dpco.createVerificationStatement.useMutation({
    onSuccess: () => { toast.success("Verification statement created"); setShowCreate(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const rows = statements ?? [];

  const handleDownload = (id: number) => {
    window.open(`/api/dpco/verification-statement/${id}/download`, "_blank");
  };

  const RATING_COLORS: Record<string, string> = {
    compliant: "text-emerald-600",
    partially_compliant: "text-yellow-600",
    non_compliant: "text-red-600",
    not_applicable: "text-muted-foreground",
  };

  return (
    <div className="px-6 py-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Dpco Verification" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary font-mono">DPCO Verification Statements</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate PKCS#7-signed verification statements required for all NDPC filings &mdash; NDPA 2023 §33(3)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-input text-foreground">
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white">
                <Plus className="w-4 h-4 mr-2" /> Generate Statement
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-background border-border max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-primary flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" /> Generate DPCO Verification Statement
                </DialogTitle>
              </DialogHeader>
              <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 mt-2">
                <p className="text-blue-600 text-xs">
                  This statement will be digitally signed with the NDSEP platform certificate (PKCS#7 / CAdES).
                  It satisfies the mandatory accompaniment requirement under NDPA §33(3) for all NDPC filings.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <Label className="text-foreground text-xs">Issuing DPCO *</Label>
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
                  <Label className="text-foreground text-xs">Audit Type</Label>
                  <Select value={form.auditType} onValueChange={v => setForm(f => ({ ...f, auditType: v }))}>
                    <SelectTrigger className="bg-card border-input text-foreground mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {Object.entries(AUDIT_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-foreground">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground text-xs">Overall Rating</Label>
                  <Select value={form.overallRating} onValueChange={v => setForm(f => ({ ...f, overallRating: v }))}>
                    <SelectTrigger className="bg-card border-input text-foreground mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {[["compliant","Compliant"],["partially_compliant","Partially Compliant"],["non_compliant","Non-Compliant"],["not_applicable","Not Applicable"]].map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-foreground">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {[
                  { label: "Audit Period Start *", key: "auditPeriodStart", type: "date" },
                  { label: "Audit Period End *", key: "auditPeriodEnd", type: "date" },
                  { label: "NDPC Filing Reference", key: "ndpcFilingReference" },
                  { label: "Valid Until", key: "validUntil", type: "date" },
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
                  <Label className="text-foreground text-xs">Audit Scope *</Label>
                  <textarea
                    value={form.auditScope}
                    onChange={e => setForm(f => ({ ...f, auditScope: e.target.value }))}
                    className="w-full bg-card border border-input text-foreground rounded-md px-3 py-2 text-sm mt-1 h-20 resize-none"
                    placeholder="Describe the audit scope (systems, processes, data categories assessed)..."
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-foreground text-xs">Key Findings</Label>
                  <textarea
                    value={form.keyFindings}
                    onChange={e => setForm(f => ({ ...f, keyFindings: e.target.value }))}
                    className="w-full bg-card border border-input text-foreground rounded-md px-3 py-2 text-sm mt-1 h-20 resize-none"
                    placeholder="Summarise key findings and non-conformities..."
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-foreground text-xs">Remarks</Label>
                  <textarea
                    value={form.remarks}
                    onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                    className="w-full bg-card border border-input text-foreground rounded-md px-3 py-2 text-sm mt-1 h-16 resize-none"
                    placeholder="Additional remarks or conditions..."
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 bg-muted/50 rounded-lg p-3">
                <Key className="w-4 h-4 text-purple-400" />
                <span className="text-muted-foreground text-xs">Statement will be signed with NDSEP Platform Certificate (SHA-256, RSA-2048, CN=NDSEP Platform, C=NG)</span>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowCreate(false)} className="border-input text-foreground">Cancel</Button>
                <Button
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={() => create.mutate({
                    dpcoOrganisationId: Number(form.dpcoOrganisationId),
                    organisationId: Number(form.organisationId),
                    auditType: form.auditType,
                    auditPeriodStart: form.auditPeriodStart,
                    auditPeriodEnd: form.auditPeriodEnd,
                    auditScope: form.auditScope,
                    keyFindings: form.keyFindings || undefined,
                    overallRating: form.overallRating,
                    ndpcFilingReference: form.ndpcFilingReference || undefined,
                    validUntil: form.validUntil || undefined,
                    remarks: form.remarks || undefined,
                  } as any)}
                  disabled={!form.dpcoOrganisationId || !form.organisationId || !form.auditPeriodStart || !form.auditPeriodEnd || !form.auditScope || create.isPending}
                >
                  {create.isPending ? "Generating..." : "Generate & Sign Statement"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Statements", value: rows.length, icon: FileText, color: "text-primary" },
          { label: "Issued", value: rows.filter((r: any) => r.status === "issued").length, icon: CheckCircle, color: "text-emerald-600" },
          { label: "Submitted to NDPC", value: rows.filter((r: any) => r.status === "submitted").length, icon: ShieldCheck, color: "text-blue-600" },
          { label: "Revoked/Expired", value: rows.filter((r: any) => ["revoked","expired"].includes(r.status)).length, icon: XCircle, color: "text-red-600" },
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
            {["all","draft","issued","submitted","revoked","expired"].map(s => (
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
                {["Statement Ref", "DPCO", "Client Organisation", "Audit Type", "Period", "Rating", "Valid Until", "Status", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-muted-foreground font-mono text-xs font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">Loading verification statements...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">No verification statements found. Generate your first statement above.</td></tr>
              ) : rows.map((s: any) => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-primary text-xs">{s.statement_reference ?? `VS-${String(s.id).padStart(6,"0")}`}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{s.dpco_name ?? `DPCO #${s.dpco_organisation_id}`}</td>
                  <td className="px-4 py-3 text-foreground text-xs">{s.org_name ?? `Org #${s.organisation_id}`}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{AUDIT_TYPE_LABELS[s.audit_type] ?? s.audit_type}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {s.audit_period_start ? new Date(s.audit_period_start).toLocaleDateString() : "—"} – {s.audit_period_end ? new Date(s.audit_period_end).toLocaleDateString() : "—"}
                  </td>
                  <td className={`px-4 py-3 text-xs font-medium ${RATING_COLORS[s.overall_rating] ?? "text-muted-foreground"}`}>
                    {s.overall_rating?.replace(/_/g, " ") ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{s.valid_until ? new Date(s.valid_until).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={`text-xs border ${STATUS_COLORS[s.status] ?? "bg-muted text-foreground"}`}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(s.id)}
                      className="border-input text-foreground h-7 px-2 text-xs"
                    >
                      <Download className="w-3 h-3 mr-1" /> PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border text-muted-foreground text-xs flex items-center gap-2">
          <Key className="w-3 h-3 text-purple-400" />
          All statements are digitally signed with PKCS#7 (SHA-256, RSA-2048) &mdash; {rows.length} statement{rows.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
