import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { Search, Network, Users, FileSearch, Database, Radio, Brain, GitBranch } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function EstoridesDashboard() {
  const [entityQuery, setEntityQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: stats } = trpc.estorides.stats.useQuery();
  const { data: investigations } = trpc.estorides.investigations.useQuery({ status: "active" });
  const { data: sources } = trpc.estorides.sources.useQuery();
  const { data: searchResults } = trpc.estorides.search.useQuery(
    { query: searchTerm, limit: 25 },
    { enabled: searchTerm.length >= 2 }
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc-dashboard" }, { label: "Estorides Knowledge Graph" }]} />
      <div>
        <h1 className="text-2xl font-bold">Estorides — Intelligence Knowledge Graph</h1>
        <p className="text-muted-foreground">Entity resolution, relationship mapping, multi-source OSINT correlation — Palantir-style analysis</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { icon: Users, label: "Entities", value: stats?.totalEntities ?? 0, color: "text-blue-500", bg: "bg-blue-500/10" },
          { icon: GitBranch, label: "Relationships", value: stats?.totalRelationships ?? 0, color: "text-purple-500", bg: "bg-purple-500/10" },
          { icon: Radio, label: "Sources", value: stats?.activeSources ?? 0, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { icon: FileSearch, label: "Investigations", value: stats?.activeInvestigations ?? 0, color: "text-amber-500", bg: "bg-amber-500/10" },
          { icon: Database, label: "Ingestions", value: stats?.recentIngestions ?? 0, color: "text-cyan-500", bg: "bg-cyan-500/10" },
          { icon: Network, label: "Graph Density", value: `${((stats?.graphDensity ?? 0) * 100).toFixed(1)}%`, color: "text-rose-500", bg: "bg-rose-500/10" },
          { icon: Brain, label: "Entity Types", value: Object.keys(stats?.entitiesByType ?? {}).length, color: "text-indigo-500", bg: "bg-indigo-500/10" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-md ${s.bg}`}><s.icon className={`w-3.5 h-3.5 ${s.color}`} /></div>
                <div>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[9px] text-muted-foreground">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Entity Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Search className="w-4 h-4" /> Entity Search & Resolution</CardTitle>
          <CardDescription>Search persons, organizations, locations, vessels, domains, crypto wallets — cross-source resolution</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input value={entityQuery} onChange={e => setEntityQuery(e.target.value)} placeholder="Search entity name, alias, identifier..." onKeyDown={e => { if (e.key === "Enter" && entityQuery.length >= 2) setSearchTerm(entityQuery); }} />
            <Button onClick={() => { if (entityQuery.length >= 2) setSearchTerm(entityQuery); }} aria-label="Search entity">Search</Button>
          </div>
          {searchResults && searchResults.results.length > 0 && (
            <div className="mt-4 space-y-2">
              {searchResults.results.map((r, i) => (
                <div key={r.entity.id ?? i} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{r.entity.name}</p>
                      <Badge className="bg-muted text-muted-foreground text-[10px]">{r.entity.type}</Badge>
                      <span className="text-[10px] text-muted-foreground">{r.entity.confidence}% confidence</span>
                    </div>
                    {r.entity.aliases.length > 0 && <p className="text-xs text-muted-foreground">aka: {r.entity.aliases.slice(0, 3).join(", ")}</p>}
                    <div className="flex gap-1 mt-1">
                      {r.entity.tags.slice(0, 4).map(t => <Badge key={t} className="bg-muted text-muted-foreground text-[9px]">{t}</Badge>)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{r.relatedCount} connections</p>
                    <p className="text-xs text-muted-foreground">{r.entity.sources.length} sources</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="investigations">
        <TabsList>
          <TabsTrigger value="investigations"><FileSearch className="w-3.5 h-3.5 mr-1" />Investigations</TabsTrigger>
          <TabsTrigger value="sources"><Radio className="w-3.5 h-3.5 mr-1" />Intelligence Sources</TabsTrigger>
          <TabsTrigger value="entities"><Users className="w-3.5 h-3.5 mr-1" />Entity Breakdown</TabsTrigger>
        </TabsList>

        <TabsContent value="investigations" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Active Investigations</CardTitle><CardDescription>Scoped intelligence engagements — entity and relationship tracking</CardDescription></CardHeader>
            <CardContent>
              {!investigations?.investigations.length ? <EmptyState title="No investigations" description="Create an investigation in Estorides to track entities" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Entities</TableHead><TableHead>Relationships</TableHead><TableHead>Tags</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {investigations.investigations.map((inv, i) => (
                      <TableRow key={inv.id ?? i}>
                        <TableCell className="font-medium">{inv.title}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${inv.status === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{inv.status}</Badge></TableCell>
                        <TableCell>{inv.entityCount}</TableCell>
                        <TableCell>{inv.relationshipCount}</TableCell>
                        <TableCell className="text-xs">{inv.tags.slice(0, 3).join(", ")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{inv.updatedAt?.slice(0, 10)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Intelligence Sources</CardTitle><CardDescription>OSINT, COMINT, HUMINT, SIGINT, GEOINT, FININT, CYBINT feeds</CardDescription></CardHeader>
            <CardContent>
              {!sources?.sources.length ? <EmptyState title="No sources" description="Configure intelligence sources in Estorides" /> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Reliability</TableHead><TableHead>Entities</TableHead><TableHead>Last Ingested</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {sources.sources.map((s, i) => (
                      <TableRow key={s.id ?? i}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell><Badge className="bg-muted text-muted-foreground text-[10px]">{s.type.toUpperCase()}</Badge></TableCell>
                        <TableCell><Badge className={`text-[10px] ${s.status === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : s.status === "error" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>{s.status}</Badge></TableCell>
                        <TableCell><span className={`font-bold ${s.reliability <= "B" ? "text-emerald-500" : s.reliability <= "D" ? "text-amber-500" : "text-red-500"}`}>{s.reliability}</span></TableCell>
                        <TableCell>{s.entityCount.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.lastIngested?.slice(0, 16).replace("T", " ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entities" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Entity Breakdown by Type</CardTitle></CardHeader>
            <CardContent>
              {!stats?.entitiesByType || Object.keys(stats.entitiesByType).length === 0 ? <EmptyState title="No entities" description="Ingest data sources to populate entity graph" /> : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Object.entries(stats.entitiesByType).sort(([,a], [,b]) => b - a).map(([type, count]) => (
                    <div key={type} className="p-3 rounded-lg border bg-card">
                      <p className="text-lg font-bold">{count.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground capitalize">{type.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
