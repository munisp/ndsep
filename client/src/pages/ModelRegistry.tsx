import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Layers, Search, RefreshCw, Activity, CheckCircle, Clock, Plus, Rocket, Archive } from "lucide-react";
import { toast } from "sonner";

export default function ModelRegistry() {
  const [search, setSearch] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ name: "", version: "", algorithm: "", framework: "", accuracy: "", f1Score: "", aucRoc: "", description: "" });

  const { data, isLoading, refetch } = trpc.modelRegistry.list.useQuery();
  const modelsRaw = (data as any)?.models ?? data ?? [];

  const registerMutation = trpc.modelRegistry.register.useMutation({
    onSuccess: () => { toast.success("Model registered successfully"); setShowRegister(false); setForm({ name: "", version: "", algorithm: "", framework: "", accuracy: "", f1Score: "", aucRoc: "", description: "" }); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deployMutation = trpc.modelRegistry.deploy.useMutation({
    onSuccess: () => { toast.success("Model deployed"); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const retireMutation = trpc.modelRegistry.retire.useMutation({
    onSuccess: () => { toast.success("Model retired"); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const models = (Array.isArray(modelsRaw) ? modelsRaw : []).filter(
    (m: any) =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.algorithm.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = (s: string) =>
    s === "deployed" || s === "active" ? "bg-green-500/10 text-green-700 border-green-500/30" :
    s === "staging" ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30" :
    s === "retired" ? "bg-muted0/10 text-muted-foreground border-border/30" :
    "bg-blue-500/10 text-blue-700 border-blue-500/30";

  const handleRegister = () => {
    if (!form.name || !form.version || !form.algorithm) { toast.error("Name, version, and algorithm are required"); return; }
    registerMutation.mutate({
      name: form.name,
      version: form.version,
      algorithm: form.algorithm,
      framework: form.framework || undefined,
      accuracy: form.accuracy ? parseFloat(form.accuracy) : undefined,
      f1Score: form.f1Score ? parseFloat(form.f1Score) : undefined,
      aucRoc: form.aucRoc ? parseFloat(form.aucRoc) : undefined,
      description: form.description || undefined,
    });
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-7 w-7 text-primary" />
              ML Model Registry
            </h1>
            <p className="text-muted-foreground mt-1">
              Version-controlled model catalogue with accuracy metrics and deployment status
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowRegister(true)}>
              <Plus className="h-4 w-4 mr-1" /> Register Model
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Models", value: modelsRaw.length, icon: Layers },
            { label: "Deployed", value: modelsRaw.filter((m: any) => m.status === "deployed" || m.status === "active").length, icon: CheckCircle },
            { label: "Staging", value: modelsRaw.filter((m: any) => m.status === "staging").length, icon: Clock },
            { label: "Avg Accuracy", value: modelsRaw.length ? `${(modelsRaw.reduce((s: number, m: any) => s + (m.accuracy ?? 0), 0) / modelsRaw.length * 100).toFixed(1)}%` : "—", icon: Activity },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <div className="text-xs text-muted-foreground">{stat.label}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search models by name or algorithm..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Model Table */}
        <Card>
          <CardHeader>
            <CardTitle>Registered Models</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading models...</div>
            ) : models.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No models found. Register your first model above.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Name</th>
                      <th className="pb-2 pr-4">Version</th>
                      <th className="pb-2 pr-4">Algorithm</th>
                      <th className="pb-2 pr-4">Framework</th>
                      <th className="pb-2 pr-4">Accuracy</th>
                      <th className="pb-2 pr-4">F1</th>
                      <th className="pb-2 pr-4">AUC-ROC</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model: any) => (
                      <tr key={model.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium">{model.name}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{model.version}</td>
                        <td className="py-2 pr-4 text-xs">{model.algorithm}</td>
                        <td className="py-2 pr-4 text-xs">{model.framework ?? "—"}</td>
                        <td className="py-2 pr-4">{model.accuracy ? `${(model.accuracy * 100).toFixed(1)}%` : "—"}</td>
                        <td className="py-2 pr-4">{model.f1_score ? `${(model.f1_score * 100).toFixed(1)}%` : "—"}</td>
                        <td className="py-2 pr-4">{model.auc_roc ? `${(model.auc_roc * 100).toFixed(1)}%` : "—"}</td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline" className={`text-xs ${statusColor(model.status)}`}>
                            {model.status}
                          </Badge>
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            {(model.status === "staging") && (
                              <Button
                                variant="outline" size="sm" className="h-6 text-xs px-2"
                                disabled={deployMutation.isPending}
                                onClick={() => deployMutation.mutate({ modelId: model.id })}
                              >
                                <Rocket className="w-3 h-3 mr-1" />Deploy
                              </Button>
                            )}
                            {(model.status === "deployed" || model.status === "active") && (
                              <Button
                                variant="outline" size="sm" className="h-6 text-xs px-2 text-muted-foreground"
                                disabled={retireMutation.isPending}
                                onClick={() => retireMutation.mutate({ modelId: model.id })}
                              >
                                <Archive className="w-3 h-3 mr-1" />Retire
                              </Button>
                            )}
                          </div>
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

      {/* Register Model Dialog */}
      <Dialog open={showRegister} onOpenChange={setShowRegister}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register New Model</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. fraud-detector" />
              </div>
              <div>
                <Label>Version *</Label>
                <Input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} placeholder="e.g. 1.0.0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Algorithm *</Label>
                <Input value={form.algorithm} onChange={e => setForm(f => ({ ...f, algorithm: e.target.value }))} placeholder="e.g. XGBoost" />
              </div>
              <div>
                <Label>Framework</Label>
                <Input value={form.framework} onChange={e => setForm(f => ({ ...f, framework: e.target.value }))} placeholder="e.g. scikit-learn" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Accuracy (0–1)</Label>
                <Input type="number" step="0.001" min="0" max="1" value={form.accuracy} onChange={e => setForm(f => ({ ...f, accuracy: e.target.value }))} placeholder="0.95" />
              </div>
              <div>
                <Label>F1 Score (0–1)</Label>
                <Input type="number" step="0.001" min="0" max="1" value={form.f1Score} onChange={e => setForm(f => ({ ...f, f1Score: e.target.value }))} placeholder="0.93" />
              </div>
              <div>
                <Label>AUC-ROC (0–1)</Label>
                <Input type="number" step="0.001" min="0" max="1" value={form.aucRoc} onChange={e => setForm(f => ({ ...f, aucRoc: e.target.value }))} placeholder="0.97" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description of the model" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegister(false)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={registerMutation.isPending}>
              {registerMutation.isPending ? "Registering..." : "Register Model"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
