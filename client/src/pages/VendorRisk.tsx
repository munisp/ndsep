import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Building2, Shield, AlertTriangle, Plus, Star, TrendingDown } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const riskColors: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/20 text-green-400 border-green-500/30",
};


type VendorType = "saas" | "cloud" | "data_processor" | "sub_processor" | "consulting";
const EMPTY_FORM = { vendorName: "", vendorType: "saas" as VendorType, country: "Nigeria", dataAccess: "none", contractRef: "" };

export default function VendorRisk() {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [riskFilter, setRiskFilter] = useState("all");

  const { data: vendors, refetch } = trpc.phase12.vendorRisk.list.useQuery({
    riskLevel: riskFilter !== "all" ? riskFilter : undefined,
  });
  const { data: stats } = trpc.phase12.vendorRisk.getStats.useQuery();

  const addVendor = trpc.phase12.vendorRisk.create.useMutation({
    onSuccess: () => { refetch(); setShowAdd(false); setForm(EMPTY_FORM); toast.success("Vendor added"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const scoreVendor = trpc.phase12.vendorRisk.update.useMutation({
    onSuccess: () => { refetch(); toast.success("Vendor scored"); },
  });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Vendor Risk" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vendor Risk Management</h1>
          <p className="text-muted-foreground text-sm mt-1">NDPA Third-Party Processor Due Diligence — Article 44 compliance</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" /> Add Vendor
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-red-900/20 border-red-700/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs">High/Critical Risk</p>
            <p className="text-2xl font-bold text-red-300">{stats?.highRisk ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Vendors</p>
            <p className="text-2xl font-bold text-foreground">{stats?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-900/20 border-green-700/40">
          <CardContent className="p-4">
            <p className="text-green-400 text-xs">DPA Signed</p>
            <p className="text-2xl font-bold text-green-300">{stats?.dpaSigned ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-900/20 border-amber-700/40">
          <CardContent className="p-4">
            <p className="text-amber-400 text-xs">Avg Risk Score</p>
            <p className="text-2xl font-bold text-amber-300">{stats?.avgScore ?? 0}/100</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="bg-card border-border text-foreground w-44">
            <SelectValue placeholder="All Risk Levels" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">All Risk Levels</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-card/50 border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Vendor</TableHead>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Country</TableHead>
                <TableHead className="text-muted-foreground">Data Access</TableHead>
                <TableHead className="text-muted-foreground">DPA</TableHead>
                <TableHead className="text-muted-foreground">Risk Score</TableHead>
                <TableHead className="text-muted-foreground">Risk Level</TableHead>
                <TableHead className="text-muted-foreground">Last Assessed</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors?.map(v => (
                <TableRow key={v.id} className="border-border">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-foreground text-sm font-medium">{v.vendor_name}</p>
                        <p className="text-muted-foreground text-xs">{v.contract_ref}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="border-border text-muted-foreground capitalize">{v.vendor_type}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{v.country}</TableCell>
                  <TableCell>
                    <Badge className={v.data_access_level === "full" ? "bg-red-500/20 text-red-400" : v.data_access_level === "partial" ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"}>
                      {v.data_access_level}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {v.dpa_signed
                      ? <Badge className="bg-green-500/20 text-green-400">Signed</Badge>
                      : <Badge className="bg-red-500/20 text-red-400">Missing</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-muted rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-gradient-to-r from-green-500 to-red-500"
                          style={{ width: `${v.risk_score ?? 0}%` }} />
                      </div>
                      <span className="text-foreground text-sm">{v.risk_score ?? 0}</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge className={riskColors[v.risk_level ?? "medium"]}>{v.risk_level}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {v.last_assessed_at ? new Date(v.last_assessed_at).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-blue-400"
                      onClick={() => scoreVendor.mutate({ id: v.id })}>
                      <Star className="w-3 h-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-sm">Vendor Name</Label>
              <Input className="mt-1 bg-muted border-border text-foreground" value={form.vendorName}
                onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-muted-foreground text-sm">Type</Label>
                <Select value={form.vendorType} onValueChange={v => setForm(f => ({ ...f, vendorType: v as VendorType }))}>
                  <SelectTrigger className="mt-1 bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="saas">SaaS</SelectItem>
                    <SelectItem value="cloud">Cloud Provider</SelectItem>
                    <SelectItem value="consulting">Consulting</SelectItem>
                    <SelectItem value="fintech">Fintech</SelectItem>
                    <SelectItem value="telecom">Telecom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Country</Label>
                <Input className="mt-1 bg-muted border-border text-foreground" value={form.country}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Data Access Level</Label>
              <Select value={form.dataAccess} onValueChange={v => setForm(f => ({ ...f, dataAccess: v }))}>
                <SelectTrigger className="mt-1 bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="metadata">Metadata Only</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="full">Full Access</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Contract Reference</Label>
              <Input className="mt-1 bg-muted border-border text-foreground" value={form.contractRef}
                placeholder="e.g. CONTRACT-2024-001"
                onChange={e => setForm(f => ({ ...f, contractRef: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={!form.vendorName}
              onClick={() => addVendor.mutate(form)}>
              Add Vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
