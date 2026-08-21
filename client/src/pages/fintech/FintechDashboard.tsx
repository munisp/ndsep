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
import { CreditCard, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

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
    revoked: "bg-red-500/15 text-red-600 dark:text-red-400", pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    approved: "bg-blue-500/15 text-blue-600 dark:text-blue-400", rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
    flagged: "bg-orange-500/15 text-orange-600 dark:text-orange-400", cleared: "bg-green-500/15 text-green-600 dark:text-green-400",
    under_review: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  };
  return <Badge className={map[s] ?? "bg-muted text-foreground"}>{s.replace(/_/g, " ")}</Badge>;
}

export default function FintechDashboard() {
  
  const [tab, setTab] = useState("companies");
  const [search, setSearch] = useState("");
  const [txStatus, setTxStatus] = useState("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewStatus, setReviewStatus] = useState("cleared");
  const [reviewNote, setReviewNote] = useState("");

  const stats = trpc.fintech.getStats.useQuery();
  const companies = trpc.fintech.listCompanies.useQuery({ search: search || undefined });
  const transactions = trpc.fintech.listDataEvents.useQuery({
    eventType: txStatus === "all" ? undefined : txStatus,
    violationOnly: flaggedOnly || undefined,
  });
  const sandboxApps = trpc.fintech.listOpenBankingConsents.useQuery({});

  const reviewTransaction = trpc.fintech.revokeConsent.useMutation({
    onSuccess: () => {
      toast.success("Transaction reviewed: Transaction status has been updated.");
      transactions.refetch();
      setReviewId(null);
      setReviewNote("");
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const s = stats.data as any;
  const fmtNgn = (n: number | string) => `₦${(Number(n) / 1e9).toFixed(1)}B`;
  const fmt = (n: number | string) => Number(n).toLocaleString();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" /> Fintech Regulatory Module
        </h1>
        <p className="text-sm text-muted-foreground mt-1">CBN Fintech — Licences, Transactions, Sandbox & Data Sovereignty Enforcement</p>
        <ExportButton data={companies.data?.data ?? []} filename="fintech-companies" label="Export" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Total Companies" value={s?.total_companies ?? "—"} />
        <StatCard label="Compliant" value={s?.compliant_companies ?? "—"} color="text-green-600" />
        <StatCard label="Suspended" value={s?.suspended_companies ?? "—"} color="text-red-600" />
        <StatCard label="Flagged Transactions" value={s?.flagged_transactions ?? "—"} color="text-orange-600" />
        <StatCard label="Sandbox Apps" value={s?.sandbox_apps ?? "—"} />
        <StatCard label="Total Tx Volume" value={s ? fmtNgn(s.total_transaction_volume) : "—"} />
        <StatCard label="Cross-Border Tx" value={s?.cross_border_transactions ?? "—"} color="text-orange-600" />
        <StatCard label="NDPC Registered" value={s?.ndpc_registered ?? "—"} color="text-green-600" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="sandbox">Sandbox Apps</TabsTrigger>
        </TabsList>

        <TabsContent value="companies" className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Company","CBN Licence","Type","Users","Tx Volume","Data Country","Compliant","NDPC","Sandbox","Status"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(companies.data?.data as any[] ?? []).map((c: any) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{c.company_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.cbn_licence_number}</td>
                    <td className="px-3 py-2 text-xs">{c.licence_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{fmt(c.registered_users ?? 0)}</td>
                    <td className="px-3 py-2">{c.monthly_transaction_volume_ngn ? fmtNgn(c.monthly_transaction_volume_ngn) : "—"}</td>
                    <td className="px-3 py-2">{c.data_storage_country}</td>
                    <td className="px-3 py-2">{c.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{c.ndpc_registered ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2">{c.sandbox_participant ? <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">Yes</Badge> : "No"}</td>
                    <td className="px-3 py-2">{statusBadge(c.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={txStatus} onValueChange={setTxStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {["pending","approved","flagged","cleared","rejected","under_review"].map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />
              Flagged only
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Event Ref","Company","Type","Data Vol.","Category","Source","Destination","Cross-Border","DL Status","Status","Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(transactions.data as any[] ?? []).map((tx: any) => (
                  <tr key={tx.id} className={`border-t border-border hover:bg-muted/30 ${tx.data_localisation_flag ? "bg-orange-50/30" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs">{tx.transaction_ref}</td>
                    <td className="px-3 py-2">{tx.company_name}</td>
                    <td className="px-3 py-2 text-xs">{tx.transaction_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{tx.amount_ngn ? fmtNgn(tx.amount_ngn) : "—"}</td>
                    <td className="px-3 py-2">{tx.currency}</td>
                    <td className="px-3 py-2">{tx.sender_country}</td>
                    <td className="px-3 py-2">{tx.receiver_country}</td>
                    <td className="px-3 py-2">{tx.is_cross_border ? <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400">Yes</Badge> : "No"}</td>
                    <td className="px-3 py-2">
                      <span className={Number(tx.risk_score) > 70 ? "text-red-600 font-bold" : Number(tx.risk_score) > 40 ? "text-yellow-600" : "text-green-600"}>
                        {tx.risk_score}%
                      </span>
                    </td>
                    <td className="px-3 py-2">{statusBadge(tx.status)}</td>
                    <td className="px-3 py-2">
                      {["flagged","pending","under_review"].includes(tx.status) && (
                        <Dialog open={reviewId === tx.id} onOpenChange={o => { if (!o) setReviewId(null); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" onClick={() => setReviewId(tx.id)}>Review</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Review Transaction</DialogTitle></DialogHeader>
                            <div className="space-y-3 pt-2">
                              <p className="text-sm text-muted-foreground">Tx: <strong>{tx.transaction_ref}</strong></p>
                              <div>
                                <Label>Decision</Label>
                                <Select value={reviewStatus} onValueChange={setReviewStatus}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="cleared">Clear</SelectItem>
                                    <SelectItem value="rejected">Reject</SelectItem>
                                    <SelectItem value="under_review">Escalate for Review</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label>Notes</Label>
                                <Input value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Reason for decision..." />
                              </div>
                              <Button onClick={() => reviewTransaction.mutate({ id: tx.id })} disabled={reviewTransaction.isPending} className="w-full">
                                {reviewTransaction.isPending ? "Submitting..." : "Submit Decision"}
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

        <TabsContent value="sandbox" className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>{["Consent Ref","Company","Data Category","Source Country","Destination","Cross-Border","DL Violation","Status","Granted At"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(sandboxApps.data as any[] ?? []).map((a: any) => (
                  <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{a.app_name}</td>
                    <td className="px-3 py-2">{a.company_name}</td>
                    <td className="px-3 py-2 text-xs">{a.app_category?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{fmt(a.api_calls_last_30d ?? 0)}</td>
                    <td className="px-3 py-2">{fmt(a.test_users ?? 0)}</td>
                    <td className="px-3 py-2">{a.data_storage_country}</td>
                    <td className="px-3 py-2">{a.data_localisation_compliant ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                    <td className="px-3 py-2 text-xs">{a.graduation_date?.slice(0, 10) ?? "—"}</td>
                    <td className="px-3 py-2">{statusBadge(a.status)}</td>
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
