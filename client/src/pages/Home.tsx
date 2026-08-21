import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Shield, Globe, BarChart3, Lock, ChevronRight, Loader2, Play, RefreshCw, Building2, TrendingUp } from "lucide-react";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();
  const { data: sectorStats } = trpc.publicRegistry.sectorStats.useQuery(undefined, { staleTime: 60_000 });
  const totalOrgs = Array.isArray(sectorStats) ? sectorStats.reduce((s: number, r: any) => s + parseInt(r.org_count ?? 0), 0) : 0;
  const avgScore = Array.isArray(sectorStats) && sectorStats.length > 0 ? Math.round(sectorStats.reduce((s: number, r: any) => s + parseFloat(r.avg_score ?? 0), 0) / sectorStats.length) : 0;
  const totalRegistered = Array.isArray(sectorStats) ? sectorStats.reduce((s: number, r: any) => s + parseInt(r.registered_count ?? 0), 0) : 0;

  useEffect(() => {
    if (!loading && isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, loading, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="font-bold text-sm tracking-wide">NDSEP</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">National Data Sovereignty Enforcement Platform</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => window.location.href = getLoginUrl()} className="bg-emerald-600 hover:bg-emerald-500 text-foreground text-sm">
            Sign In <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          <Button variant="outline" onClick={() => {
            const realm = "ndsep";
            const clientId = "ndsep-app";
            const base = (import.meta as any).env?.VITE_KEYCLOAK_URL ?? "http://localhost:8080";
            const redirect = encodeURIComponent(window.location.origin + "/");
            window.location.href = `${base}/realms/${realm}/protocol/openid-connect/auth?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=openid+profile+email`;
          }} className="border-border text-muted-foreground hover:bg-card text-sm">
            SSO
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 text-xs text-emerald-400 mb-8 uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live National Surveillance
        </div>
        <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight max-w-4xl">
          Nigeria's National<br />
          <span className="text-emerald-400">Data Sovereignty</span><br />
          Enforcement Platform
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mb-10 leading-relaxed">
          Real-time compliance monitoring, cross-border data flow enforcement, and automated regulatory action under NDPR, GDPR, ISO 27001, and SOC 2.
        </p>
        <div className="flex gap-4 flex-wrap justify-center">
          <Button size="lg" onClick={() => window.location.href = getLoginUrl()} className="bg-emerald-600 hover:bg-emerald-500 text-foreground px-8">
            Access Platform <ChevronRight className="w-5 h-5 ml-1" />
          </Button>
          <Button size="lg" variant="outline" onClick={() => {
            const realm = "ndsep";
            const clientId = "ndsep-app";
            const base = (import.meta as any).env?.VITE_KEYCLOAK_URL ?? "http://localhost:8080";
            const redirect = encodeURIComponent(window.location.origin + "/");
            window.location.href = `${base}/realms/${realm}/protocol/openid-connect/auth?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=openid+profile+email`;
          }} className="border-border text-muted-foreground hover:bg-card px-8">
            Enterprise SSO (Keycloak)
          </Button>
          <Button size="lg" variant="outline" onClick={() => window.location.href = "/status"} className="border-border text-muted-foreground hover:bg-card px-8">
            Check Org Status
          </Button>
        </div>

        {/* ── Demo Access Panel ─────────────────────────────────────────────── */}
        <div className="mt-12 w-full max-w-2xl">
          <div className="border border-dashed border-border rounded-2xl p-6 bg-background/50">
            <div className="flex items-center gap-2 mb-4 justify-center">
              <Play className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-400 uppercase tracking-widest">Live Demo — No Login Required</span>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Explore the full platform with pre-loaded Nigerian data protection demo data. No account needed.
            </p>
            <div className="flex gap-3 flex-wrap justify-center">
              <Button
                size="sm"
                onClick={() => window.location.href = "/api/demo-login?role=admin&returnTo=/admin/revenue"}
                className="bg-blue-600 hover:bg-blue-500 text-foreground gap-2"
              >
                <Shield className="w-4 h-4" />
                Preview as NDPC Admin
              </Button>
              <Button
                size="sm"
                onClick={() => window.location.href = "/api/demo-login?returnTo=/dpco"}
                className="bg-purple-600 hover:bg-purple-500 text-foreground gap-2"
              >
                <Globe className="w-4 h-4" />
                Preview as DPCO Portal
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (confirm("Reset all demo data to factory defaults? This will clear any changes made during the demo.")) {
                    window.location.href = "/api/demo-reset?returnTo=/admin/revenue";
                  }
                }}
                className="border-border text-muted-foreground hover:bg-card gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reset Demo Data
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-4">
              Demo sessions use read-write access with pre-seeded Nigerian organisations, enforcement cases, and DPCO data.
            </p>
          </div>
        </div>

        {/* Live Stats Bar */}
        {totalOrgs > 0 && (
          <div className="flex gap-8 mt-12 flex-wrap justify-center">
            <div className="text-center">
              <div className="text-3xl font-bold text-emerald-400">{totalOrgs.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-center"><Building2 className="w-3 h-3" /> Organisations Monitored</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">{avgScore}%</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-center"><TrendingUp className="w-3 h-3" /> Avg Compliance Score</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-400">{totalRegistered.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">NDPC Registered</div>
            </div>
            {Array.isArray(sectorStats) && (
              <div className="text-center">
                <div className="text-3xl font-bold text-amber-400">{sectorStats.length}</div>
                <div className="text-xs text-muted-foreground mt-1">Sectors Covered</div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 max-w-4xl w-full text-left">
          {[
            { icon: Globe, title: "Cross-Border Enforcement", desc: "Real-time monitoring of 2,158+ cross-border data flows with automated blocking and NITDA reporting.", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
            { icon: BarChart3, title: "Multi-Framework Compliance", desc: "Simultaneous NDPR, GDPR, ISO 27001, and SOC 2 compliance scoring with article-level breakdowns.", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
            { icon: Lock, title: "Tamper-Evident Evidence", desc: "Rust-signed HMAC-SHA256 evidence packages with cryptographic verification for court submissions.", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
          ].map(({ icon: Icon, title, desc, color, bg }) => (
            <div key={title} className={`rounded-xl border p-5 ${bg}`}>
              <Icon className={`w-6 h-6 ${color} mb-3`} />
              <h3 className="font-semibold text-sm mb-2">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </main>
      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        NDSEP · National Information Technology Development Agency (NITDA) · Nigeria Data Protection Regulation
      </footer>
    </div>
  );
}
