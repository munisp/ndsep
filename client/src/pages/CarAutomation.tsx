import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, Sparkles, Download, CheckCircle2, Clock, AlertTriangle, Plus } from "lucide-react";
const STATUS_COLORS: Record<string, string> = {
  draft: "text-muted-foreground bg-card",
  submitted: "text-blue-400 bg-blue-900/30",
  under_review: "text-yellow-400 bg-yellow-900/30",
  approved: "text-green-400 bg-green-900/30",
  rejected: "text-red-400 bg-red-900/30",
  amendment_required: "text-orange-400 bg-orange-900/30",
};

export default function CarAutomation() {
  const [selectedOrgId, setSelectedOrgId] = useState<number>(1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [generating, setGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<any>(null);

  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const { data: cars = [], refetch } = trpc.carAutomation.list.useQuery({ orgId: selectedOrgId });

  const generateMutation = trpc.carAutomation.generate.useMutation({
    onMutate: () => setGenerating(true),
    onSuccess: (data) => {
      setGeneratedReport(data);
      setGenerating(false);
      refetch();
      toast.success("CAR generated successfully");
    },
    onError: (err) => {
      setGenerating(false);
      toast.error(err.message);
    },
  });

  const submitMutation = trpc.carAutomation.submit.useMutation({
    onSuccess: () => { toast.success("CAR submitted to NITDA"); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  return (
    <>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-7 h-7 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">CAR Automation</h1>
            <p className="text-sm text-muted-foreground">Compliance Audit Return — Automated generation and submission (NDPA 2023 Section 43)</p>
          </div>
        </div>

        {/* Generation panel */}
        <div className="bg-background border border-border rounded-xl p-6 mb-6">
          <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Sparkles className="w-5 h-5 text-yellow-400" /> Generate New CAR</h2>
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <label className="text-muted-foreground text-xs mb-1.5 block">Organisation</label>
              <select value={selectedOrgId} onChange={e => setSelectedOrgId(Number(e.target.value))} className="bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm min-w-[200px]">
                {(orgs as any[]).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-muted-foreground text-xs mb-1.5 block">Reporting Year</label>
              <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <Button onClick={() => generateMutation.mutate({ orgId: selectedOrgId, year: selectedYear })} disabled={generating} className="bg-cyan-600 hover:bg-cyan-700">
              <Sparkles className="w-4 h-4 mr-1" /> {generating ? "Generating..." : "Generate CAR"}
            </Button>
          </div>
        </div>

        {/* Generated report preview */}
        {generatedReport && (
          <div className="bg-background border border-cyan-800 rounded-xl p-6 mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground text-lg">{generatedReport.title}</h3>
                <div className="text-muted-foreground text-sm">{generatedReport.organisation} · {generatedReport.reportingYear}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { const blob = new Blob([JSON.stringify(generatedReport, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `CAR-${generatedReport.organisation}-${generatedReport.reportingYear}.json`; a.click(); }} className="border-border text-muted-foreground text-xs">
                  <Download className="w-3.5 h-3.5 mr-1" /> Export
                </Button>
                {generatedReport.id && (
                  <Button size="sm" onClick={() => submitMutation.mutate({ id: generatedReport.id })} disabled={submitMutation.isPending} className="bg-green-600 hover:bg-green-700 text-xs">
                    {submitMutation.isPending ? "Submitting..." : "Submit to NITDA"}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[
                { label: "Compliance Score", value: `${generatedReport.complianceScore ?? 0}%`, color: "text-green-400" },
                { label: "Open Violations", value: generatedReport.openViolations ?? 0, color: "text-orange-400" },
                { label: "Breaches Reported", value: generatedReport.breachesReported ?? 0, color: "text-red-400" },
                { label: "DSARs Resolved", value: generatedReport.dsarsResolved ?? 0, color: "text-blue-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-card rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                </div>
              ))}
            </div>
            {generatedReport.sections?.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Report Sections</div>
                <div className="space-y-2">
                  {generatedReport.sections.map((s: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-foreground font-medium">{s.title}</span>
                        {s.summary && <span className="text-muted-foreground ml-2">{s.summary}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Historical CARs */}
        <div>
          <h2 className="font-semibold text-foreground mb-3">Historical CARs</h2>
          {(cars as any[]).length === 0 ? (
            <div className="text-center py-10 text-muted-foreground bg-background border border-border rounded-xl">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No CARs generated yet for this organisation.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(cars as any[]).map((car: any) => (
                <div key={car.id} className="bg-background border border-border rounded-xl px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">{car.title ?? `CAR ${car.reporting_year}`}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">
                      {car.reporting_year} · Generated {new Date(car.generated_at ?? car.created_at).toLocaleDateString()}
                      {car.submitted_at && ` · Submitted ${new Date(car.submitted_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[car.status] ?? "text-muted-foreground bg-card"}`}>
                      {car.status?.replace("_", " ").toUpperCase()}
                    </span>
                    {car.status === "draft" && (
                      <Button size="sm" onClick={() => submitMutation.mutate({ id: car.id })} disabled={submitMutation.isPending} className="bg-green-600 hover:bg-green-700 text-xs h-7">
                        Submit
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
