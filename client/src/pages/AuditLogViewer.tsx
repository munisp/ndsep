import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSearch, Download, ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";

const PAGE_SIZE = 20;

const ACTION_COLORS: Record<string, string> = {
  create: "#10b981",
  update: "#2563eb",
  delete: "#ef4444",
  resolve: "#f59e0b",
  login:  "#8b5cf6",
  logout: "#6b7280",
};

const RESOURCE_TYPES = ["", "organization", "asset", "catalog_entry", "security_alert", "financial_penalty", "user", "portal_submission"];

export default function AuditLogViewer() {
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterResource, setFilterResource] = useState("");
  const [filterResourceId, setFilterResourceId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [page, setPage] = useState(0);

  // Pre-fill filters from URL query params (e.g. /audit-log?resourceId=5&resourceType=organization)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get("resourceId");
    const rtype = params.get("resourceType");
    if (rid) setFilterResourceId(rid);
    if (rtype) setFilterResource(rtype);
  }, []);

  // Build server-side query params — resourceId and action are sent to DB; date range stays client-side
  const queryParams = useMemo(() => ({
    limit: 500,
    search: search || undefined,
    action: filterAction || undefined,
    resourceType: filterResource || undefined,
    resourceId: filterResourceId ? parseInt(filterResourceId, 10) : undefined,
  }), [search, filterAction, filterResource, filterResourceId]);

  const { data: logs, isLoading, refetch } = trpc.siem.auditLogs.useQuery(
    queryParams,
    { refetchInterval: 30_000 }
  );

  // Date-range filter stays client-side (no DB column index needed for MVP)
  const filtered = useMemo(() => {
    let rows = logs ?? [];
    if (filterDateFrom) rows = rows.filter((r: any) => r.createdAt && new Date(r.createdAt) >= new Date(filterDateFrom));
    if (filterDateTo) rows = rows.filter((r: any) => r.createdAt && new Date(r.createdAt) <= new Date(filterDateTo + "T23:59:59"));
    return rows;
  }, [logs, filterDateFrom, filterDateTo]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const clearFilters = () => {
    setSearch(""); setFilterAction(""); setFilterResource(""); setFilterResourceId("");
    setFilterDateFrom(""); setFilterDateTo(""); setPage(0);
  };

  const exportCsv = () => {
    const headers = ["ID", "User ID", "Org ID", "Action", "Resource Type", "Resource ID", "Details", "IP Address", "Timestamp"];
    const rows = filtered.map((r: any) => [
      r.id, r.userId ?? "", r.organizationId ?? "", r.action ?? "",
      r.resourceType ?? "", r.resourceId ?? "",
      `"${(r.details ?? "").replace(/"/g, "'")}"`,
      r.ipAddress ?? "",
      r.createdAt ? new Date(r.createdAt).toISOString() : "",
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    el.download = "audit-log.csv";
    el.click();
  };

  const hasFilters = search || filterAction || filterResource || filterResourceId || filterDateFrom || filterDateTo;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Audit Log Viewer" }]} />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LAYER 4</span>
            <span className="data-label">7-year retention · Immutable · WORM</span>
          </div>
          <h1 className="text-2xl font-bold">Audit Log Viewer</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">
            Complete record of all write actions — who did what, to which entity, and when.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={exportCsv}>
            <Download className="h-3 w-3" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Entries", value: logs?.length ?? 0 },
          { label: "Filtered Entries", value: filtered.length },
          { label: "Create Actions", value: (logs ?? []).filter((r: any) => r.action?.startsWith("create")).length },
          { label: "Delete Actions", value: (logs ?? []).filter((r: any) => r.action?.startsWith("delete")).length },
        ].map((m) => (
          <Card key={m.label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <p className="data-label">{m.label}</p>
              <p className="metric-value text-2xl font-bold mt-1">{m.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" /> Filters
            </CardTitle>
            {hasFilters && (
              <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="relative md:col-span-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search action or details..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Input
              placeholder="Filter action (e.g. create)"
              value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Resource ID"
              value={filterResourceId}
              onChange={(e) => { setFilterResourceId(e.target.value); setPage(0); }}
              className="h-8 text-xs"
            />
            <Select value={filterResource || "__all__"} onValueChange={(v) => { setFilterResource(v === "__all__" ? "" : v); setPage(0); }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Resource type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All resource types</SelectItem>
                {RESOURCE_TYPES.filter(Boolean).map(r => (
                  <SelectItem key={r} value={r} className="text-xs">{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => { setFilterDateFrom(e.target.value); setPage(0); }}
                className="h-8 text-xs"
                title="From date"
              />
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => { setFilterDateTo(e.target.value); setPage(0); }}
                className="h-8 text-xs"
                title="To date"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-primary" /> Audit Entries
            </CardTitle>
            <span className="data-label">{filtered.length} entries</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["#", "Action", "Resource", "Resource ID", "User", "Org", "Details", "IP", "Timestamp"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : pageRows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No audit log entries match the current filters.</td></tr>
                ) : pageRows.map((r: any) => {
                  const actionBase = (r.action ?? "").split("_")[0];
                  const color = ACTION_COLORS[actionBase] ?? "#6b7280";
                  return (
                    <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 mono text-muted-foreground">{r.id}</td>
                      <td className="px-4 py-2.5">
                        <span className="mono text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color, background: color + "20" }}>
                          {r.action ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground capitalize">{(r.resourceType ?? "—").replace(/_/g, " ")}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{r.resourceId ?? "—"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{r.userId ? `#${r.userId}` : "—"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{r.organizationId ? `#${r.organizationId}` : "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate" title={r.details ?? ""}>{r.details ?? "—"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{r.ipAddress ?? "—"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground whitespace-nowrap">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Page {page + 1} of {totalPages} · {filtered.length} entries</span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
