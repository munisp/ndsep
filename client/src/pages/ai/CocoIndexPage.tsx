import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowLeft, FileText, Clock, Database } from "lucide-react";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { toast } from "sonner";

export default function CocoIndexPage() {
  const { data: health } = trpc.cocoIndex.health.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: status, refetch } = trpc.cocoIndex.getStatus.useQuery();
  const triggerM = trpc.cocoIndex.triggerRun.useMutation({
    onSuccess: () => { toast.success("ETL pipeline triggered"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "AI Hub", href: "/ai/hub" }, { label: "CocoIndex ETL" }]} />
      <div className="flex items-center gap-3">
        <Link href="/ai/hub"><Button variant="ghost" size="icon" aria-label="Go back"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <RefreshCw className="h-7 w-7 text-yellow-500" />
        <div>
          <h1 className="text-2xl font-bold">CocoIndex ETL Pipeline</h1>
          <p className="text-muted-foreground text-sm">Incremental document indexing for compliance docs, regulations, and enforcement records</p>
        </div>
        <div className="ml-auto">
          <Badge variant={health?.error ? "destructive" : "default"}>
            {health?.error ? "Worker Offline" : "Connected"}
          </Badge>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" />Pipeline Status</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold capitalize">{status?.status ?? "unknown"}</p>
            <p className="text-xs text-muted-foreground mt-1">{status?.available === false ? "Worker not reachable" : "Worker connected"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Documents Indexed</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{status?.documents_indexed ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" />Last Run</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">{status?.last_run ? new Date(status.last_run as string).toLocaleString() : "Never"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Collections</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(status?.collections as unknown[])?.length ?? 0}</p>
            <div className="mt-1 space-y-1">
              {((status?.collections ?? []) as string[]).map((c: string) => (
                <Badge key={c} variant="outline" className="mr-1 text-xs">{c}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trigger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual Pipeline Trigger</CardTitle>
          <CardDescription>Run the incremental indexing pipeline to process new or updated documents</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => triggerM.mutate()} disabled={triggerM.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${triggerM.isPending ? "animate-spin" : ""}`} />
            {triggerM.isPending ? "Running Pipeline..." : "Trigger ETL Run"}
          </Button>
          {triggerM.data && !triggerM.data.error && (
            <p className="text-sm text-green-600 mt-2">Pipeline completed successfully</p>
          )}
          {triggerM.data?.error && (
            <p className="text-sm text-red-600 mt-2">Pipeline failed: {String(triggerM.data.error)}</p>
          )}
        </CardContent>
      </Card>

      {/* Architecture Note */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Architecture</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>CocoIndex runs as a Python worker that incrementally processes compliance documents, NDPA regulations, enforcement orders, and penalty notices.</p>
          <p>Documents are chunked, embedded using sentence-transformers, and stored in Qdrant for semantic search.</p>
          <p>Start the worker: <code className="bg-muted px-1 rounded text-xs">python workers/python/cocoindex_worker.py</code></p>
        </CardContent>
      </Card>
    </div>
  );
}
