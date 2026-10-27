/**
 * LearningLoop — Round-12 learning loop, visualized as a live pipeline (R17-W3).
 *
 *   Suggestion → Officer decision → decision_feedback → Label mix →
 *   Autonomy tiers → Models → (back to) Suggestion
 *
 * All numbers are real tRPC reads:
 *   trpc.decisionFeedback.acceptanceRate  (per known surface, 30d window)
 *   trpc.decisionFeedback.listRecent      (recent rows → 7d trend sparkline)
 *   trpc.autonomyGovernance.tierStatus    (per-surface tier + gate progress)
 *   trpc.autonomyGovernance.listAutonomyActions (action queue)
 *   trpc.autonomyGovernance.transitionHistory   (promotion/demotion feed)
 *
 * There is no labelRegistry router in the codebase; the "label mix" donut is
 * honestly derived from decision_feedback outcome actions (accept / edit /
 * reject / ignore) instead of the planned synthetic/officer/real weight
 * classes, which do not exist yet. Everything fails closed to empty states.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Activity, ArrowRight, BrainCircuit, CheckCircle2, GraduationCap,
  Layers, RefreshCw, ShieldAlert, TrendingUp, XCircle, Pencil, EyeOff,
} from "lucide-react";

/** Well-known feedback surfaces (mirror of KNOWN_SURFACES in
 *  server/routers/decisionFeedback.ts — duplicated here because the client
 *  must not import server code). */
const KNOWN_SURFACES = [
  "triage", "dpiagen", "form_copilot", "settlement_terms",
  "risk_weights", "compliance_query", "compliance_qa", "gap_analysis",
] as const;

const ACTIONS = ["accept", "edit", "reject", "ignore"] as const;
type Action = (typeof ACTIONS)[number];
const ACTION_META: Record<Action, { label: string; icon: React.ComponentType<{ className?: string }>; chartVar: string }> = {
  accept: { label: "Accept", icon: CheckCircle2, chartVar: "var(--chart-1)" },
  edit: { label: "Edit", icon: Pencil, chartVar: "var(--chart-2)" },
  reject: { label: "Reject", icon: XCircle, chartVar: "var(--chart-3)" },
  ignore: { label: "Ignore (implicit)", icon: EyeOff, chartVar: "var(--chart-4)" },
};

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

/** Tiny SVG sparkline (no chart lib). values are 0..1 rates per day. */
function Sparkline({ values, labels }: { values: (number | null)[]; labels: string[] }) {
  const w = 320, h = 64, pad = 6;
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return <EmptyState title="No decided outcomes in the last 7 days" className="py-6" />;
  const step = (w - pad * 2) / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) =>
    v === null ? null : { x: pad + i * step, y: pad + (1 - v) * (h - pad * 2) });
  const line = pts.filter((p): p is { x: number; y: number } => p !== null)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h + 16}`} className="w-full h-20">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border)" strokeWidth={1} />
      <line x1={pad} y1={pad} x2={w - pad} y2={pad} stroke="var(--border)" strokeDasharray="3 3" strokeWidth={1} />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2} />
      {pts.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--primary)" />)}
      {labels.map((l, i) => (
        <text key={i} x={pad + i * step} y={h + 12} textAnchor="middle" fontSize={8} fill="var(--muted-foreground)">{l}</text>
      ))}
    </svg>
  );
}

/** SVG donut of the feedback label mix. */
function LabelDonut({ counts }: { counts: Record<Action, number> }) {
  const total = ACTIONS.reduce((s, a) => s + counts[a], 0);
  if (total === 0) return <EmptyState title="No feedback labels yet" description="Labels appear once officers act on suggestions." className="py-6" />;
  const r = 42, cx = 55, cy = 55, circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" className="h-32 w-32 -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth={14} />
        {ACTIONS.map((a) => {
          const frac = counts[a] / total;
          const dash = frac * circumference;
          const el = (
            <circle
              key={a} cx={cx} cy={cy} r={r} fill="none"
              stroke={ACTION_META[a].chartVar} strokeWidth={14}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="space-y-1.5 text-xs">
        {ACTIONS.map((a) => (
          <div key={a} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ACTION_META[a].chartVar }} />
            <span className="text-muted-foreground">{ACTION_META[a].label}</span>
            <span className="font-mono font-medium text-foreground">{counts[a]}</span>
            <span className="text-muted-foreground">({Math.round((counts[a] / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LearningLoop() {
  // ── Per-surface acceptance (30d window) ──────────────────────────────────
  // One acceptanceRate query per known surface; aggregated client-side.
  const surfaceQueries = KNOWN_SURFACES.map((surface) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length static list
    trpc.decisionFeedback.acceptanceRate.useQuery({ surface, windowDays: 30 }, { refetchInterval: 60_000 }));

  // Aggregate per-surface acceptance (cheap recompute each render).
  const counts: Record<Action, number> = { accept: 0, edit: 0, reject: 0, ignore: 0 };
  let totalAll = 0;
  let decidedAll = 0;
  let editDistanceSum = 0;
  let editDistanceN = 0;
  const perSurface: { surface: string; acceptanceRate: number | null; decided: number; avgEditDistance: number | null }[] = [];
  surfaceQueries.forEach((q, i) => {
    const d = q.data;
    if (!d) return;
    counts.accept += d.counts.accept;
    counts.edit += d.counts.edit;
    counts.reject += d.counts.reject;
    counts.ignore += d.counts.ignore;
    totalAll += d.total;
    const dec = d.counts.accept + d.counts.edit + d.counts.reject;
    decidedAll += dec;
    if (d.avgEditDistance != null) { editDistanceSum += d.avgEditDistance; editDistanceN += 1; }
    perSurface.push({
      surface: KNOWN_SURFACES[i],
      acceptanceRate: d.decidedAcceptanceRate ?? d.acceptanceRate,
      decided: dec,
      avgEditDistance: d.avgEditDistance,
    });
  });
  const aggregate = {
    counts,
    total: totalAll,
    decided: decidedAll,
    acceptanceRate: decidedAll > 0 ? counts.accept / decidedAll : null,
    avgEditDistance: editDistanceN > 0 ? editDistanceSum / editDistanceN : null,
    perSurface,
  };

  // ── Recent feedback rows → 7d trend ──────────────────────────────────────
  const recent = trpc.decisionFeedback.listRecent.useQuery({ limit: 200 }, { refetchInterval: 60_000 });
  const trend = useMemo(() => {
    const days: { label: string; accept: number; decided: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, accept: 0, decided: 0 });
    }
    for (const row of recent.data?.rows ?? []) {
      const t = new Date(row.createdAt).getTime();
      const idx = 6 - Math.floor((now.getTime() - t) / 86_400_000);
      if (idx < 0 || idx > 6) continue;
      if (row.action === "ignore") continue; // implicit baseline, not a decision
      days[idx].decided += 1;
      if (row.action === "accept") days[idx].accept += 1;
    }
    return {
      values: days.map((d) => (d.decided > 0 ? d.accept / d.decided : null)),
      labels: days.map((d) => d.label),
      decidedTotal: days.reduce((s, d) => s + d.decided, 0),
    };
  }, [recent.data]);

  // ── Autonomy governance ──────────────────────────────────────────────────
  const tiers = trpc.autonomyGovernance.tierStatus.useQuery(undefined, { refetchInterval: 60_000 });
  const actions = trpc.autonomyGovernance.listAutonomyActions.useQuery({ limit: 20 }, { refetchInterval: 60_000 });
  const transitions = trpc.autonomyGovernance.transitionHistory.useQuery({ limit: 15 }, { refetchInterval: 60_000 });

  // ── Pipeline node metrics ────────────────────────────────────────────────
  const surfaces = (tiers.data?.surfaces ?? []) as any[];
  const pipelineNodes = [
    { title: "Suggestion", sub: "AI surfaces mint predictions", value: String(aggregate.total), icon: BrainCircuit },
    { title: "Officer decision", sub: "accept / edit / reject", value: String(aggregate.decided), icon: CheckCircle2 },
    { title: "decision_feedback", sub: "append-only, hash-chained", value: String(recent.data?.total ?? 0), icon: Layers },
    { title: "Label mix", sub: "training labels derived", value: String(aggregate.total), icon: GraduationCap },
    { title: "Autonomy tiers", sub: "graduated trust gates", value: `${surfaces.filter((s) => s.tier >= 2).length}/${surfaces.length} ≥ T2`, icon: ShieldAlert },
    { title: "Models", sub: "retrained on accepted labels", value: aggregate.avgEditDistance != null ? aggregate.avgEditDistance.toFixed(1) : "—", icon: Activity },
  ];

  return (
    <PageShell>
      <Breadcrumbs items={[{ label: "AI & Intelligence" }, { label: "Learning Loop" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="h-6 w-6 text-primary" /> Learning Loop
          </h1>
          <p className="text-sm text-muted-foreground">
            Round-12 feedback loop: every officer decision becomes a training label; sustained quality earns autonomy.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5"><RefreshCw className="h-3 w-3" /> 60s auto-refresh</Badge>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Suggestions (30d)", value: String(aggregate.total) },
          { label: "Decided acceptance", value: pct(aggregate.acceptanceRate) },
          { label: "Avg edit distance", value: aggregate.avgEditDistance != null ? aggregate.avgEditDistance.toFixed(1) : "—" },
          { label: "Decided (7d)", value: String(trend.decidedTotal) },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0"><div className="text-xl font-bold text-foreground">{s.value}</div></CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline flow */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline</CardTitle>
          <CardDescription>Suggestion → decision → feedback → labels → autonomy → models → suggestion</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-stretch gap-2">
            {pipelineNodes.map((n, i) => {
              const Icon = n.icon;
              return (
                <div key={n.title} className="flex items-center gap-2">
                  <div className="rounded-lg border bg-card px-3 py-2 min-w-[130px]">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Icon className="h-3.5 w-3.5 text-primary" /> {n.title}
                    </div>
                    <div className="text-lg font-bold text-foreground">{n.value}</div>
                    <div className="text-[10px] text-muted-foreground">{n.sub}</div>
                  </div>
                  {i < pipelineNodes.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </div>
              );
            })}
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <RefreshCw className="h-3 w-3 text-primary" /> loop closes back to Suggestion
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Acceptance trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Acceptance trend (7d)</CardTitle>
            <CardDescription>Daily share of decided outcomes that were accepts (ignores excluded)</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.isLoading ? <div className="h-20 animate-pulse rounded bg-muted" /> : <Sparkline values={trend.values} labels={trend.labels} />}
          </CardContent>
        </Card>

        {/* Label mix donut */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" /> Label mix (30d)</CardTitle>
            <CardDescription>
              Training labels from decision_feedback outcomes. Weight classes (synthetic 1.0 / officer 2.0 / real 3.0)
              are planned but not yet implemented — no labelRegistry exists.
            </CardDescription>
          </CardHeader>
          <CardContent><LabelDonut counts={aggregate.counts} /></CardContent>
        </Card>
      </div>

      {/* Autonomy tier cards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /> Autonomy tiers</CardTitle>
          <CardDescription>
            Graduated trust per surface — promotion gates 85%/500 decided (T1→T2), 95%/2000 + 30d stable (T2→T3)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tiers.isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : surfaces.length === 0 ? (
            <EmptyState title="Autonomy registry unavailable" description="tierStatus returned no surfaces." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {surfaces.map((s) => (
                <div key={s.surface} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{s.label ?? s.surface}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{s.surface}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.failedClosed && <Badge variant="destructive">fail-closed</Badge>}
                      <Badge variant={s.tier >= 2 ? "default" : "outline"}>Tier {s.tier}</Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    acceptance <span className="font-medium text-foreground">{pct(s.acceptanceRate)}</span>
                    {" · "}decided <span className="font-medium text-foreground">{s.decided ?? 0}</span>
                    {" / "}{s.suggestions ?? 0} suggestions
                  </div>
                  {s.nextGate ? (
                    <div className="space-y-1.5">
                      <div className="text-[10px] text-muted-foreground">Progress to Tier {s.nextGate.targetTier}</div>
                      <div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>acceptance ≥ {Math.round(s.nextGate.minAcceptance * 100)}%</span>
                          <span>{Math.round((s.nextGate.acceptanceProgress ?? 0) * 100)}%</span>
                        </div>
                        <div className="h-1.5 rounded bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${Math.round((s.nextGate.acceptanceProgress ?? 0) * 100)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>decided ≥ {s.nextGate.minSuggestions}</span>
                          <span>{Math.round((s.nextGate.suggestionsProgress ?? 0) * 100)}%</span>
                        </div>
                        <div className="h-1.5 rounded bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${Math.round((s.nextGate.suggestionsProgress ?? 0) * 100)}%` }} />
                        </div>
                      </div>
                      {s.nextGate.minStableDays != null && (
                        <div>
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>stable ≥ {s.nextGate.minStableDays}d</span>
                            <span>{Math.round((s.nextGate.stableProgress ?? 0) * 100)}%</span>
                          </div>
                          <div className="h-1.5 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${Math.round((s.nextGate.stableProgress ?? 0) * 100)}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">At maximum tier</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent autonomy actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent autonomy actions</CardTitle>
            <CardDescription>Auto-action queue (pending undo / executed / undone / expired)</CardDescription>
          </CardHeader>
          <CardContent>
            {actions.isLoading ? (
              <div className="h-24 animate-pulse rounded bg-muted" />
            ) : (actions.data?.rows?.length ?? 0) === 0 ? (
              <EmptyState title="No autonomy actions yet" description="Autonomous actions appear here once surfaces reach Tier 2+." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Surface</TableHead><TableHead>Action</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(actions.data?.rows ?? []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.surface}</TableCell>
                      <TableCell className="text-xs">{r.actionType}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "executed" ? "default" : r.status === "undone" ? "secondary" : "outline"} className="text-[10px]">
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Tier transition feed */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tier transitions &amp; governance events</CardTitle>
            <CardDescription>autonomy.* entries from the hash-chained audit ledger</CardDescription>
          </CardHeader>
          <CardContent>
            {transitions.isLoading ? (
              <div className="h-24 animate-pulse rounded bg-muted" />
            ) : (transitions.data?.length ?? 0) === 0 ? (
              <EmptyState title="No transitions recorded" description="Promotions/demotions and overrides appear here." />
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {(transitions.data ?? []).map((t: any) => (
                  <div key={t.seq} className="flex items-start gap-2 rounded border p-2 text-xs">
                    <ShieldAlert className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="font-mono text-foreground">{t.action}</div>
                      <div className="text-muted-foreground truncate">
                        {typeof t.payload === "object" && t.payload !== null
                          ? Object.entries(t.payload as Record<string, unknown>).slice(0, 4).map(([k, v]) => `${k}=${String(v)}`).join(" · ")
                          : String(t.payload ?? "")}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{fmtDate(t.createdAt)}{t.actor ? ` — ${t.actor}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-surface acceptance breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acceptance by AI surface (30d)</CardTitle>
          <CardDescription>Latest outcome per prediction (re-decisions supersede baselines)</CardDescription>
        </CardHeader>
        <CardContent>
          {aggregate.perSurface.length === 0 ? (
            <EmptyState title="No feedback data" description="No decision_feedback rows in the trailing 30-day window." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Surface</TableHead><TableHead>Acceptance</TableHead><TableHead>Decided</TableHead><TableHead>Avg edit distance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregate.perSurface.map((s) => (
                  <TableRow key={s.surface}>
                    <TableCell className="font-mono text-xs">{s.surface}</TableCell>
                    <TableCell className="text-sm font-medium">{pct(s.acceptanceRate)}</TableCell>
                    <TableCell className="text-sm">{s.decided}</TableCell>
                    <TableCell className="text-sm">{s.avgEditDistance != null ? s.avgEditDistance.toFixed(1) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
