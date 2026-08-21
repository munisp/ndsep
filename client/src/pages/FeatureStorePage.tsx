import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { EmptyState } from "@/components/EmptyState";
import { Database, GitBranch, Search, RefreshCw, Activity, Plus } from "lucide-react";
import { toast } from "sonner";

export default function FeatureStorePage() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"features" | "lineage" | "predictions">("features");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ featureName: "", featureType: "", description: "" });

  const { data: featuresData, isLoading: featuresLoading, refetch } = trpc.featureStore.getFeatures.useQuery({
    featureGroup: "compliance_risk",
    entityId: "",
  });
  const features = (featuresData as any)?.features ?? featuresData ?? [];
  const { data: lineageData, isLoading: lineageLoading } = trpc.featureStore.listFeatureGroups.useQuery();
  const lineage = (lineageData as any)?.lineage ?? (lineageData as any)?.groups ?? lineageData ?? [];
  const { data: predsData, isLoading: predsLoading, refetch: refetchPreds } = trpc.featureStore.getPredictionLog.useQuery({ limit: 50 });
  const predictions = (predsData as any)?.predictions ?? predsData ?? [];

  const createFeatureGroup = trpc.featureStore.createFeatureGroup.useMutation({
    onSuccess: () => {
      toast.success("Feature group registered");
      setShowCreate(false);
      setCreateForm({ featureName: "", featureType: "", description: "" });
      refetch();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const filteredFeatures = (Array.isArray(features) ? features : []).filter(
    (f: any) => !search || (f.entity_id ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (!createForm.featureName || !createForm.featureType) {
      toast.error("Feature name and type are required");
      return;
    }
    createFeatureGroup.mutate({
      featureName: createForm.featureName,
      featureType: createForm.featureType,
      description: createForm.description || undefined,
    });
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-7 w-7 text-primary" />
              ML Feature Store & Lakehouse
            </h1>
            <p className="text-muted-foreground mt-1">
              Entity features, prediction logs, and data lineage backed by Delta Lake / Apache Iceberg
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetch(); refetchPreds(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" /> Register Feature
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["features", "lineage", "predictions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "features" && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by entity ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>compliance_risk Feature Group</CardTitle>
                <CardDescription>{filteredFeatures.length} entities</CardDescription>
              </CardHeader>
              <CardContent>
                {featuresLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading features...</div>
                ) : filteredFeatures.length === 0 ? (
                  <EmptyState title="No features found" description="Register a feature group above to get started" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4">Entity ID</th>
                          <th className="pb-2 pr-4">Compliance Score</th>
                          <th className="pb-2 pr-4">Violations (30d)</th>
                          <th className="pb-2 pr-4">Breaches (90d)</th>
                          <th className="pb-2 pr-4">Days Since Audit</th>
                          <th className="pb-2 pr-4">DPO Appointed</th>
                          <th className="pb-2">Sector Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFeatures.map((f: any) => (
                          <tr key={f.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-4 font-mono text-xs">{(f.entity_id ?? "").slice(0, 8)}...</td>
                            <td className="py-2 pr-4">{f.features?.compliance_score ?? "—"}</td>
                            <td className="py-2 pr-4">{f.features?.violation_count_30d ?? "—"}</td>
                            <td className="py-2 pr-4">{f.features?.breach_count_90d ?? "—"}</td>
                            <td className="py-2 pr-4">{f.features?.days_since_last_audit ?? "—"}</td>
                            <td className="py-2 pr-4">
                              <Badge variant="outline" className={`text-xs ${f.features?.dpo_appointed ? "bg-green-500/10 text-green-700" : "bg-red-500/10 text-red-700"}`}>
                                {f.features?.dpo_appointed ? "Yes" : "No"}
                              </Badge>
                            </td>
                            <td className="py-2">{f.features?.sector_risk_weight ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === "lineage" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Data Lineage
              </CardTitle>
              <CardDescription>Pipeline transformation history</CardDescription>
            </CardHeader>
            <CardContent>
              {lineageLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading lineage...</div>
              ) : (Array.isArray(lineage) ? lineage : []).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No lineage records yet.</div>
              ) : (
                <div className="space-y-3">
                  {(Array.isArray(lineage) ? lineage : []).map((l: any) => (
                    <div key={l.id} className="flex items-center gap-3 p-3 rounded-lg border">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="text-blue-500">{l.source_table}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-green-500">{l.target_table}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {l.transformation} · {(l.record_count ?? 0).toLocaleString()} records
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div className="font-mono">{l.pipeline_run_id}</div>
                        <div>{l.created_at ? new Date(l.created_at).toLocaleDateString() : "—"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "predictions" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Prediction Log
              </CardTitle>
              <CardDescription>Last 50 model inference records</CardDescription>
            </CardHeader>
            <CardContent>
              {predsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading predictions...</div>
              ) : (Array.isArray(predictions) ? predictions : []).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No predictions logged yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Model</th>
                        <th className="pb-2 pr-4">Version</th>
                        <th className="pb-2 pr-4">Entity</th>
                        <th className="pb-2 pr-4">Prediction</th>
                        <th className="pb-2 pr-4">Confidence</th>
                        <th className="pb-2 pr-4">Latency</th>
                        <th className="pb-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(predictions) ? predictions : []).map((p: any) => (
                        <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-4 font-medium text-xs">{p.model_name}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{p.model_version ?? "—"}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{(p.entity_id ?? "").slice(0, 8)}...</td>
                          <td className="py-2 pr-4">
                            <Badge variant="outline" className={`text-xs ${
                              p.prediction === "HIGH_RISK" ? "bg-red-500/10 text-red-700" :
                              p.prediction === "MEDIUM_RISK" ? "bg-yellow-500/10 text-yellow-700" :
                              "bg-green-500/10 text-green-700"
                            }`}>
                              {p.prediction}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4">{p.confidence ? `${(p.confidence * 100).toFixed(1)}%` : "—"}</td>
                          <td className="py-2 pr-4">{p.latency_ms ? `${p.latency_ms}ms` : "—"}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {p.predicted_at ? new Date(p.predicted_at).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Register Feature Group Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Register Feature Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Feature Name *</Label>
              <Input value={createForm.featureName} onChange={e => setCreateForm(f => ({ ...f, featureName: e.target.value }))} placeholder="e.g. compliance_risk_score" />
            </div>
            <div>
              <Label>Feature Type *</Label>
              <Input value={createForm.featureType} onChange={e => setCreateForm(f => ({ ...f, featureType: e.target.value }))} placeholder="e.g. numerical, categorical, embedding" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createFeatureGroup.isPending}>
              {createFeatureGroup.isPending ? "Registering..." : "Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
