import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import { Breadcrumbs } from "@/components/Breadcrumbs";
type SectionProps = { title: string; description: string; children: React.ReactNode };
function Section({ title, description, children }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function val(data: unknown, key: string, fallback = "—"): string {
  if (!data || typeof data !== "object") return fallback;
  const v = (data as Record<string, unknown>)[key];
  return v != null ? String(v) : fallback;
}

function AuditChainTab() {
  const stats = trpc.platformIntelligence.auditChainStats.useQuery();
  const verify = trpc.platformIntelligence.auditChainVerify.useQuery();
  const merkle = trpc.platformIntelligence.auditChainMerkleRoot.useQuery();
  const chainValid = verify.data && typeof verify.data === "object" && (verify.data as Record<string, unknown>).chain_valid;

  return (
    <div className="space-y-4">
      <Section title="Blockchain Audit Chain" description="Tamper-proof audit logging with SHA-256 hash chain and Merkle tree anchoring">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><p className="text-sm text-muted-foreground">Total Entries</p><p className="text-2xl font-bold">{val(stats.data, "total_entries")}</p></div>
          <div><p className="text-sm text-muted-foreground">Merkle Roots</p><p className="text-2xl font-bold">{val(stats.data, "merkle_roots")}</p></div>
          <div><p className="text-sm text-muted-foreground">Anchored</p><p className="text-2xl font-bold">{val(stats.data, "anchored_roots")}</p></div>
          <div><p className="text-sm text-muted-foreground">Chain Integrity</p>
            <Badge variant={chainValid ? "default" : "destructive"}>
              {chainValid ? "Verified" : "Checking..."}
            </Badge>
          </div>
        </div>
      </Section>
      <Section title="Today's Merkle Root" description="Daily aggregation of all audit entries for blockchain anchoring">
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">{JSON.stringify(merkle.data, null, 2)}</pre>
      </Section>
    </div>
  );
}

function FederatedLearningTab() {
  const stats = trpc.platformIntelligence.federatedStats.useQuery();
  const model = trpc.platformIntelligence.federatedModel.useQuery();
  const feed = trpc.platformIntelligence.federatedThreatFeed.useQuery({ limit: 20 });

  return (
    <div className="space-y-4">
      <Section title="Federated Learning" description="Privacy-preserving cross-organization threat intelligence">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><p className="text-sm text-muted-foreground">Model Version</p><p className="text-2xl font-bold">{val(stats.data, "model_version")}</p></div>
          <div><p className="text-sm text-muted-foreground">Aggregation Rounds</p><p className="text-2xl font-bold">{val(stats.data, "aggregation_rounds")}</p></div>
          <div><p className="text-sm text-muted-foreground">Pending Updates</p><p className="text-2xl font-bold">{val(stats.data, "pending_updates")}</p></div>
          <div><p className="text-sm text-muted-foreground">Threat Feed</p><p className="text-2xl font-bold">{val(stats.data, "threat_feed_size")}</p></div>
        </div>
      </Section>
      <Section title="Global Model" description="FedAvg model weights shared across participating organizations">
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">{JSON.stringify(model.data, null, 2)}</pre>
      </Section>
      <Section title="Threat Feed" description="Anonymized threat intelligence from all participants">
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64">{JSON.stringify(feed.data, null, 2)}</pre>
      </Section>
    </div>
  );
}

function DigitalTwinTab() {
  const state = trpc.platformIntelligence.twinState.useQuery();
  const predictions = trpc.platformIntelligence.twinPredictBreaches.useQuery();

  return (
    <div className="space-y-4">
      <Section title="Digital Twin — Nigeria Data Ecosystem" description="Real-time simulation of the national data protection landscape">
        {state.data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><p className="text-sm text-muted-foreground">Total Organizations</p><p className="text-2xl font-bold">{val(state.data, "total_organizations")}</p></div>
            <div><p className="text-sm text-muted-foreground">Avg Compliance</p><p className="text-2xl font-bold">{val(state.data, "avg_compliance_score")}%</p></div>
            <div><p className="text-sm text-muted-foreground">Data Flows</p><p className="text-2xl font-bold">{val(state.data, "total_data_flows")}</p></div>
            <div><p className="text-sm text-muted-foreground">Cross-Border</p><p className="text-2xl font-bold">{val(state.data, "cross_border_flows")}</p></div>
          </div>
        ) : <p className="text-muted-foreground">Loading ecosystem state...</p>}
      </Section>
      <Section title="Breach Predictions" description="ML-based probability forecasts for upcoming 30/90 days">
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64">{JSON.stringify(predictions.data, null, 2)}</pre>
      </Section>
    </div>
  );
}

function SovereignAITab() {
  const languages = trpc.platformIntelligence.sovereignLanguages.useQuery();
  const models = trpc.platformIntelligence.sovereignModels.useQuery();
  const residency = trpc.platformIntelligence.sovereignResidencyReport.useQuery();
  const langCount = languages.data && typeof languages.data === "object" ? String((Array.isArray((languages.data as Record<string, unknown>).languages) ? ((languages.data as Record<string, unknown>).languages as unknown[]).length : 0)) : "—";
  const modelCount = models.data && typeof models.data === "object" ? String((Array.isArray((models.data as Record<string, unknown>).models) ? ((models.data as Record<string, unknown>).models as unknown[]).length : 0)) : "—";

  return (
    <div className="space-y-4">
      <Section title="Sovereign AI Infrastructure" description="On-premises AI with Nigerian data residency guarantees">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div><p className="text-sm text-muted-foreground">Models Registered</p><p className="text-2xl font-bold">{modelCount}</p></div>
          <div><p className="text-sm text-muted-foreground">Languages</p><p className="text-2xl font-bold">{langCount}</p></div>
          <div><p className="text-sm text-muted-foreground">Data Residency</p><Badge>Nigeria</Badge></div>
        </div>
      </Section>
      <Section title="Language Support" description="Nigerian language translations for the entire platform">
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-40">{JSON.stringify(languages.data, null, 2)}</pre>
      </Section>
      <Section title="Data Residency Report" description="NDPA Article 40 compliance verification for all AI processing">
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">{JSON.stringify(residency.data, null, 2)}</pre>
      </Section>
    </div>
  );
}

function QuantumCryptoTab() {
  const algorithms = trpc.platformIntelligence.pqcAlgorithms.useQuery();
  const algoList = Array.isArray(algorithms.data) ? (algorithms.data as Array<Record<string, unknown>>) : [];

  return (
    <div className="space-y-4">
      <Section title="Post-Quantum Cryptography" description="NIST-standardized quantum-resistant algorithms (FIPS 203/204)">
        {algoList.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {algoList.map((algo, i) => (
              <Card key={i} className="p-3">
                <p className="font-semibold">{String(algo.name)}</p>
                <p className="text-sm text-muted-foreground">{String(algo.category)}</p>
                <p className="text-xs mt-1">{String(algo.security_level)}</p>
                <Badge className="mt-2" variant={algo.quantum_safe ? "default" : "secondary"}>
                  {algo.quantum_safe ? "Quantum Safe" : "Classical"}
                </Badge>
              </Card>
            ))}
          </div>
        ) : <p className="text-muted-foreground">Loading algorithms...</p>}
      </Section>
    </div>
  );
}

export default function PlatformIntelligencePage() {
  const [tab, setTab] = useState("audit-chain");

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: "/" }, { label: "Platform Intelligence" }]} className="mb-4" />
      <div>
        <h1 className="text-2xl font-bold">Platform Intelligence</h1>
        <p className="text-muted-foreground mt-1">Next-generation capabilities: AI, blockchain, quantum crypto, federated learning, and digital twin simulation</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="audit-chain">Audit Chain</TabsTrigger>
          <TabsTrigger value="federated">Federated Learning</TabsTrigger>
          <TabsTrigger value="digital-twin">Digital Twin</TabsTrigger>
          <TabsTrigger value="sovereign-ai">Sovereign AI</TabsTrigger>
          <TabsTrigger value="quantum">Quantum Crypto</TabsTrigger>
        </TabsList>
        <TabsContent value="audit-chain"><AuditChainTab /></TabsContent>
        <TabsContent value="federated"><FederatedLearningTab /></TabsContent>
        <TabsContent value="digital-twin"><DigitalTwinTab /></TabsContent>
        <TabsContent value="sovereign-ai"><SovereignAITab /></TabsContent>
        <TabsContent value="quantum"><QuantumCryptoTab /></TabsContent>
      </Tabs>
    </div>
  );
}
