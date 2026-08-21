import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Calculator, AlertTriangle, CheckCircle, DollarSign } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const VIOLATION_TYPES = [
  "unauthorized_data_processing",
  "failure_to_notify_breach",
  "failure_to_appoint_dpo",
  "unlawful_cross_border_transfer",
  "failure_to_honor_dsar",
  "inadequate_consent_mechanism",
  "data_retention_violation",
  "security_failure",
];

const AGGRAVATING_FACTORS = [
  "repeat_offender",
  "deliberate_violation",
  "large_scale_processing",
  "sensitive_data_involved",
  "children_data",
  "financial_gain",
];

const MITIGATING_FACTORS = [
  "voluntary_disclosure",
  "prompt_remediation",
  "cooperation_with_authorities",
  "no_prior_violations",
  "data_subject_not_harmed",
  "implemented_safeguards",
];

export default function Phase13PenaltyCalculator() {
  const [form, setForm] = useState({
    org_name: "",
    violation_type: "",
    annual_turnover: "",
    violation_date: "",
    aggravating_factors: [] as string[],
    mitigating_factors: [] as string[],
  });
  const [result, setResult] = useState<any>(null);

  const utils = trpc.useUtils();
  const { data: calculations, isLoading } = trpc.phase13.penaltyCalculator.list.useQuery({});
  const calculate = trpc.phase13.penaltyCalculator.calculate.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.phase13.penaltyCalculator.list.invalidate();
      toast.success("Penalty calculated successfully");
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const approve = trpc.phase13.penaltyCalculator.approve.useMutation({
    onSuccess: () => { utils.phase13.penaltyCalculator.list.invalidate(); toast.success("Penalty approved"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (calculations as any[]) ?? [];

  const toggleFactor = (arr: string[], val: string, setter: (v: string[]) => void) => {
    setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
  };

  const formatNGN = (amount: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

  return (
    <>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="h-6 w-6 text-red-600" />
            NDPA Penalty Calculator
          </h1>
          <p className="text-muted-foreground mt-1">Calculate regulatory penalties per NDPA 2023 Section 48 — up to 2% annual revenue or ₦10M</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Calculate Penalty</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Organization Name" value={form.org_name} onChange={e => setForm(f => ({ ...f, org_name: e.target.value }))} />
              <Select value={form.violation_type} onValueChange={v => setForm(f => ({ ...f, violation_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Violation Type" /></SelectTrigger>
                <SelectContent>
                  {VIOLATION_TYPES.map(v => (
                    <SelectItem key={v} value={v}>{v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div>
                <label className="text-sm font-medium">Annual Turnover (₦)</label>
                <Input type="number" placeholder="e.g. 5000000000" value={form.annual_turnover} onChange={e => setForm(f => ({ ...f, annual_turnover: e.target.value }))} />
              </div>
              <Input type="date" placeholder="Violation Date" value={form.violation_date} onChange={e => setForm(f => ({ ...f, violation_date: e.target.value }))} />

              <div>
                <p className="text-sm font-medium mb-2">Aggravating Factors</p>
                <div className="flex flex-wrap gap-2">
                  {AGGRAVATING_FACTORS.map(f => (
                    <button key={f} type="button"
                      className={`text-xs px-2 py-1 rounded border transition-colors ${form.aggravating_factors.includes(f) ? "bg-red-500/15 border-red-500/30 text-red-600 dark:text-red-400" : "border-border text-muted-foreground hover:border-red-500/30"}`}
                      onClick={() => toggleFactor(form.aggravating_factors, f, v => setForm(prev => ({ ...prev, aggravating_factors: v })))}>
                      {f.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Mitigating Factors</p>
                <div className="flex flex-wrap gap-2">
                  {MITIGATING_FACTORS.map(f => (
                    <button key={f} type="button"
                      className={`text-xs px-2 py-1 rounded border transition-colors ${form.mitigating_factors.includes(f) ? "bg-green-500/15 border-green-500/30 text-green-600 dark:text-green-400" : "border-border text-muted-foreground hover:border-green-500/30"}`}
                      onClick={() => toggleFactor(form.mitigating_factors, f, v => setForm(prev => ({ ...prev, mitigating_factors: v })))}>
                      {f.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>

              <Button className="w-full"
                onClick={() => calculate.mutate({
                  org_name: form.org_name,
                  violation_type: form.violation_type,
                  annual_turnover: Number(form.annual_turnover),
                  violation_date: form.violation_date || undefined,
                  aggravating_factors: form.aggravating_factors,
                  mitigating_factors: form.mitigating_factors,
                })}
                disabled={calculate.isPending || !form.org_name || !form.violation_type || !form.annual_turnover}>
                {calculate.isPending ? "Calculating..." : "Calculate Penalty"}
              </Button>
            </CardContent>
          </Card>

          {result && (
            <Card className="border-2 border-orange-500/20 dark:border-orange-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                  <AlertTriangle className="h-5 w-5" />
                  Penalty Assessment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">Recommended Penalty</p>
                  <p className="text-3xl font-bold text-red-600">{formatNGN(result.recommended_penalty ?? result.penalty_amount ?? 0)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-muted-foreground">Base Penalty</p>
                    <p className="font-semibold">{formatNGN(result.base_penalty ?? 0)}</p>
                  </div>
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-muted-foreground">Penalty Rate</p>
                    <p className="font-semibold">{result.penalty_percentage ?? result.rate ?? "2"}%</p>
                  </div>
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-muted-foreground">Aggravating</p>
                    <p className="font-semibold text-red-600">+{result.aggravating_adjustment ?? 0}%</p>
                  </div>
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-muted-foreground">Mitigating</p>
                    <p className="font-semibold text-green-600">-{result.mitigating_adjustment ?? 0}%</p>
                  </div>
                </div>
                {result.legal_reference && (
                  <p className="text-xs text-muted-foreground border-t pt-3">{result.legal_reference}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>Penalty Calculations History ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No penalty calculations yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Organization</th>
                      <th className="text-left py-2 px-3">Violation Type</th>
                      <th className="text-left py-2 px-3">Penalty Amount</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Calculated</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{r.org_name}</td>
                        <td className="py-2 px-3">{r.violation_type?.replace(/_/g, " ")}</td>
                        <td className="py-2 px-3 font-semibold text-red-600">{formatNGN(r.recommended_penalty ?? r.penalty_amount ?? 0)}</td>
                        <td className="py-2 px-3">
                          <Badge variant={r.status === "approved" ? "default" : r.status === "paid" ? "default" : "secondary"}>
                            {r.status ?? "draft"}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          {r.status === "draft" && (
                            <Button size="sm" variant="ghost" onClick={() => approve.mutate({ id: r.id, approved_by: "NITDA Officer" })}>
                              <CheckCircle className="h-3 w-3 text-green-600" />
                            </Button>
                          )}
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
