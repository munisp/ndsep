import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, BookOpen, Scale, Bell, ExternalLink, Clock, Filter } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const impactColors: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/20 text-green-400 border-green-500/30",
};

const typeIcons: Record<string, React.ReactNode> = {
  regulation: <Scale className="w-4 h-4 text-blue-400" />,
  guidance: <BookOpen className="w-4 h-4 text-purple-400" />,
  enforcement_action: <AlertTriangle className="w-4 h-4 text-red-400" />,
  case_law: <Scale className="w-4 h-4 text-green-400" />,
  circular: <Bell className="w-4 h-4 text-orange-400" />,
};

export default function RegulatoryIntelligence() {
  const [search, setSearch] = useState("");
  const [impactFilter, setImpactFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);

  const { data: items } = trpc.phase12.regulatoryIntelligence.list.useQuery({
    search: search || undefined,
    impactLevel: impactFilter !== "all" ? impactFilter : undefined,
    itemType: typeFilter !== "all" ? typeFilter : undefined,
  });

  const actionItems = items?.filter(i => i.action_required) ?? [];
  const criticalItems = items?.filter(i => i.impact_level === "critical") ?? [];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Regulatory Intelligence" }]} className="mb-4" />
      <div>
        <h1 className="text-2xl font-bold text-foreground">Regulatory Intelligence Hub</h1>
        <p className="text-muted-foreground text-sm mt-1">NDPC, CBN, NCC, NITDA — Real-time regulatory updates and compliance obligations</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-red-900/20 border-red-700/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs">Action Required</p>
            <p className="text-2xl font-bold text-red-300">{actionItems.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-orange-900/20 border-orange-700/40">
          <CardContent className="p-4">
            <p className="text-orange-400 text-xs">Critical Impact</p>
            <p className="text-2xl font-bold text-orange-300">{criticalItems.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Items</p>
            <p className="text-2xl font-bold text-foreground">{items?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Upcoming Deadlines</p>
            <p className="text-2xl font-bold text-foreground">
              {items?.filter(i => i.compliance_deadline && new Date(i.compliance_deadline) > new Date()).length ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Input
          placeholder="Search regulatory items..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border-border text-foreground max-w-xs"
        />
        <Select value={impactFilter} onValueChange={setImpactFilter}>
          <SelectTrigger className="bg-card border-border text-foreground w-40">
            <SelectValue placeholder="Impact Level" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">All Impacts</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="bg-card border-border text-foreground w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="regulation">Regulation</SelectItem>
            <SelectItem value="guidance">Guidance</SelectItem>
            <SelectItem value="enforcement_action">Enforcement Action</SelectItem>
            <SelectItem value="case_law">Case Law</SelectItem>
            <SelectItem value="circular">Circular</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Items Grid */}
      <div className="grid grid-cols-1 gap-4">
        {items?.map(item => (
          <Card key={item.id}
            className={`border cursor-pointer hover:border-muted-foreground transition-colors ${item.action_required ? "bg-card/70 border-orange-700/40" : "bg-card/50 border-border"}`}
            onClick={() => setSelected(item)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-0.5">{typeIcons[item.item_type] ?? <BookOpen className="w-4 h-4 text-muted-foreground" />}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-foreground font-medium text-sm">{item.title}</span>
                      {item.action_required && (
                        <Badge className="bg-red-500/20 text-red-400 text-[10px]">ACTION REQUIRED</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs line-clamp-2 mb-2">{item.summary}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="border-border text-muted-foreground text-[10px]">{item.source_org}</Badge>
                      <Badge className={impactColors[item.impact_level ?? "medium"] + " text-[10px]"}>{item.impact_level}</Badge>
                      {(item.ndpa_articles as string[])?.map((a: string) => (
                        <Badge key={a} className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">{a}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {item.compliance_deadline && (
                    <div className="flex items-center gap-1 text-xs text-amber-400">
                      <Clock className="w-3 h-3" />
                      <span>Due: {new Date(item.compliance_deadline).toLocaleDateString()}</span>
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs mt-1">{item.published_at ? new Date(item.published_at).toLocaleDateString() : ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground pr-8">{selected?.title}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Badge className={impactColors[selected.impact_level ?? "medium"]}>{selected.impact_level} impact</Badge>
                <Badge variant="outline" className="border-border text-muted-foreground">{selected.source_org}</Badge>
                <Badge variant="outline" className="border-border text-muted-foreground capitalize">{selected.item_type?.replace("_", " ")}</Badge>
                {selected.action_required && <Badge className="bg-red-500/20 text-red-400">Action Required</Badge>}
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">{selected.summary}</p>
              {selected.compliance_deadline && (
                <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
                  <p className="text-amber-400 text-sm font-medium">Compliance Deadline: {new Date(selected.compliance_deadline).toLocaleDateString()}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs mb-2">Affected Sectors</p>
                <div className="flex flex-wrap gap-1">
                  {(selected.affected_sectors as string[])?.map((s: string) => (
                    <Badge key={s} className="bg-muted text-muted-foreground text-[10px]">{s}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-2">NDPA Articles</p>
                <div className="flex flex-wrap gap-1">
                  {(selected.ndpa_articles as string[])?.map((a: string) => (
                    <Badge key={a} className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">{a}</Badge>
                  ))}
                </div>
              </div>
              {selected.source_url && (
                <Button variant="outline" size="sm" className="border-border text-muted-foreground" asChild>
                  <a href={selected.source_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3 mr-2" /> View Source
                  </a>
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
