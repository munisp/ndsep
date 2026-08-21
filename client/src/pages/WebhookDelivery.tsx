import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Webhook, Plus, Trash2, Send, CheckCircle, XCircle } from "lucide-react";

const WEBHOOK_EVENTS = ["breach.created", "breach.updated", "penalty.issued", "penalty.paid", "cert.issued", "cert.expired", "compliance.score_changed", "enforcement.action_taken"];

export default function WebhookDelivery() {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ url: "", description: "", events: ["breach.created", "penalty.issued"] });

  const { data: endpoints = [], refetch } = trpc.webhookDelivery.list.useQuery({});
  const registerMut = trpc.webhookDelivery.register.useMutation({
    onSuccess: (d) => { toast.success(`Webhook registered: ${d.endpointId}`); setCreateOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMut = trpc.webhookDelivery.delete.useMutation({
    onSuccess: () => { toast.success("Webhook endpoint deleted"); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deliverMut = trpc.webhookDelivery.deliver.useMutation({
    onSuccess: (d) => { d.success ? toast.success("Test delivery successful") : toast.error(`Delivery failed: ${d.error ?? d.statusCode}`); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const toggleEvent = (evt: string) => setForm(f => ({ ...f, events: f.events.includes(evt) ? f.events.filter(e => e !== evt) : [...f.events, evt] }));

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Webhook className="w-6 h-6 text-indigo-400" /> Webhook Delivery</h1>
            <p className="text-muted-foreground text-sm mt-1">Configure real-time event delivery to external systems</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-indigo-600 hover:bg-indigo-700"><Plus className="w-4 h-4 mr-2" /> Register Endpoint</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border text-foreground max-w-lg">
              <DialogHeader><DialogTitle>Register Webhook Endpoint</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Endpoint URL</Label><Input className="bg-muted border-border" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://your-system.com/webhook" /></div>
                <div><Label>Description</Label><Input className="bg-muted border-border" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" /></div>
                <div>
                  <Label className="mb-2 block">Events to Subscribe</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {WEBHOOK_EVENTS.map(evt => (
                      <label key={evt} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.events.includes(evt)} onChange={() => toggleEvent(evt)} className="accent-indigo-500" />
                        <span className="text-xs text-muted-foreground">{evt}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={!form.url || form.events.length === 0 || registerMut.isPending} onClick={() => registerMut.mutate({ orgId: 1, url: form.url, events: form.events, description: form.description })}>
                  {registerMut.isPending ? "Registering..." : "Register Webhook"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Endpoints", value: (endpoints as any[]).length, color: "text-indigo-400" },
            { label: "Active", value: (endpoints as any[]).filter((e: any) => e.status === "active").length, color: "text-green-400" },
            { label: "Total Deliveries", value: (endpoints as any[]).reduce((s: number, e: any) => s + Number(e.delivery_count ?? 0), 0), color: "text-blue-400" },
            { label: "Total Failures", value: (endpoints as any[]).reduce((s: number, e: any) => s + Number(e.failure_count ?? 0), 0), color: "text-red-400" },
          ].map(s => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground">Registered Endpoints</CardTitle></CardHeader>
          <CardContent>
            {(endpoints as any[]).length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Webhook className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No webhook endpoints registered</p>
                <p className="text-xs mt-1">Register an endpoint to receive real-time NDSEP events</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(endpoints as any[]).map((ep: any) => (
                  <div key={ep.endpoint_id} className="bg-muted/50 rounded-lg p-4 border border-border">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={ep.status === "active" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>{String(ep.status ?? "active")}</Badge>
                          <code className="text-xs text-muted-foreground">{ep.endpoint_id}</code>
                        </div>
                        <p className="text-foreground font-medium text-sm truncate">{ep.url}</p>
                        <p className="text-muted-foreground text-xs mt-1">{ep.description || "No description"}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-400" /> {ep.delivery_count ?? 0} delivered</span>
                          <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" /> {ep.failure_count ?? 0} failed</span>
                          {ep.last_delivered_at && <span>Last: {new Date(String(ep.last_delivered_at)).toLocaleDateString("en-NG")}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:text-foreground" onClick={() => deliverMut.mutate({ endpointId: String(ep.endpoint_id), eventType: "test.ping", payload: { message: "NDSEP test ping", timestamp: new Date().toISOString() } })}>
                          <Send className="w-3 h-3 mr-1" /> Test
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => deleteMut.mutate({ endpointId: String(ep.endpoint_id) })}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
