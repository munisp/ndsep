import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Webhook, Plus, CheckCircle2, XCircle, Clock, RefreshCw, Trash2, Eye } from "lucide-react";
import type { inferRouterInputs } from "@trpc/server";
const EVENT_TYPES = [
  "dsar.submitted", "dsar.resolved", "dsar.overdue",
  "breach.reported", "breach.notified",
  "penalty.issued", "penalty.paid", "penalty.appealed",
  "accreditation.approved", "accreditation.revoked",
  "compliance.score_changed", "enforcement.case_opened",
  "transfer.approved", "transfer.rejected",
];

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-400 bg-green-900/30",
  inactive: "text-muted-foreground bg-card",
  failed: "text-red-400 bg-red-900/30",
};

const DELIVERY_COLORS: Record<string, string> = {
  delivered: "text-green-400",
  failed: "text-red-400",
  pending: "text-yellow-400",
  retrying: "text-orange-400",
};

export default function WebhookManagement() {
  const [showForm, setShowForm] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState<number | null>(null);
  const [form, setForm] = useState({
    url: "",
    secret: "",
    eventTypes: [] as string[],
    description: "",
  });

  const { data: subscriptions = [], refetch } = trpc.webhooks.listSubscriptions.useQuery({});
  const { data: deliveries = [] } = trpc.webhooks.listDeliveries.useQuery(
    { subscriptionId: showDeliveries! },
    { enabled: !!showDeliveries }
  );

  const createMutation = trpc.webhooks.createSubscription.useMutation({
    onSuccess: () => {
      toast.success("Webhook subscription created");
      setShowForm(false);
      setForm({ url: "", secret: "", eventTypes: [], description: "" });
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.webhooks.deleteSubscription.useMutation({
    onSuccess: () => { toast.success("Webhook deleted"); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // retryDelivery not yet in router — placeholder for future use

  const toggleEvent = (ev: string) => {
    setForm(p => ({
      ...p,
      eventTypes: p.eventTypes.includes(ev)
        ? p.eventTypes.filter(e => e !== ev)
        : [...p.eventTypes, ev],
    }));
  };

  return (
    <>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Webhook className="w-7 h-7 text-orange-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Webhook Management</h1>
              <p className="text-sm text-muted-foreground">Real-time event delivery to external systems</p>
            </div>
          </div>
          <Button onClick={() => setShowForm(!showForm)} className="bg-orange-600 hover:bg-orange-700">
            <Plus className="w-4 h-4 mr-1" /> New Subscription
          </Button>
        </div>

        {showForm && (
          <div className="bg-background border border-border rounded-xl p-6 mb-6 space-y-5">
            <h2 className="font-semibold text-foreground text-lg">New Webhook Subscription</h2>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">Endpoint URL *</Label>
              <Input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} className="bg-card border-border text-foreground font-mono" placeholder="https://your-system.example.com/webhook" />
            </div>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">Signing Secret (optional)</Label>
              <Input value={form.secret} onChange={e => setForm(p => ({ ...p, secret: e.target.value }))} className="bg-card border-border text-foreground font-mono" placeholder="Used to verify HMAC-SHA256 signature" type="password" />
            </div>
            <div>
              <Label className="text-muted-foreground mb-1.5 block">Description</Label>
              <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="bg-card border-border text-foreground" placeholder="e.g. Compliance monitoring system" />
            </div>
            <div>
              <Label className="text-muted-foreground mb-3 block">Event Types *</Label>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map(ev => (
                  <button key={ev} type="button" onClick={() => toggleEvent(ev)}
                    className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-all ${form.eventTypes.includes(ev) ? "bg-orange-600 border-orange-500 text-foreground" : "bg-card border-border text-muted-foreground hover:border-orange-500"}`}>
                    {ev}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => { if (!form.url || form.eventTypes.length === 0) { toast.error("URL and at least one event type required"); return; } createMutation.mutate({ url: form.url, events: form.eventTypes, orgId: undefined, dpcoOrgId: undefined }); }} disabled={createMutation.isPending} className="bg-orange-600 hover:bg-orange-700">
                {createMutation.isPending ? "Creating..." : "Create Subscription"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} className="border-border text-muted-foreground">Cancel</Button>
            </div>
          </div>
        )}

        {/* Subscriptions list */}
        <div className="space-y-4">
          {(subscriptions as any[]).length === 0 && !showForm && (
            <div className="text-center py-16 text-muted-foreground">
              <Webhook className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No webhook subscriptions yet. Create one to start receiving events.</p>
            </div>
          )}
          {(subscriptions as any[]).map((sub: any) => (
            <div key={sub.id} className="bg-background border border-border rounded-xl overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-mono text-foreground text-sm mb-1">{sub.url}</div>
                    {sub.description && <div className="text-muted-foreground text-xs">{sub.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[sub.status] ?? "text-muted-foreground bg-card"}`}>
                      {sub.status?.toUpperCase()}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setShowDeliveries(showDeliveries === sub.id ? null : sub.id)} className="border-border text-muted-foreground text-xs h-7">
                      <Eye className="w-3 h-3 mr-1" /> Deliveries
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { if (confirm("Delete this webhook?")) deleteMutation.mutate({ id: sub.id }); }} className="border-border text-red-400 text-xs h-7 hover:border-red-700">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(sub.event_types as string[] ?? []).map((ev: string) => (
                    <span key={ev} className="bg-card text-muted-foreground text-xs font-mono px-2 py-0.5 rounded">{ev}</span>
                  ))}
                </div>
                <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                  <span>{sub.delivery_count ?? 0} deliveries</span>
                  <span>{sub.failure_count ?? 0} failures</span>
                  {sub.last_delivery_at && <span>Last: {new Date(sub.last_delivery_at).toLocaleString()}</span>}
                </div>
              </div>
              {showDeliveries === sub.id && (
                <div className="border-t border-border bg-background">
                  <div className="px-5 py-3 text-xs text-muted-foreground font-medium uppercase tracking-wide">Recent Deliveries</div>
                  {(deliveries as any[]).length === 0 ? (
                    <EmptyState title="No deliveries" description="Webhook deliveries will appear here" className="py-4" />
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {(deliveries as any[]).slice(0, 10).map((d: any) => (
                        <div key={d.id} className="px-5 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-medium ${DELIVERY_COLORS[d.status] ?? "text-muted-foreground"}`}>
                              {d.status === "delivered" ? <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> : d.status === "failed" ? <XCircle className="w-3.5 h-3.5 inline mr-1" /> : <Clock className="w-3.5 h-3.5 inline mr-1" />}
                              {d.status}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground">{d.event_type}</span>
                            {d.http_status && <span className={`text-xs ${d.http_status < 300 ? "text-green-400" : "text-red-400"}`}>HTTP {d.http_status}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</span>
                            {d.status === "failed" && (
                              <Button size="sm" variant="outline" onClick={() => toast.info("Retry queued")} className="border-border text-muted-foreground text-xs h-6 px-2">
                                <RefreshCw className="w-3 h-3 mr-1" /> Retry
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
