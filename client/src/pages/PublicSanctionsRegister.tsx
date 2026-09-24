import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Gavel, Search, FileText, ChevronLeft, ShieldCheck } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";

const NOTICE_TYPES = [
  { value: "final_order", label: "Final Order" },
  { value: "undertaking", label: "Undertaking" },
  { value: "administrative_fine", label: "Administrative Fine" },
  { value: "reprimand", label: "Reprimand" },
];

const STATUS_STYLES: Record<string, string> = {
  published: "bg-red-500/15 text-red-600 dark:text-red-400",
  remediated: "bg-green-500/15 text-green-600 dark:text-green-400",
  expired: "bg-muted text-muted-foreground",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" });
}

function ExpiryBadge({ n }: { n: any }) {
  if (n.sanction_active && n.days_remaining !== null && n.days_remaining !== undefined) {
    return <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">{n.days_remaining}d remaining</Badge>;
  }
  if (n.sanction_active) return <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">In force</Badge>;
  if (n.sanction_expired) return <Badge className="bg-muted text-muted-foreground">Period expired</Badge>;
  return null;
}

export default function PublicSanctionsRegister() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [noticeType, setNoticeType] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [delistForm, setDelistForm] = useState({ applicantName: "", applicantEmail: "", remediationSummary: "", evidenceRefs: "" });
  const [showDelistForm, setShowDelistForm] = useState(false);

  const { data: list } = trpc.sanctionsRegister.search.useQuery({
    page, limit: 20,
    query: debouncedQuery || undefined,
    noticeType: noticeType !== "all" ? (noticeType as any) : undefined,
    status: status !== "all" ? (status as any) : undefined,
  });
  const { data: stats } = trpc.sanctionsRegister.stats.useQuery();
  const { data: detail } = trpc.sanctionsRegister.detail.useQuery(
    { id: selectedId! },
    { enabled: selectedId !== null }
  );

  const delistMutation = trpc.sanctionsRegister.requestDelisting.useMutation({
    onSuccess: () => {
      toast.success("Delisting request submitted. NDPC will review your remediation evidence.");
      setShowDelistForm(false);
      setDelistForm({ applicantName: "", applicantEmail: "", remediationSummary: "", evidenceRefs: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  const submitDelisting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    delistMutation.mutate({
      noticeId: selectedId,
      applicantName: delistForm.applicantName,
      applicantEmail: delistForm.applicantEmail,
      remediationSummary: delistForm.remediationSummary,
      evidenceRefs: delistForm.evidenceRefs.split("\n").map((s) => s.trim()).filter(Boolean),
    });
  };

  // ─── Detail view ──────────────────────────────────────────────────────────
  if (selectedId !== null) {
    return (
      <div className="p-6 space-y-6 max-w-4xl">
        <Breadcrumbs items={[{ label: "Public Sanctions Register", href: "/sanctions-register" }, { label: `Notice #${selectedId}` }]} className="mb-4" />
        <Button variant="outline" size="sm" onClick={() => { setSelectedId(null); setShowDelistForm(false); }}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to register
        </Button>
        {!detail ? (
          <p className="text-muted-foreground">Loading notice…</p>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3 flex-wrap">
                <Gavel className="h-6 w-6 text-primary" />
                <CardTitle className="text-xl">{detail.title}</CardTitle>
                <Badge className={STATUS_STYLES[detail.status] ?? ""}>{detail.status}</Badge>
                <ExpiryBadge n={detail} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><p className="text-muted-foreground">Organisation</p><p className="font-medium">{detail.org_name}</p></div>
                <div><p className="text-muted-foreground">Notice type</p><p className="font-medium capitalize">{String(detail.notice_type).replace(/_/g, " ")}</p></div>
                <div><p className="text-muted-foreground">Legal instrument</p><p className="font-medium">{detail.legal_instrument_ref ?? "—"}</p></div>
                <div><p className="text-muted-foreground">Gazette number</p><p className="font-medium font-mono">{detail.gazette_number ?? "—"}</p></div>
                <div><p className="text-muted-foreground">Published</p><p className="font-medium">{fmtDate(detail.published_at)}</p></div>
                <div>
                  <p className="text-muted-foreground">Sanction period</p>
                  <p className="font-medium">{fmtDate(detail.sanction_start)} → {detail.sanction_end ? fmtDate(detail.sanction_end) : "Indefinite"}</p>
                </div>
              </div>
              {detail.summary && <div><p className="text-muted-foreground mb-1">Summary</p><p className="whitespace-pre-wrap">{detail.summary}</p></div>}
              {detail.public_note && (
                <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-3 flex gap-2">
                  <ShieldCheck className="h-5 w-5 text-green-500 shrink-0" />
                  <p>{detail.public_note}</p>
                </div>
              )}
              {detail.pdf_ref && (
                <Button variant="outline" size="sm" asChild>
                  <a href={detail.pdf_ref} target="_blank" rel="noreferrer"><FileText className="h-4 w-4 mr-1" /> View signed notice (PDF)</a>
                </Button>
              )}

              {detail.status === "published" && !showDelistForm && (
                <Button variant="outline" onClick={() => setShowDelistForm(true)}>Apply for delisting after remediation</Button>
              )}
              {showDelistForm && (
                <form onSubmit={submitDelisting} className="border border-border rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold">Delisting request — remediation evidence</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><Label>Contact name *</Label><Input required value={delistForm.applicantName} onChange={(e) => setDelistForm({ ...delistForm, applicantName: e.target.value })} /></div>
                    <div><Label>Contact email *</Label><Input required type="email" value={delistForm.applicantEmail} onChange={(e) => setDelistForm({ ...delistForm, applicantEmail: e.target.value })} /></div>
                  </div>
                  <div><Label>Remediation summary * (min 20 chars)</Label><Textarea required rows={4} value={delistForm.remediationSummary} onChange={(e) => setDelistForm({ ...delistForm, remediationSummary: e.target.value })} /></div>
                  <div><Label>Evidence references (one URL/key per line)</Label><Textarea rows={3} value={delistForm.evidenceRefs} onChange={(e) => setDelistForm({ ...delistForm, evidenceRefs: e.target.value })} /></div>
                  <Button type="submit" disabled={delistMutation.isPending}>{delistMutation.isPending ? "Submitting…" : "Submit delisting request"}</Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ─── Register table view ──────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Public Sanctions Register" }]} className="mb-4" />
      <div className="flex items-center gap-3">
        <Gavel className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Public Sanctions Register</h1>
          <p className="text-muted-foreground text-sm">Published NDPC enforcement notices — NDPA 2023 ss. 48–49</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">In force</p><p className="text-2xl font-bold text-red-500">{stats?.published ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Remediated</p><p className="text-2xl font-bold text-green-500">{stats?.remediated ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Administrative fines</p><p className="text-2xl font-bold">{stats?.fines ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Last 12 months</p><p className="text-2xl font-bold">{stats?.published_last_12m ?? 0}</p></CardContent></Card>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search org, title or Gazette no…" value={query} onChange={(e) => { setQuery(e.target.value); setTimeout(() => setDebouncedQuery(e.target.value), 400); }} />
        </div>
        <Select value={noticeType} onValueChange={setNoticeType}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All notice types</SelectItem>
            {NOTICE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="published">In force</SelectItem>
            <SelectItem value="remediated">Remediated</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle>Notices ({list?.total ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-left">
                  <th className="pb-2 pr-3">Organisation</th><th className="pb-2 pr-3">Notice</th><th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Gazette</th><th className="pb-2 pr-3">Published</th><th className="pb-2 pr-3">Sanction period</th><th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(list?.data ?? []).map((n: any) => (
                  <tr key={n.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedId(n.id)}>
                    <td className="py-2 pr-3 font-medium">{n.org_name}</td>
                    <td className="py-2 pr-3 max-w-xs truncate">{n.title}</td>
                    <td className="py-2 pr-3"><Badge variant="outline">{String(n.notice_type).replace(/_/g, " ")}</Badge></td>
                    <td className="py-2 pr-3 text-xs font-mono">{n.gazette_number ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{fmtDate(n.published_at)}</td>
                    <td className="py-2 pr-3 text-xs">{fmtDate(n.sanction_start)} → {n.sanction_end ? fmtDate(n.sanction_end) : "∞"} <ExpiryBadge n={n} /></td>
                    <td className="py-2"><Badge className={STATUS_STYLES[n.status] ?? ""}>{n.status}</Badge></td>
                  </tr>
                ))}
                {(list?.data ?? []).length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No published notices match your filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between mt-4">
            <p className="text-sm text-muted-foreground">Page {page}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={(list?.data?.length ?? 0) < 20} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
