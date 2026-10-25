import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Hash, Loader2, RefreshCw, Smartphone } from "lucide-react";

const INTAKE_STATUSES = ["pending_sync", "synced", "failed"] as const;

export default function UssdIntakeQueue() {
  const gateway = trpc.ussdChannel.gatewayStatus.useQuery();
  const [status, setStatus] = useState<string>("pending_sync");
  const queue = trpc.ussdChannel.listIntakeQueue.useQuery({
    status: (status || undefined) as (typeof INTAKE_STATUSES)[number] | undefined,
  });
  const outbox = trpc.ussdChannel.listOutbox.useQuery({});

  const sync = trpc.ussdChannel.syncPendingIntake.useMutation({
    onSuccess: (res: any) => { toast.success(`Sync complete — ${res.synced ?? res.processed ?? 0} intake(s) synced`); queue.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const processOutbox = trpc.ussdChannel.processOutbox.useMutation({
    onSuccess: (res: any) => { toast.success(`Outbox processed — ${res.sent ?? res.processed ?? 0} message(s)`); outbox.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const refresh = () => { gateway.refetch(); queue.refetch(); outbox.refetch(); };
  const gw: any = gateway.data;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "USSD Channel" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Smartphone className="h-6 w-6" /> USSD Complaint Intake</h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="secondary" onClick={() => sync.mutate({})} disabled={sync.isPending}>
            {sync.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Sync pending intake
          </Button>
          <Button variant="secondary" onClick={() => processOutbox.mutate()} disabled={processOutbox.isPending}>
            Process outbox
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Hash className="h-5 w-5" /> Gateway status</CardTitle>
          <CardDescription>Honest status of the USSD gateway bridge — UNCONFIGURED is reported, never faked.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {gw ? (
            <pre className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(gw, null, 2)}</pre>
          ) : "Loading…"}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Intake queue</CardTitle>
          <div className="pt-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTAKE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead><TableHead>Complaint ref</TableHead><TableHead>Language</TableHead>
                <TableHead>Category</TableHead><TableHead>Controller</TableHead><TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {((queue.data as any[]) ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.complaint_ref ?? "—"}</TableCell>
                  <TableCell>{r.language}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="text-sm">{r.controller_name ?? r.controller_ref ?? "—"}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">{r.description ?? "—"}</TableCell>
                </TableRow>
              ))}
              {((queue.data as any[]) ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Queue empty for this status.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notification outbox</CardTitle>
          <CardDescription>Pending status-change SMS notifications to complainants.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>#</TableHead><TableHead>Complaint ref</TableHead><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {((outbox.data as any)?.rows ?? (outbox.data as any[]) ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.complaint_ref ?? r.reference_code ?? "—"}</TableCell>
                  <TableCell>{r.channel ?? "sms"}</TableCell>
                  <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
              {(((outbox.data as any)?.rows ?? (outbox.data as any[])) ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Outbox empty.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
