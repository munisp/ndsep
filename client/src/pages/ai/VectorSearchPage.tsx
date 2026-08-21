import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Database, FileText, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function VectorSearchPage() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { data: health } = trpc.qdrant.health.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: collections } = trpc.qdrant.collections.useQuery();
  const { data: results, isLoading } = trpc.qdrant.search.useQuery(
    { query: submitted, limit: 10, threshold: 0.6 },
    { enabled: !!submitted },
  );
  const ingestM = trpc.qdrant.ingestDocument.useMutation();

  return (
    <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "AI Hub", href: "/ai/hub" }, { label: "Vector Search" }]} />
      <div className="flex items-center gap-3">
        <Link href="/ai/hub"><Button variant="ghost" size="icon" aria-label="Go back"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <Search className="h-7 w-7 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold">Vector Search (Qdrant)</h1>
          <p className="text-muted-foreground text-sm">Semantic search across compliance documents using sentence-transformer embeddings</p>
        </div>
        <div className="ml-auto">
          <Badge variant={health?.available ? "default" : "destructive"}>
            {health?.available ? "Connected" : "Unavailable"}
          </Badge>
        </div>
      </div>

      {/* Search Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search compliance documents semantically..."
              onKeyDown={(e) => e.key === "Enter" && query.trim() && setSubmitted(query.trim())}
            />
            <Button onClick={() => query.trim() && setSubmitted(query.trim())} disabled={!query.trim() || isLoading}>
              <Search className="h-4 w-4 mr-1" />Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Collections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" />Collections</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{collections?.collections?.length ?? 0}</p>
            <div className="mt-2 space-y-1">
              {(collections?.collections ?? []).map((c: { name?: string }) => (
                <Badge key={c.name} variant="outline" className="mr-1">{c.name}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Service Status</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">URL: <code className="bg-muted px-1 rounded text-xs">{health?.url ?? "—"}</code></p>
            <p className="text-sm mt-1">Status: <span className={health?.available ? "text-green-600" : "text-red-600"}>{health?.status ?? "unknown"}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Quick Ingest</CardTitle></CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" disabled={ingestM.isPending}
              onClick={() => ingestM.mutate({ title: "Test Document", content: "NDPA 2023 compliance test document", collection: "compliance_docs" })}>
              <FileText className="h-4 w-4 mr-1" />{ingestM.isPending ? "Ingesting..." : "Ingest Test Doc"}
            </Button>
            {ingestM.data && <p className="text-xs text-green-600 mt-1">Ingested: {ingestM.data.status}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Search Results */}
      {submitted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Results for &ldquo;{submitted}&rdquo;</CardTitle>
            <CardDescription>{results?.total ?? 0} matches · Source: {results?.source ?? "—"}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Searching...</p>
            ) : (results?.results ?? []).length === 0 ? (
              <p className="text-muted-foreground">No results found. Try a different query or lower the similarity threshold.</p>
            ) : (
              <div className="space-y-3">
                {(results?.results ?? []).map((r: { id?: string; score?: number; payload?: { title?: string; content?: string } }, i: number) => (
                  <div key={r.id ?? i} className="border rounded-lg p-3 hover:bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{r.payload?.title ?? `Result #${i + 1}`}</span>
                      <Badge variant="secondary" className="text-xs">{((r.score ?? 0) * 100).toFixed(1)}% match</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.payload?.content ?? "—"}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
