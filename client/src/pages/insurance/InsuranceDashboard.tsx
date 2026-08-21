import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ExportButton } from "@/components/ExportButton";
import { Shield, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

function fmtDate(v: any, len = 10): string {
  if (!v) return "—";
  if (typeof v === "string") return v.slice(0, len);
  if (v instanceof Date) return v.toISOString().slice(0, len);
  return String(v).slice(0, len);
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    active: "bg-green-500/15 text-green-600 dark:text-green-400", suspended: "bg-red-500/15 text-red-600 dark:text-red-400",
    settled: "bg-green-500/15 text-green-600 dark:text-green-400", approved: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    under_investigation: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400", rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
    expired: "bg-muted text-foreground", pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  };
  return <Badge className={map[s] ?? "bg-muted text-foreground"}>{s.replace(/_/g, " ")}</Badge>;
}

export default function InsuranceDashboard() {
  
  const [tab, setTab] = useState("companies");
  const [search, setSearch] = useState("");
  const [claimStatus, setClaimStatus] = useState("all");
  const [fraudOnly, setFraudOnly] = useState(false);
  const [updateClaimId, setUpdateClaimId] = useState<number | null>(null);
  const [updateStatus, setUpdateStatus] = useState("approved");
  const [approvedAmount, setApprovedAmount] = useState("");

  const stats = trpc.insurance.getStats.useQuery();
  const companies = trpc.insurance.listCompanies.useQuery({ search: search || undefined });
  const policies = trpc.insurance.listPolicies.useQuery();
  const claims = trpc.insurance.listClaims.useQuery({
    status: claimStatus === "all" ? undefined : claimStatus,
    fraudFlag: fraudOnly || undefined,
  });

  const updateClaim = trpc.insurance.updateClaimStatus.useMutation({
    onSuccess: () => {
      toast.success("Claim updated: Insurance claim status has been updated.");
      claims.refetch();
      setUpdateClaimId(null);
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const s = stats.data as any;
  const fmtNgn = (n: number | string) => `₦${(Number(n) / 1e9).toFixed(1)}B`;
  const fmt = (n: number | string) => Number(n).toLocaleString();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" /> Insurance Regulatory Module
        </h1>
        <p className="text-sm text-muted-foreground mt-1">NAICOM — Licences, Policies, Claims & Data Sovereignty Enforcement</p>
        <ExportButton data={companies.data?.data ?? []} filename="insurance-companies" label="Export" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Total Companies" value={s?.total_companies ?? "—"} />
        <StatCard label="Compliant" value={s?.compliant_companies ?? "—"} color="text-green-600" />
        <StatCard label="Suspended" value={s?.suspended_companies ?? "—"} color="text-red-600" />
        <StatCard label="Claims Under Investigation" value={s?.claims_under_investigation ?? "—"} color="text-orange-600" />
        <StatCard label="Fraud Claims" value={s?.fraud_claims ?? "—"} color="text-red-600" />
        <StatCard label="Gross Premium" value={s ? fmtNgn(s.total_gross_premium) : "—"} />
        <StatCard label="Cross-Border Policies" value={s?.cross_border_policies ?? "—"} color="text-orange-600" />
        <StatCard label="NDPC Registered" value={s?.ndpc_registered ?? "—"} color="text-green-600" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
        </TabsList>

        <TabsContent value="companies" className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Company","NAICOM Licence","Type","Policies","Gross Premium","Claims Ratio","Solvency Ratio","Compliant","NDPC","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(companies.data?.data as any[] ?? []).map((c: any) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{c.company_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.naicom_licence_number}</td>
                    <td className="px-3 py-2 text-xs">{c.licence_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{fmt(c.policy_count ?? 0)}</td>
                    <td className="px-3 py-2">{c.gross_premium_ngn ? fmtNgn(c.gross_premium_ngn) : "—"}</td>
                    <td className="px-3 py-2">
                      <span className={Number(c.claims_ratio) > 75 ? "text-red-600 font-bold" : ""}>{c.claims_ratio}%</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={Number(c.solvency_ratio) < 100 ? "text-red-600 font-bold" : "text-green-600"}>{c.solvency_ratio}%</span>
                    </td>
                    <td className="px-3 py-2">{c.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{c.ndpc_registered ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{statusBadge(c.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="policies" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Policy Ref","Company","Type","Policyholder","Sum Insured","Annual Premium","Data Country","Cross-Border Reinsurance","Reinsurance Country","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(policies.data as any[] ?? []).map((p: any) => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{p.policy_ref}</td>
                    <td className="px-3 py-2">{p.company_name}</td>
                    <td className="px-3 py-2 text-xs">{p.policy_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{p.policyholder_name}</td>
                    <td className="px-3 py-2">{p.sum_insured_ngn ? fmtNgn(p.sum_insured_ngn) : "—"}</td>
                    <td className="px-3 py-2">{p.annual_premium_ngn ? `₦${fmt(p.annual_premium_ngn)}` : "—"}</td>
                    <td className="px-3 py-2">{p.data_storage_country}</td>
                    <td className="px-3 py-2">{p.cross_border_reinsurance ? <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400">Yes</Badge> : "No"}</td>
                    <td className="px-3 py-2">{p.reinsurance_country ?? "—"}</td>
                    <td className="px-3 py-2">{statusBadge(p.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="claims" className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={claimStatus} onValueChange={setClaimStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {["pending","approved","settled","under_investigation","rejected"].map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={fraudOnly} onChange={e => setFraudOnly(e.target.checked)} />
              Fraud-flagged only
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Claim Ref","Company","Policyholder","Type","Claimed","Approved","Fraud Score","Status","Submitted","Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(claims.data as any[] ?? []).map((c: any) => (
                  <tr key={c.id} className={`border-t border-border hover:bg-muted/30 ${c.fraud_flag ? "bg-red-50/30" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs">{c.claim_ref}</td>
                    <td className="px-3 py-2">{c.company_name}</td>
                    <td className="px-3 py-2">{c.policyholder_name}</td>
                    <td className="px-3 py-2 text-xs">{c.claim_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{c.claim_amount_ngn ? fmtNgn(c.claim_amount_ngn) : "—"}</td>
                    <td className="px-3 py-2">{c.approved_amount_ngn ? fmtNgn(c.approved_amount_ngn) : "—"}</td>
                    <td className="px-3 py-2">
                      {c.fraud_flag ? (
                        <span className="text-red-600 font-bold flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />{c.fraud_score}%
                        </span>
                      ) : <span className="text-green-600">{c.fraud_score}%</span>}
                    </td>
                    <td className="px-3 py-2">{statusBadge(c.status)}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(c.submitted_at)}</td>
                    <td className="px-3 py-2">
                      {!["settled", "rejected"].includes(c.status) && (
                        <Dialog open={updateClaimId === c.id} onOpenChange={o => { if (!o) setUpdateClaimId(null); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" onClick={() => setUpdateClaimId(c.id)}>Update</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Update Claim Status</DialogTitle></DialogHeader>
                            <div className="space-y-3 pt-2">
                              <p className="text-sm text-muted-foreground">Claim: <strong>{c.claim_ref}</strong></p>
                              <div>
                                <Label>New Status</Label>
                                <Select value={updateStatus} onValueChange={setUpdateStatus}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {["approved","settled","rejected","under_investigation"].map(s => (
                                      <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label>Approved Amount (₦)</Label>
                                <Input type="number" value={approvedAmount} onChange={e => setApprovedAmount(e.target.value)} placeholder="e.g. 2000000" />
                              </div>
                              <Button onClick={() => updateClaim.mutate({ id: c.id, status: updateStatus, approvedAmountNgn: approvedAmount ? Number(approvedAmount) : undefined })} disabled={updateClaim.isPending} className="w-full">
                                {updateClaim.isPending ? "Updating..." : "Update Claim"}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
