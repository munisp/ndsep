import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { MessageSquare, Send, Bell, CheckCircle, XCircle, Plus } from "lucide-react";

export default function SmsAlerts() {
  const [sendOpen, setSendOpen] = useState(false);
  const [form, setForm] = useState({ alertType: "breach_notification", orgId: 1, phone: "+2348000000000", customMessage: "" });

  const { data: history = [], refetch } = trpc.smsAlerts.getAlertHistory.useQuery({ limit: 50 });
  const sendBreachMut = trpc.smsAlerts.sendBreachAlert.useMutation({
    onSuccess: (d) => { toast.success(d.sms.success ? `SMS sent successfully` : `SMS failed: ${d.sms.error ?? "unknown error"}`); setSendOpen(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const statCards = [
    { label: "Total Sent", value: (history as any[]).length, color: "text-blue-400" },
    { label: "Delivered", value: (history as any[]).filter((h: any) => h.status === "delivered").length, color: "text-green-400" },
    { label: "Failed", value: (history as any[]).filter((h: any) => h.status === "failed").length, color: "text-red-400" },
    { label: "Pending", value: (history as any[]).filter((h: any) => h.status === "pending").length, color: "text-yellow-400" },
  ];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><MessageSquare className="w-6 h-6 text-green-400" /> SMS Enforcement Alerts</h1>
            <p className="text-muted-foreground text-sm mt-1">Termii-powered SMS notifications for breach alerts, penalty notices, and regulatory deadlines</p>
          </div>
          <Dialog open={sendOpen} onOpenChange={setSendOpen}>
            <DialogTrigger asChild>
              <Button className="bg-green-600 hover:bg-green-700"><Send className="w-4 h-4 mr-2" /> Send Alert</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border text-foreground">
              <DialogHeader><DialogTitle>Send SMS Enforcement Alert</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Alert Type</Label>
                  <Select value={form.alertType} onValueChange={v => setForm(f => ({ ...f, alertType: v }))}>
                    <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      <SelectItem value="breach_notification">Breach Notification</SelectItem>
                      <SelectItem value="penalty_notice">Penalty Notice</SelectItem>
                      <SelectItem value="compliance_deadline">Compliance Deadline</SelectItem>
                      <SelectItem value="certificate_expiry">Certificate Expiry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Recipient Phone (+234...)</Label><Input className="bg-muted border-border" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+2348012345678" /></div>
                <div><Label>Custom Message (optional)</Label><Input className="bg-muted border-border" value={form.customMessage} onChange={e => setForm(f => ({ ...f, customMessage: e.target.value }))} placeholder="Override default message..." /></div>
                <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-muted-foreground mb-1">Default message preview:</p>
                  <p>NDSEP ALERT: {form.alertType === "breach_notification" ? "A data breach has been reported. 72-hour notification window is active. Log in to NDSEP to respond." : form.alertType === "penalty_notice" ? "A regulatory penalty has been issued. Please log in to NDSEP to view details and initiate payment." : "A compliance deadline is approaching. Please log in to NDSEP to take action."}</p>
                </div>
                <Button className="w-full bg-green-600 hover:bg-green-700" disabled={!form.phone || sendBreachMut.isPending} onClick={() => sendBreachMut.mutate({ orgName: `Organization #${form.orgId}`, breachType: form.alertType, severity: "high", phoneNumber: form.phone })}>
                  {sendBreachMut.isPending ? "Sending..." : "Send SMS Alert"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map(s => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground flex items-center gap-2"><Bell className="w-5 h-5 text-green-400" /> Alert History</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Type</th><th className="text-left py-2 px-3">Recipient</th>
                  <th className="text-left py-2 px-3">Message</th><th className="text-left py-2 px-3">Sent</th>
                  <th className="text-left py-2 px-3">Status</th>
                </tr></thead>
                <tbody>
                  {(history as any[]).length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No SMS alerts sent yet</td></tr>
                  ) : (history as any[]).map((h: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-3"><Badge variant="outline" className="text-xs border-border text-muted-foreground">{String(h.alert_type ?? h.type ?? "alert").replace(/_/g, " ").toUpperCase()}</Badge></td>
                      <td className="py-2 px-3 text-muted-foreground">{h.phone ?? h.recipient ?? "—"}</td>
                      <td className="py-2 px-3 text-muted-foreground max-w-xs truncate">{h.message ?? "—"}</td>
                      <td className="py-2 px-3 text-muted-foreground">{h.sent_at ? new Date(String(h.sent_at)).toLocaleDateString("en-NG") : "—"}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          {h.status === "delivered" ? <CheckCircle className="w-4 h-4 text-green-400" /> : h.status === "failed" ? <XCircle className="w-4 h-4 text-red-400" /> : <div className="w-4 h-4 rounded-full bg-yellow-400" />}
                          <span className={`text-xs ${h.status === "delivered" ? "text-green-400" : h.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>{String(h.status ?? "pending")}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
