/**
 * RegIntel — regulatory intelligence corpus browser.
 * Wires the full `regIntel` router (10 procedures): instrument corpus CRUD,
 * versioned ingestion (with explicit degraded-mode surfacing), section browser,
 * askLegal (KGQA / keyword fallback), provenance trail and legal-change alerts.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonTable } from "@/components/Skeleton";
import { BookOpen, Library, Loader2, Plus, RefreshCw, Scale, Search, SendHorizonal, TriangleAlert } from "lucide-react";

const INSTRUMENT_TYPES = ["act", "regulation", "guidance", "subsidiary_legislation", "tribunal_precedent", "court_precedent"] as const;
const RULE_TYPES = ["platform_rule", "workflow", "compliance_check", "penalty_basis"] as const;

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
}

export default function RegIntel() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // ── Corpus list + filters ─────────────────────────────────────────────────
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const instruments = trpc.regIntel.listInstruments.useQuery(
    typeFilter === "all" ? undefined : { instrumentType: typeFilter as (typeof INSTRUMENT_TYPES)[number] }
  );
  const instrumentRows: any[] = useMemo(() => {
    const rows = (instruments.data as any[]) ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.code ?? "").toLowerCase().includes(q) ||
      String(r.title ?? "").toLowerCase().includes(q) ||
      String(r.issuing_authority ?? "").toLowerCase().includes(q)
    );
  }, [instruments.data, search]);

  // ── Instrument detail drawer ──────────────────────────────────────────────
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const detail = trpc.regIntel.getInstrument.useQuery({ code: selectedCode ?? "" }, { enabled: selectedCode != null });
  const [versionLabel, setVersionLabel] = useState<string>("current");
  const sections = trpc.regIntel.listSections.useQuery(
    { instrumentCode: selectedCode ?? "", ...(versionLabel !== "current" ? { versionLabel } : {}) },
    { enabled: selectedCode != null }
  );
  const [sectionSearch, setSectionSearch] = useState("");
  const sectionRows: any[] = useMemo(() => {
    const rows = (sections.data as any[]) ?? [];
    const q = sectionSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) =>
      String(s.section_ref ?? "").toLowerCase().includes(q) ||
      String(s.heading ?? "").toLowerCase().includes(q) ||
      String(s.body_excerpt ?? "").toLowerCase().includes(q)
    );
  }, [sections.data, sectionSearch]);

  // ── Admin: create instrument / add version ────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ code: "", title: "", instrumentType: "act" as (typeof INSTRUMENT_TYPES)[number], issuingAuthority: "", gazetteRef: "" });
  const createInstrument = trpc.regIntel.createInstrument.useMutation({
    onSuccess: (row: any) => { toast.success(`Instrument ${row?.code ?? ""} saved`); setShowCreate(false); setCreateForm({ code: "", title: "", instrumentType: "act", issuingAuthority: "", gazetteRef: "" }); instruments.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [versionForm, setVersionForm] = useState({ versionLabel: "", effectiveDate: "", source: "", fullText: "" });
  const [ingestResult, setIngestResult] = useState<any | null>(null);
  const addVersion = trpc.regIntel.addVersion.useMutation({
    onSuccess: (res: any) => {
      const mode = res?.ingestStatus?.mode;
      toast.success(
        mode === "degraded_local_chunk"
          ? `Version ${res?.versionLabel} ingested in DEGRADED local-chunk mode (${res?.chunkCount} chunks, no embeddings)`
          : `Version ${res?.versionLabel} ingested — ${res?.chunkCount} chunks, ${res?.legalChangeAlerts?.length ?? 0} legal-change alert(s)`
      );
      setIngestResult(res);
      setVersionForm({ versionLabel: "", effectiveDate: "", source: "", fullText: "" });
      detail.refetch(); sections.refetch(); alerts.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  // ── askLegal + provenance ─────────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [answer, setAnswer] = useState<any | null>(null);
  const askLegal = trpc.regIntel.askLegal.useMutation({
    onSuccess: (res: any) => { setAnswer(res); queries.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [queryMode, setQueryMode] = useState<string>("all");
  const queries = trpc.regIntel.listQueries.useQuery({
    limit: 20,
    ...(queryMode === "all" ? {} : { mode: queryMode as "kgqa" | "degraded_keyword_fallback" }),
  });

  // ── Rule references + legal-change alerts ─────────────────────────────────
  const [alertInstrument, setAlertInstrument] = useState<string>("all");
  const alerts = trpc.regIntel.legalChangeAlerts.useQuery(
    alertInstrument === "all" ? undefined : { instrumentCode: alertInstrument }
  );
  const [ruleForm, setRuleForm] = useState({ ruleType: "platform_rule" as (typeof RULE_TYPES)[number], ruleRef: "", instrumentCode: "", sectionRef: "", note: "" });
  const registerRuleReference = trpc.regIntel.registerRuleReference.useMutation({
    onSuccess: () => { toast.success("Rule reference registered"); setRuleForm({ ...ruleForm, ruleRef: "", sectionRef: "", note: "" }); alerts.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const removeRuleReference = trpc.regIntel.removeRuleReference.useMutation({
    onSuccess: () => { toast.success("Rule reference removed"); alerts.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const alertRows: any[] = (alerts.data as any[]) ?? [];
  const queryRows: any[] = (queries.data as any[]) ?? [];
  const versions: any[] = (detail.data?.versions as any[]) ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Regulatory Intelligence" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Library className="h-6 w-6" /> Regulatory Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Versioned corpus of Nigerian data-protection instruments — NDPA 2023, GAID 2025, subsidiary legislation and precedents.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => utils.regIntel.invalidate()}><RefreshCw className="h-4 w-4" /></Button>
          {isAdmin && (
            <Button onClick={() => setShowCreate((v) => !v)}><Plus className="h-4 w-4 mr-2" /> New instrument</Button>
          )}
        </div>
      </div>

      {showCreate && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create instrument</CardTitle>
            <CardDescription>Codes are uppercase, e.g. NDPA-2023. Existing codes are updated in place.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label htmlFor="ri-code">Code</Label>
              <Input id="ri-code" value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })} placeholder="NDPA-2023" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="ri-title">Title</Label>
              <Input id="ri-title" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={createForm.instrumentType} onValueChange={(v) => setCreateForm({ ...createForm, instrumentType: v as (typeof INSTRUMENT_TYPES)[number] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INSTRUMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ri-auth">Issuing authority (optional)</Label>
              <Input id="ri-auth" value={createForm.issuingAuthority} onChange={(e) => setCreateForm({ ...createForm, issuingAuthority: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ri-gazette">Gazette ref (optional)</Label>
              <Input id="ri-gazette" value={createForm.gazetteRef} onChange={(e) => setCreateForm({ ...createForm, gazetteRef: e.target.value })} />
            </div>
            <div className="flex gap-2 md:col-span-3">
              <Button disabled={createInstrument.isPending || createForm.code.trim().length < 2 || createForm.title.trim().length < 4}
                onClick={() => createInstrument.mutate({
                  code: createForm.code.trim(),
                  title: createForm.title.trim(),
                  instrumentType: createForm.instrumentType,
                  ...(createForm.issuingAuthority.trim() ? { issuingAuthority: createForm.issuingAuthority.trim() } : {}),
                  ...(createForm.gazetteRef.trim() ? { gazetteRef: createForm.gazetteRef.trim() } : {}),
                })}>
                {createInstrument.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save instrument
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="corpus">
        <TabsList>
          <TabsTrigger value="corpus">Corpus</TabsTrigger>
          <TabsTrigger value="ask">Ask legal</TabsTrigger>
          <TabsTrigger value="alerts">Rule refs &amp; change alerts</TabsTrigger>
        </TabsList>

        {/* ── Corpus ── */}
        <TabsContent value="corpus" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Legal instruments</CardTitle>
              <CardDescription>Click a row to open the version chain, sections and ingestion status.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[220px]">
                  <Label htmlFor="ri-search">Search</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input id="ri-search" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="code, title or authority…" />
                  </div>
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {INSTRUMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {instruments.isLoading ? <SkeletonTable rows={5} cols={5} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Issuing authority</TableHead>
                      <TableHead>Current version</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {instrumentRows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => { setSelectedCode(r.code); setVersionLabel("current"); setSectionSearch(""); setIngestResult(null); }}>
                        <TableCell className="font-mono font-medium">{r.code}</TableCell>
                        <TableCell className="text-sm max-w-[360px] truncate">{r.title}</TableCell>
                        <TableCell><Badge variant="outline">{String(r.instrument_type ?? "").replaceAll("_", " ")}</Badge></TableCell>
                        <TableCell className="text-sm">{r.issuing_authority ?? "—"}</TableCell>
                        <TableCell className="text-sm font-mono">{r.current_version ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">{r.status ?? "active"}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {instrumentRows.length === 0 && (
                      <TableRow><TableCell colSpan={6}>
                        <EmptyState icon={BookOpen} title="No instruments in the corpus" description="Ingest a legal instrument to start building the regulatory knowledge base." />
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Ask legal ── */}
        <TabsContent value="ask" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Scale className="h-5 w-5" /> Ask the corpus</CardTitle>
              <CardDescription>
                Answers are produced by the EPR-KGQA worker when configured; otherwise a clearly-labelled degraded keyword fallback over the corpus. Every answer persists provenance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[280px]">
                  <Label htmlFor="ri-question">Question (min 8 chars)</Label>
                  <Textarea id="ri-question" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)}
                    placeholder="e.g. What are the breach notification timelines under NDPA 2023?" />
                </div>
                <div>
                  <Label htmlFor="ri-topk">Top K</Label>
                  <Input id="ri-topk" type="number" min={1} max={10} className="w-24" value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
                </div>
                <Button disabled={askLegal.isPending || question.trim().length < 8}
                  onClick={() => askLegal.mutate({ question: question.trim(), topK: Math.min(10, Math.max(1, topK || 5)) })}>
                  {askLegal.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <SendHorizonal className="h-4 w-4 mr-2" />} Ask
                </Button>
              </div>
              {answer && (
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={answer.mode === "kgqa" ? "bg-green-500/20 text-green-300 border-green-500/40" : "bg-orange-500/20 text-orange-300 border-orange-500/40"}>
                      {answer.mode === "kgqa" ? "KGQA" : "degraded keyword fallback"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">query #{answer.id}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
                  {(answer.citations ?? []).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Citations</p>
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Instrument</TableHead><TableHead>Section</TableHead><TableHead>Version</TableHead><TableHead>Effective</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {(answer.citations as any[]).map((c, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-sm">{c.instrument}</TableCell>
                              <TableCell className="text-sm">{c.section_ref}</TableCell>
                              <TableCell className="text-sm font-mono">{c.version_label}</TableCell>
                              <TableCell className="text-sm">{fmtDate(c.effective_date)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Query provenance</CardTitle>
              <CardDescription>Past questions, retrieval mode and citations (officer/auditor trail).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Mode filter</Label>
                <Select value={queryMode} onValueChange={setQueryMode}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All modes</SelectItem>
                    <SelectItem value="kgqa">kgqa</SelectItem>
                    <SelectItem value="degraded_keyword_fallback">degraded keyword fallback</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {queries.isLoading ? <SkeletonTable rows={3} cols={5} /> : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Question</TableHead><TableHead>Mode</TableHead><TableHead>Answer excerpt</TableHead><TableHead>Asked by</TableHead><TableHead>At</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {queryRows.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="text-sm max-w-[260px] truncate">{q.question}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={q.mode === "kgqa" ? "" : "bg-orange-500/20 text-orange-300 border-orange-500/40"}>
                            {q.mode === "kgqa" ? "kgqa" : "fallback"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[320px] truncate text-muted-foreground">{q.answer_excerpt ?? "—"}</TableCell>
                        <TableCell className="text-sm">{q.asked_by ?? "anonymous"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{q.created_at ? new Date(q.created_at).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {queryRows.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No queries recorded yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Rule refs & alerts ── */}
        <TabsContent value="alerts" className="mt-4 space-y-4">
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Register rule ↔ section reference</CardTitle>
                <CardDescription>Map a platform rule / workflow to a legal section so future supersessions surface it as a change alert.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div>
                  <Label>Rule type</Label>
                  <Select value={ruleForm.ruleType} onValueChange={(v) => setRuleForm({ ...ruleForm, ruleType: v as (typeof RULE_TYPES)[number] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RULE_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ri-ruleref">Rule ref</Label>
                  <Input id="ri-ruleref" value={ruleForm.ruleRef} onChange={(e) => setRuleForm({ ...ruleForm, ruleRef: e.target.value })} placeholder="e.g. breach-sla-72h" />
                </div>
                <div>
                  <Label htmlFor="ri-rule-inst">Instrument code</Label>
                  <Input id="ri-rule-inst" value={ruleForm.instrumentCode} onChange={(e) => setRuleForm({ ...ruleForm, instrumentCode: e.target.value.toUpperCase() })} placeholder="NDPA-2023" />
                </div>
                <div>
                  <Label htmlFor="ri-rule-sec">Section ref</Label>
                  <Input id="ri-rule-sec" value={ruleForm.sectionRef} onChange={(e) => setRuleForm({ ...ruleForm, sectionRef: e.target.value })} placeholder="Section 40" />
                </div>
                <div className="flex gap-2">
                  <Button disabled={registerRuleReference.isPending || ruleForm.ruleRef.trim().length < 2 || ruleForm.instrumentCode.trim().length < 2 || !ruleForm.sectionRef.trim()}
                    onClick={() => registerRuleReference.mutate({
                      ruleType: ruleForm.ruleType,
                      ruleRef: ruleForm.ruleRef.trim(),
                      instrumentCode: ruleForm.instrumentCode.trim(),
                      sectionRef: ruleForm.sectionRef.trim(),
                      ...(ruleForm.note.trim() ? { note: ruleForm.note.trim() } : {}),
                    })}>
                    {registerRuleReference.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Register
                  </Button>
                </div>
                <div className="md:col-span-5">
                  <Label htmlFor="ri-rule-note">Note (optional)</Label>
                  <Input id="ri-rule-note" value={ruleForm.note} onChange={(e) => setRuleForm({ ...ruleForm, note: e.target.value })} />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><TriangleAlert className="h-5 w-5" /> Legal-change alerts</CardTitle>
              <CardDescription>Rules/workflows referencing sections whose version has been superseded — review after each new instrument version.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Instrument filter</Label>
                <Select value={alertInstrument} onValueChange={setAlertInstrument}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All instruments</SelectItem>
                    {instrumentRows.map((r) => <SelectItem key={r.code} value={r.code}>{r.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {alerts.isLoading ? <SkeletonTable rows={3} cols={6} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead><TableHead>Type</TableHead><TableHead>Instrument</TableHead><TableHead>Section</TableHead>
                      <TableHead>Superseded → current</TableHead><TableHead>Note</TableHead>
                      {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alertRows.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-sm">{a.rule_ref}</TableCell>
                        <TableCell><Badge variant="outline">{String(a.rule_type ?? "").replaceAll("_", " ")}</Badge></TableCell>
                        <TableCell className="font-mono text-sm">{a.instrument}</TableCell>
                        <TableCell className="text-sm">{a.section_ref}</TableCell>
                        <TableCell className="text-sm font-mono">{a.superseded_version} → {a.current_version}</TableCell>
                        <TableCell className="text-sm max-w-[240px] truncate">{a.note ?? "—"}</TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" disabled={removeRuleReference.isPending}
                              onClick={() => removeRuleReference.mutate({ id: a.id })}>Remove ref</Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {alertRows.length === 0 && (
                      <TableRow><TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground">No legal-change alerts — no rules reference superseded sections.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Instrument detail drawer */}
      <Sheet open={selectedCode != null} onOpenChange={(o) => !o && setSelectedCode(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-mono">{detail.data?.code ?? selectedCode}</SheetTitle>
            <SheetDescription>{detail.data?.title}</SheetDescription>
          </SheetHeader>
          {detail.isLoading ? <SkeletonTable rows={4} cols={2} /> : detail.data ? (
            <div className="space-y-5 mt-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-xs text-muted-foreground">Type</p><p>{String(detail.data.instrument_type ?? "").replaceAll("_", " ")}</p></div>
                <div><p className="text-xs text-muted-foreground">Issuing authority</p><p>{detail.data.issuing_authority ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Gazette ref</p><p>{detail.data.gazette_ref ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><p>{detail.data.status ?? "active"}</p></div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Version chain (supersession)</p>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Version</TableHead><TableHead>Effective</TableHead><TableHead>Status</TableHead><TableHead>Supersedes</TableHead><TableHead className="text-right">Sections</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((v) => (
                      <TableRow key={v.id} className="cursor-pointer" onClick={() => setVersionLabel(v.version_label)}>
                        <TableCell className="font-mono text-sm">{v.version_label}</TableCell>
                        <TableCell className="text-sm">{fmtDate(v.effective_date)}</TableCell>
                        <TableCell><Badge variant="outline" className={v.status === "current" ? "bg-green-500/20 text-green-300 border-green-500/40" : ""}>{v.status}</Badge></TableCell>
                        <TableCell className="text-sm font-mono">{v.supersedes_label ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">{v.section_count ?? 0}</TableCell>
                      </TableRow>
                    ))}
                    {versions.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No versions ingested yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {isAdmin && (
                <div className="border rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium">Add version (ingest full text)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="ri-vlabel">Version label</Label>
                      <Input id="ri-vlabel" value={versionForm.versionLabel} onChange={(e) => setVersionForm({ ...versionForm, versionLabel: e.target.value })} placeholder="e.g. 2025 Amendment" />
                    </div>
                    <div>
                      <Label htmlFor="ri-veff">Effective date</Label>
                      <Input id="ri-veff" type="date" value={versionForm.effectiveDate} onChange={(e) => setVersionForm({ ...versionForm, effectiveDate: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor="ri-vsrc">Source (optional)</Label>
                      <Input id="ri-vsrc" value={versionForm.source} onChange={(e) => setVersionForm({ ...versionForm, source: e.target.value })} placeholder="gazette URL / reference" />
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor="ri-vtext">Full text (min 50 chars)</Label>
                      <Textarea id="ri-vtext" rows={8} value={versionForm.fullText} onChange={(e) => setVersionForm({ ...versionForm, fullText: e.target.value })}
                        placeholder="Paste the full instrument text — it will be chunked by section and embedded by the ingest worker when configured." />
                    </div>
                  </div>
                  <Button disabled={addVersion.isPending || !versionForm.versionLabel.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(versionForm.effectiveDate) || versionForm.fullText.trim().length < 50}
                    onClick={() => selectedCode && addVersion.mutate({
                      instrumentCode: selectedCode,
                      versionLabel: versionForm.versionLabel.trim(),
                      effectiveDate: versionForm.effectiveDate,
                      fullText: versionForm.fullText,
                      ...(versionForm.source.trim() ? { source: versionForm.source.trim() } : {}),
                    })}>
                    {addVersion.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Ingest version
                  </Button>
                  {ingestResult && (
                    <div className="border rounded p-3 text-sm space-y-1">
                      <p className="font-medium">Ingestion result — {ingestResult.versionLabel}</p>
                      <p className="text-muted-foreground">
                        mode <span className="font-mono">{String(ingestResult.ingestStatus?.mode ?? "—")}</span>
                        {" · "}chunks {ingestResult.chunkCount ?? 0}
                        {" · "}supersedes {ingestResult.supersedes ?? "none"}
                      </p>
                      <p className="text-muted-foreground">
                        embed <span className="font-mono">{String(ingestResult.ingestStatus?.embed_status?.status ?? "—")}</span>
                        {" · "}qdrant <span className="font-mono">{String(ingestResult.ingestStatus?.qdrant_status?.status ?? "—")}</span>
                      </p>
                      {(ingestResult.legalChangeAlerts ?? []).length > 0 && (
                        <p className="text-orange-300">{ingestResult.legalChangeAlerts.length} rule(s) reference superseded sections — see the change-alerts tab.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
                  <p className="text-sm font-medium">Sections {versionLabel !== "current" ? `(${versionLabel})` : "(current version)"}</p>
                  <div className="flex gap-2 items-end">
                    <div>
                      <Label htmlFor="ri-sec-search" className="text-xs">Search sections</Label>
                      <Input id="ri-sec-search" className="w-56" value={sectionSearch} onChange={(e) => setSectionSearch(e.target.value)} placeholder="section, heading or text…" />
                    </div>
                    {versionLabel !== "current" && <Button size="sm" variant="ghost" onClick={() => setVersionLabel("current")}>Back to current</Button>}
                  </div>
                </div>
                {sections.isLoading ? <SkeletonTable rows={4} cols={3} /> : (
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                    {sectionRows.map((s, i) => (
                      <details key={`${s.section_ref}-${s.chunk_index}-${i}`} className="border rounded p-3">
                        <summary className="text-sm cursor-pointer flex items-center gap-2">
                          <span className="font-medium">{s.section_ref}</span>
                          {s.heading && <span className="text-muted-foreground">— {s.heading}</span>}
                          <Badge variant="outline" className={s.embedded ? "bg-green-500/20 text-green-300 border-green-500/40 ml-auto" : "ml-auto"}>
                            {s.embedded ? "embedded" : "not embedded"}
                          </Badge>
                        </summary>
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{s.body_excerpt}</p>
                      </details>
                    ))}
                    {sectionRows.length === 0 && <p className="text-sm text-muted-foreground">No sections match.</p>}
                  </div>
                )}
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground mt-4">Instrument not found.</p>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
