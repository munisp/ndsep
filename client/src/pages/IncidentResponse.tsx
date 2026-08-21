import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Shield, Play, CheckCircle, Clock, Bell, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const severityColors: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/20 text-green-400 border-green-500/30",
};

const statusColors: Record<string, string> = {
  active: "bg-red-500/20 text-red-400",
  contained: "bg-yellow-500/20 text-yellow-400",
  resolved: "bg-green-500/20 text-green-400",
  post_mortem: "bg-blue-500/20 text-blue-400",
};

export default function IncidentResponse() {
  const [showActivate, setShowActivate] = useState(false);
  const [selectedPlaybook, setSelectedPlaybook] = useState<any>(null);
  const [activationForm, setActivationForm] = useState({ incidentTitle: "", assignedTo: "", affectedRecords: 0 });

  const { data: playbooks } = trpc.phase12.incidentResponse.listPlaybooks.useQuery();
  const { data: activations, refetch } = trpc.phase12.incidentResponse.listActivations.useQuery({});

  const activate = trpc.phase12.incidentResponse.activatePlaybook.useMutation({
    onSuccess: () => { refetch(); setShowActivate(false); toast.success("Incident response activated"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const advanceStep = trpc.phase12.incidentResponse.advanceStep.useMutation({
    onSuccess: () => { refetch(); toast.success("Step advanced"); },
  });
  const resolve = trpc.phase12.incidentResponse.resolveActivation.useMutation({
    onSuccess: () => { refetch(); toast.success("Incident resolved"); },
  });

  const activeCount = activations?.filter(a => a.status === "active").length ?? 0;
  const ndpcNotified = activations?.filter(a => a.ndpc_notified).length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc" }, { label: "Incident Response" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Incident Response Playbooks</h1>
          <p className="text-muted-foreground text-sm mt-1">NDPA Section 40 — 72-hour NDPC breach notification workflows</p>
        </div>
        <Button onClick={() => setShowActivate(true)} className="bg-red-600 hover:bg-red-700 text-foreground">
          <AlertTriangle className="w-4 h-4 mr-2" /> Activate Incident
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-red-900/20 border-red-700/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs">Active Incidents</p>
            <p className="text-2xl font-bold text-red-300">{activeCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Activations</p>
            <p className="text-2xl font-bold text-foreground">{activations?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-900/20 border-green-700/40">
          <CardContent className="p-4">
            <p className="text-green-400 text-xs">NDPC Notified</p>
            <p className="text-2xl font-bold text-green-300">{ndpcNotified}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Playbooks Available</p>
            <p className="text-2xl font-bold text-foreground">{playbooks?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Playbooks */}
      <div>
        <h2 className="text-foreground font-semibold mb-3">Available Playbooks</h2>
        <div className="grid grid-cols-2 gap-4">
          {playbooks?.map(pb => (
            <Card key={pb.id} className="bg-card/50 border-border hover:border-muted-foreground cursor-pointer"
              onClick={() => { setSelectedPlaybook(pb); setShowActivate(true); }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-foreground font-medium">{pb.title}</p>
                    <p className="text-muted-foreground text-xs">{pb.playbook_code}</p>
                  </div>
                  <Badge className={severityColors[pb.severity ?? "high"]}>{pb.severity}</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> SLA: {pb.sla_hours}h</span>
                  <span>{(pb.steps as any[])?.length ?? 0} steps</span>
                </div>
                {pb.ndpa_obligation && (
                  <p className="text-blue-400 text-xs mt-2">{pb.ndpa_obligation}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Active Incidents */}
      <div>
        <h2 className="text-foreground font-semibold mb-3">Incident Activations</h2>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Ref</TableHead>
                  <TableHead className="text-muted-foreground">Incident</TableHead>
                  <TableHead className="text-muted-foreground">Organisation</TableHead>
                  <TableHead className="text-muted-foreground">Step</TableHead>
                  <TableHead className="text-muted-foreground">NDPC</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activations?.map(a => (
                  <TableRow key={a.id} className="border-border">
                    <TableCell className="text-muted-foreground font-mono text-xs">{a.activation_ref}</TableCell>
                    <TableCell>
                      <p className="text-foreground text-sm">{a.incident_title}</p>
                      <p className="text-muted-foreground text-xs">{a.incident_type}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{a.org_name ?? "—"}</TableCell>
                    <TableCell>
                      <span className="text-foreground">Step {a.current_step}</span>
                      <span className="text-muted-foreground"> of {(a.steps as any[])?.length ?? "?"}</span>
                    </TableCell>
                    <TableCell>
                      {a.ndpc_notified
                        ? <Badge className="bg-green-500/20 text-green-400">Notified</Badge>
                        : <Badge className="bg-red-500/20 text-red-400">Pending</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[a.status ?? "active"] ?? ""}>{a.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {a.status === "active" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-blue-400"
                              onClick={() => advanceStep.mutate({ activationId: a.id, stepNumber: (a.current_step ?? 1) + 1 })}>
                              <ChevronRight className="w-3 h-3" />
                            </Button>
                            {!a.ndpc_notified && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-orange-400"
                                onClick={() => advanceStep.mutate({ activationId: a.id, stepNumber: a.current_step ?? 1, ndpcNotified: true })}>
                                <Bell className="w-3 h-3" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-green-400"
                              onClick={() => resolve.mutate({ activationId: a.id })}>
                              <CheckCircle className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Activate Dialog */}
      <Dialog open={showActivate} onOpenChange={setShowActivate}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Activate Incident Response</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-sm">Playbook</Label>
              <select
                className="w-full mt-1 bg-muted border border-border rounded-md p-2 text-foreground text-sm"
                value={selectedPlaybook?.id ?? ""}
                onChange={e => setSelectedPlaybook(playbooks?.find(p => p.id === parseInt(e.target.value)))}
              >
                <option value="">Select playbook...</option>
                {playbooks?.map(pb => (
                  <option key={pb.id} value={pb.id}>{pb.title}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Incident Title</Label>
              <Input className="mt-1 bg-muted border-border text-foreground"
                placeholder="Brief description of the incident"
                value={activationForm.incidentTitle}
                onChange={e => setActivationForm(f => ({ ...f, incidentTitle: e.target.value }))} />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Assigned To (DPO/CISO)</Label>
              <Input className="mt-1 bg-muted border-border text-foreground"
                placeholder="Name or email"
                value={activationForm.assignedTo}
                onChange={e => setActivationForm(f => ({ ...f, assignedTo: e.target.value }))} />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Estimated Affected Records</Label>
              <Input type="number" className="mt-1 bg-muted border-border text-foreground"
                value={activationForm.affectedRecords}
                onChange={e => setActivationForm(f => ({ ...f, affectedRecords: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setShowActivate(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700"
              disabled={!selectedPlaybook || !activationForm.incidentTitle}
              onClick={() => activate.mutate({
                playbookId: selectedPlaybook.id,
                incidentTitle: activationForm.incidentTitle,
                assignedTo: activationForm.assignedTo,
                affectedRecords: activationForm.affectedRecords,
              })}>
              Activate Response
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
