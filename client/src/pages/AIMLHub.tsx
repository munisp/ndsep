import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Brain,
  Database,
  GitBranch,
  Search,
  Shield,
  Activity,
  Cpu,
  Network,
  BarChart3,
  Layers,
  Zap,
  BookOpen,
  RefreshCw,
} from "lucide-react";

const SERVICE_CARDS = [
  {
    title: "Vector Search (Qdrant)",
    description: "Semantic search across compliance documents using sentence-transformer embeddings and cosine similarity.",
    icon: Search,
    href: "/ai/vector-search",
    color: "text-blue-500",
    badge: "RAG",
  },
  {
    title: "Knowledge Graph (FalkorDB)",
    description: "Graph neural network analysis of org-violation-sector relationships. EPR-KGQA question answering.",
    icon: Network,
    href: "/ai/knowledge-graph",
    color: "text-purple-500",
    badge: "GNN",
  },
  {
    title: "Local LLM (Ollama)",
    description: "On-premise LLaMA 3.2 inference for compliance Q&A with RAG context injection.",
    icon: Brain,
    href: "/ai/llm-studio",
    color: "text-green-500",
    badge: "LLM",
  },
  {
    title: "Model Registry",
    description: "Version-controlled ML model catalogue with accuracy metrics, drift detection, and A/B testing.",
    icon: Layers,
    href: "/ai/model-registry",
    color: "text-orange-500",
    badge: "MLOps",
  },
  {
    title: "ART Robustness Testing",
    description: "Adversarial robustness evaluation using IBM ART: FGSM, PGD, DeepFool, Carlini-Wagner attacks.",
    icon: Shield,
    href: "/ai/art-dashboard",
    color: "text-red-500",
    badge: "Security",
  },
  {
    title: "Feature Store",
    description: "Lakehouse-backed ML feature store with entity features, prediction logs, and data lineage tracking.",
    icon: Database,
    href: "/ai/feature-store",
    color: "text-cyan-500",
    badge: "Lakehouse",
  },
  {
    title: "CocoIndex ETL",
    description: "Incremental document indexing pipeline for compliance docs, regulations, and enforcement records.",
    icon: RefreshCw,
    href: "/ai/cocoindex",
    color: "text-yellow-500",
    badge: "ETL",
  },
  {
    title: "Anomaly Alerts",
    description: "Real-time compliance score anomaly detection using Isolation Forest with WebSocket notifications.",
    icon: Zap,
    href: "/ai/anomaly-alerts",
    color: "text-pink-500",
    badge: "Real-time",
  },
];

export default function AIMLHub() {
  const { data: health, isLoading } = trpc.aiHealth.summary.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const healthScore = health?.health_score ?? 0;
  const healthColor =
    healthScore >= 80 ? "text-green-500" : healthScore >= 50 ? "text-yellow-500" : "text-red-500";

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-7 w-7 text-primary" />
              AI / ML Intelligence Hub
            </h1>
            <p className="text-muted-foreground mt-1">
              Integrated AI stack: Qdrant · FalkorDB · Ollama · ART · CocoIndex · Feature Store · Lakehouse
            </p>
          </div>
          {!isLoading && health && (
            <div className="text-right">
              <div className={`text-3xl font-bold ${healthColor}`}>{healthScore}%</div>
              <div className="text-xs text-muted-foreground">
                {health.healthy_services}/{health.total_services} services healthy
              </div>
            </div>
          )}
        </div>

        {/* Service Status Grid */}
        {health && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {health.services.map((svc: any) => (
              <div
                key={svc.name}
                className={`rounded-lg border p-2 text-center text-xs ${
                  svc.available
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full mx-auto mb-1 ${
                    svc.available ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <div className="font-medium truncate" title={svc.name}>
                  {svc.name.split(" ")[0]}
                </div>
                <div className={`text-[10px] ${svc.available ? "text-green-600" : "text-red-600"}`}>
                  {svc.status}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {SERVICE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.href} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Icon className={`h-6 w-6 ${card.color}`} />
                    <Badge variant="secondary" className="text-xs">
                      {card.badge}
                    </Badge>
                  </div>
                  <CardTitle className="text-base mt-2">{card.title}</CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    {card.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Link href={card.href}>
                    <Button variant="outline" size="sm" className="w-full">
                      Open
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Architecture Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              AI/ML Architecture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
              <div>
                <h3 className="font-semibold text-primary mb-2 flex items-center gap-1">
                  <Cpu className="h-4 w-4" /> Inference Layer
                </h3>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• <strong>Ollama</strong> — LLaMA 3.2 local inference (Go worker)</li>
                  <li>• <strong>Built-in LLM</strong> — Manus Forge API fallback</li>
                  <li>• <strong>scikit-learn</strong> — Random Forest + Isolation Forest</li>
                  <li>• <strong>XGBoost</strong> — Breach probability scoring</li>
                  <li>• <strong>PyTorch Geometric</strong> — GraphSAGE GNN (staging)</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-primary mb-2 flex items-center gap-1">
                  <Database className="h-4 w-4" /> Storage Layer
                </h3>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• <strong>Qdrant</strong> — Vector embeddings (1536-dim)</li>
                  <li>• <strong>FalkorDB</strong> — Property graph (Redis-compatible)</li>
                  <li>• <strong>Rust vector_cache</strong> — In-memory similarity cache</li>
                  <li>• <strong>Rust lakehouse_writer</strong> — Iceberg/Delta feature store</li>
                  <li>• <strong>PostgreSQL</strong> — Model registry + prediction log</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-primary mb-2 flex items-center gap-1">
                  <Activity className="h-4 w-4" /> Pipeline Layer
                </h3>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• <strong>CocoIndex</strong> — Incremental doc ETL (Python)</li>
                  <li>• <strong>RAG Orchestrator</strong> — Retrieval-augmented generation (Go)</li>
                  <li>• <strong>ART Worker</strong> — Adversarial robustness testing (Python)</li>
                  <li>• <strong>Anomaly Dispatcher</strong> — Real-time alert dispatch (Go)</li>
                  <li>• <strong>EPR-KGQA</strong> — Knowledge graph Q&A (Python)</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lakehouse Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Lakehouse Integration
            </CardTitle>
            <CardDescription>
              All ML features, predictions, and lineage are persisted to the Delta Lake / Apache Iceberg lakehouse
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center text-sm">
              {[
                { label: "Feature Groups", value: "6", sub: "compliance, network, breach, sector, org, user" },
                { label: "Models Registered", value: "5", sub: "RF, IF, XGB, LSTM, GNN" },
                { label: "Predictions/day", value: "~200", sub: "across all orgs" },
                { label: "Lineage Records", value: "5+", sub: "pipeline runs tracked" },
                { label: "Vector Dimensions", value: "1536", sub: "sentence-transformers" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border p-3">
                  <div className="text-2xl font-bold text-primary">{stat.value}</div>
                  <div className="font-medium">{stat.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{stat.sub}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Documentation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Integration Notes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Qdrant</strong> runs on port 6333 (REST) and 6334 (gRPC). Start with{" "}
              <code className="bg-muted px-1 rounded">docker run -p 6333:6333 qdrant/qdrant</code>.
              The CocoIndex ETL worker automatically creates the <code className="bg-muted px-1 rounded">compliance_docs</code> collection on first run.
            </p>
            <p>
              <strong>FalkorDB</strong> is Redis-compatible and runs on port 6379.
              Start with <code className="bg-muted px-1 rounded">docker run -p 6379:6379 falkordb/falkordb</code>.
              The Go worker builds the knowledge graph from the PostgreSQL organizations/violations tables.
            </p>
            <p>
              <strong>Ollama</strong> runs on port 11434. Install with{" "}
              <code className="bg-muted px-1 rounded">curl -fsSL https://ollama.com/install.sh | sh</code>{" "}
              then <code className="bg-muted px-1 rounded">ollama pull llama3.2</code>.
              All Ollama calls fall back to the built-in Manus LLM when unavailable.
            </p>
            <p>
              <strong>All workers</strong> are configured via environment variables (see{" "}
              <code className="bg-muted px-1 rounded">.env.example</code>). Default URLs are set to localhost
              for development. In production, update the k8s ConfigMap in{" "}
              <code className="bg-muted px-1 rounded">infra/k8s/configmap.yaml</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
