import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Activity, BarChart3, Bell, Bot, CheckCircle2, Cpu, GitBranch, HardDrive, LayoutDashboard, LogOut, Network, PanelLeft,
  Scale, Search, Shield, Wallet, Waves, Database, Building2, Users, Globe, CheckSquare, Radio, Menu, ClipboardCheck, Layers, Trophy, BadgeCheck, BookOpen, FileText, ClipboardList,
  FileCode2, BrainCircuit, PackageCheck, FolderTree, UserRound, GitMerge, ArrowLeftRight, Wrench, Gavel, Settings, Zap,
  HandMetal, AlertTriangle, UserCheck, ClipboardType, ScrollText, Timer, FileBarChart, Landmark, FileKey, Cookie, Fingerprint, Baby, GraduationCap, Download, Gauge, FileLock2, ShieldCheck,
  BarChart2, UserPlus, Vault, Award, ClipboardSignature, Receipt, TrendingUp, CreditCard, RefreshCw,
  MessageSquare, Wand2, TrendingUp as TrendUp, Webhook, SearchCode, FileCheck2, Code2,
  Banknote, ScanFace, ShieldAlert, AlertOctagon, FileSpreadsheet, Building, FileWarning, Shuffle,
  Heart, Zap as ZapIcon, HeartPulse, FlaskConical, AlertCircle, Clock, UserCog, MonitorDot,
  Calculator, CalendarDays, HeartHandshake, Mail, Brain,
  Workflow, Share2, FileSearch, Eye, Microscope,
  MapPin, ArrowRightLeft, Star, Ship, Plane, Skull, Flame
} from "lucide-react";
import { useRbac, getRoleBadgeColor, getRoleLabel } from "@/hooks/useRbac";
import { CSSProperties, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { CriticalEventBanner } from './CriticalEventBanner';
import { FloatingChatBubble } from './FloatingChatBubble';
import { OnboardingBanner } from './OnboardingBanner';
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { LanguageSelector } from "./LanguageSelector";
import ThemeToggle from "@/components/ThemeToggle";
import { WhatsNewModal } from "@/components/WhatsNewModal";
import GlobalSearchWidget from "@/components/GlobalSearch";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PageTransition } from "@/components/PageTransition";

// ── Grouped sidebar menu ──────────────────────────────────────────────────────
type MenuItem = { icon: any; label: string; path: string };
type MenuSection = { title: string; color: string; items: MenuItem[] };

const menuSections: MenuSection[] = [
  {
    title: "Core Platform",
    color: "oklch(0.55 0.22 250)",
    items: [
      { icon: LayoutDashboard, label: "Gov Dashboard", path: "/" },
      { icon: Search, label: "Discovery Engine", path: "/discovery" },
      { icon: Database, label: "Data Catalog", path: "/catalog" },
      { icon: Scale, label: "Compliance Engine", path: "/compliance" },
      { icon: Shield, label: "SIEM & Audit", path: "/siem" },
      { icon: Network, label: "Network DPI", path: "/network" },
      { icon: Radio, label: "Network Intelligence", path: "/network-intelligence" },
      { icon: Activity, label: "NOC Dashboard", path: "/noc" },
      { icon: Shield, label: "Threat Intelligence", path: "/threat-intelligence" },
      { icon: Skull, label: "SOCint CTI Hub", path: "/socint" },
      { icon: Ship, label: "Maritime Intel", path: "/phantom-tide" },
      { icon: ShieldAlert, label: "Wazuh SIEM", path: "/wazuh" },
      { icon: Plane, label: "SIGINT Correlation", path: "/sigint" },
      { icon: Brain, label: "Estorides Graph", path: "/estorides" },
      { icon: Bot, label: "AI NOC Agent", path: "/noc-agent" },
      { icon: GitBranch, label: "BGP Routes", path: "/bgp" },
      { icon: HardDrive, label: "Arkime PCAP", path: "/pcap" },
      { icon: Shield, label: "Platform Intelligence", path: "/platform-intelligence" },
      { icon: Globe, label: "Digital Twin", path: "/digital-twin" },
    ],
  },
  {
    title: "Enforcement & Finance",
    color: "oklch(0.58 0.24 25)",
    items: [
      { icon: Gavel, label: "Enforcement Cases", path: "/enforcement-cases" },
      { icon: Wallet, label: "Financial Enforcement", path: "/financial" },
      { icon: Calculator, label: "Penalty Calculator", path: "/penalty-calculator" },
      { icon: Shield, label: "Risk Scorecard", path: "/risk-scorecard" },
      { icon: Gavel, label: "Enforcement Timeline", path: "/enforcement-timeline" },
      { icon: Banknote, label: "NDPA Fines", path: "/ndpa-fines" },
    ],
  },
  {
    title: "Compliance Management",
    color: "oklch(0.62 0.18 210)",
    items: [
      { icon: HandMetal, label: "Consent Management", path: "/consent" },
      { icon: AlertTriangle, label: "Breach Notification", path: "/breach-notification" },
      { icon: UserCheck, label: "DPO Registry", path: "/dpo-registry" },
      { icon: ShieldCheck, label: "DPO Workbench", path: "/dpo-dashboard" },
      { icon: ClipboardType, label: "DPIA", path: "/dpia" },
      { icon: ScrollText, label: "ROPA Records", path: "/ropa" },
      { icon: Timer, label: "Retention Policies", path: "/retention" },
      { icon: FileBarChart, label: "DPO Reports", path: "/dpo-reports" },
      { icon: Landmark, label: "Audit Returns", path: "/car" },
      { icon: Globe, label: "Adequacy Registry", path: "/adequacy" },
      { icon: FileKey, label: "Privacy Notices", path: "/privacy-notices" },
      { icon: Cookie, label: "Cookie Consent", path: "/cookie-consent" },
      { icon: Fingerprint, label: "Automated Decisions", path: "/automated-decisions" },
      { icon: Baby, label: "Parental Consent", path: "/parental-consent" },
      { icon: GraduationCap, label: "Staff Training", path: "/staff-training" },
      { icon: ArrowLeftRight, label: "Transfer Instruments", path: "/transfer-instruments" },
      { icon: Download, label: "Data Export", path: "/data-export" },
      { icon: FileLock2, label: "Data Processing Agrmts", path: "/dpa" },
      { icon: Gauge, label: "DCPMI Thresholds", path: "/dcpmi" },
      { icon: CalendarDays, label: "Compliance Calendar", path: "/compliance-calendar" },
      { icon: Trophy, label: "Compliance Leaderboard", path: "/leaderboard" },
      { icon: TrendUp, label: "Compliance Trends", path: "/trends" },
    ],
  },
  {
    title: "DPCO Portal",
    color: "oklch(0.58 0.20 290)",
    items: [
      { icon: Award, label: "DPCO Portal", path: "/dpco" },
      { icon: ClipboardSignature, label: "DPCO Registry", path: "/dpco/registry" },
      { icon: Users, label: "DPCO Clients", path: "/dpco/clients" },
      { icon: ShieldCheck, label: "Verification Stmts", path: "/dpco/verification" },
      { icon: ClipboardCheck, label: "Audit Workspace", path: "/dpco/audit" },
      { icon: BarChart2, label: "DPCO Scorecard", path: "/dpco/scorecard" },
      { icon: UserPlus, label: "DPCO Onboarding", path: "/dpco/onboard" },
      { icon: Vault, label: "Evidence Vault", path: "/dpco/evidence" },
      { icon: Receipt, label: "Billing & Earnings", path: "/dpco/billing" },
      { icon: CreditCard, label: "Subscription Plan", path: "/dpco/subscription" },
      { icon: RefreshCw, label: "Licence Renewal", path: "/dpco/renewal" },
      { icon: BrainCircuit, label: "AI Audit Tools", path: "/dpco/ai-tools" },
    ],
  },
  {
    title: "Organizations & IAM",
    color: "oklch(0.60 0.20 160)",
    items: [
      { icon: Building2, label: "Organizations", path: "/organizations" },
      { icon: Users, label: "Role Management", path: "/roles" },
      { icon: Globe, label: "Org Portal", path: "/portal" },
      { icon: ClipboardCheck, label: "Portal Review", path: "/portal-review" },
      { icon: Building2, label: "My Organization", path: "/my-org" },
      { icon: UserRound, label: "Citizen Rights", path: "/citizen-rights" },
      { icon: FolderTree, label: "Sector Management", path: "/sectors" },
    ],
  },
  {
    title: "AI & Intelligence",
    color: "oklch(0.62 0.18 290)",
    items: [
      { icon: Bot, label: "AI Advisor", path: "/ai-assistant" },
      { icon: BrainCircuit, label: "AI Governance", path: "/ai-governance" },
      { icon: BrainCircuit, label: "AI/ML Hub", path: "/ai/hub" },
      { icon: Layers, label: "Model Registry", path: "/ai/model-registry" },
      { icon: ShieldAlert, label: "ART Robustness", path: "/ai/art-dashboard" },
      { icon: HardDrive, label: "Feature Store", path: "/ai/feature-store" },
      { icon: Network, label: "Knowledge Graph", path: "/ai/knowledge-graph" },
      { icon: Brain, label: "RAG Advisor", path: "/ai/rag-advisor" },
      { icon: BrainCircuit, label: "AI Risk Engine", path: "/ai-risk-engine" },
      { icon: Brain, label: "AI Ethics Board", path: "/ai-ethics" },
      { icon: BrainCircuit, label: "AI Gov. Scoring", path: "/ai-governance-scoring" },
    ],
  },
  {
    title: "Operations & Infrastructure",
    color: "oklch(0.72 0.18 80)",
    items: [
      { icon: Waves, label: "Streaming Events", path: "/streaming" },
      { icon: Zap, label: "Event Bus Monitor", path: "/event-bus" },
      { icon: Database, label: "Ledger Explorer", path: "/ledger" },
      { icon: Cpu, label: "Worker Processes", path: "/workers" },
      { icon: Activity, label: "Temporal Workflows", path: "/temporal" },
      { icon: BarChart3, label: "Prometheus Metrics", path: "/metrics" },
      { icon: HeartPulse, label: "Middleware Health", path: "/middleware-health" },
      { icon: ShieldAlert, label: "Security Dashboard", path: "/security-dashboard" },
      { icon: Radio, label: "Continuous Monitoring", path: "/monitoring" },
      { icon: Layers, label: "Orchestration Layer", path: "/orchestration" },
      { icon: MonitorDot, label: "System Health", path: "/admin/system-health" },
      { icon: Activity, label: "Platform Stats", path: "/platform-stats" },
    ],
  },
  {
    title: "Banking & Sectors",
    color: "oklch(0.55 0.18 230)",
    items: [
      { icon: Banknote, label: "Banking Overview", path: "/banking" },
      { icon: ScanFace, label: "KYC Management", path: "/banking/kyc" },
      { icon: ShieldAlert, label: "AML Cases", path: "/banking/aml" },
      { icon: AlertOctagon, label: "Watchlist Screening", path: "/banking/watchlist" },
      { icon: Shuffle, label: "Payments Monitor", path: "/banking/payments" },
      { icon: Globe, label: "SWIFT Transactions", path: "/banking/swift" },
      { icon: FileWarning, label: "Fraud Alerts", path: "/banking/fraud" },
      { icon: Fingerprint, label: "Liveness Verification", path: "/banking/liveness" },
      { icon: FileSpreadsheet, label: "CBN Reports", path: "/banking/cbn-reports" },
      { icon: Building, label: "Correspondent Banks", path: "/banking/correspondents" },
      { icon: Radio, label: "Telecom (NCC)", path: "/telecom" },
      { icon: Heart, label: "Healthcare (NHIA)", path: "/healthcare" },
      { icon: ZapIcon, label: "Energy (NERC/NUPRC)", path: "/energy" },
      { icon: Shield, label: "Insurance (NAICOM)", path: "/insurance" },
      { icon: CreditCard, label: "Fintech (CBN)", path: "/fintech" },
      { icon: BarChart3, label: "Sector Benchmark", path: "/sector-benchmark" },
      { icon: Activity, label: "Sector Compliance", path: "/sector-compliance" },
    ],
  },
  {
    title: "Governance & Reporting",
    color: "oklch(0.55 0.04 250)",
    items: [
      { icon: CheckSquare, label: "Transfer Approvals", path: "/transfers" },
      { icon: BadgeCheck, label: "Verify Certificate", path: "/verify" },
      { icon: BookOpen, label: "API Documentation", path: "/api-docs" },
      { icon: FileText, label: "Regulatory Reports", path: "/reports" },
      { icon: Search, label: "Status Tracker", path: "/status" },
      { icon: ClipboardList, label: "Audit Log", path: "/audit-log" },
      { icon: FileCode2, label: "Policy Templates", path: "/policy-templates" },
      { icon: PackageCheck, label: "Evidence Packages", path: "/evidence" },
      { icon: Layers, label: "Framework Dashboard", path: "/frameworks" },
      { icon: GitMerge, label: "GitOps Config", path: "/gitops" },
      { icon: ArrowLeftRight, label: "Data Flow Map", path: "/data-flows" },
      { icon: Globe, label: "TIA Assessments", path: "/tia" },
      { icon: Wrench, label: "Remediation", path: "/remediation" },
      { icon: Network, label: "Asset Graph", path: "/asset-graph" },
    ],
  },
  {
    title: "Advanced Features",
    color: "oklch(0.65 0.18 60)",
    items: [
      { icon: MessageSquare, label: "DSAR Portal", path: "/dsar" },
      { icon: Wand2, label: "DPIA Wizard", path: "/dpia-wizard" },
      { icon: Webhook, label: "Webhook Management", path: "/webhooks" },
      { icon: SearchCode, label: "Global Search", path: "/search" },
      { icon: FileCheck2, label: "CAR Automation", path: "/car-automation" },
      { icon: Code2, label: "Developer Portal", path: "/developer" },
      { icon: Workflow, label: "Data Pipeline", path: "/data-pipeline" },
      { icon: GitBranch, label: "Data Lineage", path: "/data-lineage" },
      { icon: Globe, label: "Regulatory Intel", path: "/regulatory-intelligence" },
      { icon: AlertTriangle, label: "Incident Response", path: "/incident-response" },
      { icon: Microscope, label: "Compliance Gap", path: "/compliance-gap" },
      { icon: ShieldAlert, label: "Vendor Risk", path: "/vendor-risk" },
      { icon: Eye, label: "Whistleblower", path: "/whistleblower" },
      { icon: Landmark, label: "Reg Sandbox", path: "/regulatory-sandbox" },
      { icon: Fingerprint, label: "National ID Verify", path: "/national-id" },
      { icon: Share2, label: "Cross-Agency Sharing", path: "/cross-agency" },
      { icon: Shuffle, label: "Cross-Sector Sharing", path: "/cross-sector-sharing" },
      { icon: AlertCircle, label: "Cross-Sector Alerts", path: "/cross-sector-alerts" },
      { icon: Vault, label: "Document Vault", path: "/document-vault" },
    ],
  },
  {
    title: "Admin & Settings",
    color: "oklch(0.55 0.24 25)",
    items: [
      { icon: TrendingUp, label: "Platform Revenue", path: "/admin/revenue" },
      { icon: ClipboardList, label: "DPCO Registrations", path: "/admin/registrations" },
      { icon: ShieldCheck, label: "DPCO Accreditation", path: "/admin/accreditation" },
      { icon: Settings, label: "Platform Settings", path: "/admin/settings" },
      { icon: UserCog, label: "User Management", path: "/admin/users" },
      { icon: Settings, label: "Notification Settings", path: "/settings/notifications" },
      { icon: Bell, label: "Alerting Settings", path: "/settings/alerting" },
      { icon: ShieldCheck, label: "Cert Rotation", path: "/settings/cert-rotation" },
      { icon: Mail, label: "Email Digest Settings", path: "/email-digest" },
      { icon: Wand2, label: "Changelog Admin", path: "/admin/changelog" },
      { icon: Clock, label: "SLA Timers", path: "/sla-timers" },
    ],
  },
];

// Flat menuItems for backward compat (route matching, etc.)
const menuItems = menuSections.flatMap(s => s.items);

// ── Favorites & Recents persistence ──────────────────────────────────────────
const FAVORITES_KEY = "ndsep_nav_favorites";
const RECENTS_KEY = "ndsep_nav_recents";
const MAX_RECENTS = 8;

function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); } catch { return []; }
  });
  const toggle = useCallback((path: string) => {
    setFavorites(prev => {
      const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { favorites, toggle };
}

function useRecents(currentPath: string) {
  const [recents, setRecents] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); } catch { return []; }
  });
  useEffect(() => {
    if (!currentPath || currentPath === "/") return;
    setRecents(prev => {
      const next = [currentPath, ...prev.filter(p => p !== currentPath)].slice(0, MAX_RECENTS);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  }, [currentPath]);
  return recents;
}

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

function RoleBadgeFooter({ user }: { user: any }) {
  const rbac = useRbac();
  return (
    <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
      <p className="text-sm font-medium truncate leading-none">
        {user?.name || "-"}
      </p>
      <div className="flex items-center gap-1.5 mt-1.5">
        <span
          className="mono text-[9px] font-semibold px-1.5 py-0.5 rounded-sm"
          style={{
            background: getRoleBadgeColor(rbac.role) + "20",
            color: getRoleBadgeColor(rbac.role),
            border: `1px solid ${getRoleBadgeColor(rbac.role)}40`,
          }}
        >
          {getRoleLabel(rbac.role)}
        </span>
      </div>
    </div>
  );
}

function NotificationsHeader({ isMobile, activeMenuLabel }: { isMobile: boolean; activeMenuLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"platform" | "security">("platform");
  const [acknowledging, setAcknowledging] = useState<Set<number>>(new Set());
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();

  // SIEM security alerts
  const { data: alertsData, refetch: refetchAlerts } = trpc.siem.alerts.useQuery(
    { limit: 20, resolved: false },
    { refetchInterval: 30000 }
  );
  const alerts = (alertsData as any[]) ?? [];

  // Platform in-app notifications
  const { data: notifData, refetch: refetchNotifs } = trpc.notifications.list.useQuery(
    { limit: 20, onlyUnread: false },
    { refetchInterval: 30000 }
  );
  const { data: unreadCountData } = trpc.notifications.unreadCount.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );
  const notifs = (notifData as any[]) ?? [];
  const platformUnread = (unreadCountData as any)?.count ?? 0;
  const totalBadge = alerts.length + platformUnread;

  const resolveMutation = trpc.siem.resolveAlert.useMutation({
    onSuccess: () => { refetchAlerts(); utils.siem.alerts.invalidate(); },
  });
  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => { refetchNotifs(); utils.notifications.list.invalidate(); utils.notifications.unreadCount.invalidate(); },
  });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => { refetchNotifs(); utils.notifications.list.invalidate(); utils.notifications.unreadCount.invalidate(); },
  });

  const handleAcknowledge = useCallback((e: React.MouseEvent, alertId: number) => {
    e.stopPropagation();
    e.preventDefault();
    setAcknowledging(prev => new Set(prev).add(alertId));
    resolveMutation.mutate({ alertId }, {
      onSettled: () => setAcknowledging(prev => { const s = new Set(prev); s.delete(alertId); return s; }),
    });
  }, [resolveMutation]);

  const severityStyle = (sev: string) =>
    sev === "critical" ? "bg-red-500/20 text-red-400" :
    sev === "warning"  ? "bg-orange-500/20 text-orange-400" :
    sev === "info"     ? "bg-blue-500/20 text-blue-400" :
                         "bg-muted text-muted-foreground";

  return (
    <div className="flex h-14 items-center justify-between px-4 sticky top-0 z-40 transition-colors header-bar">
      <div className="flex items-center gap-2 shrink-0">
        {isMobile && <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />}
        <span className="tracking-tight text-foreground font-medium hidden sm:block">
          {activeMenuLabel ?? "NDSEP"}
        </span>
      </div>
      {/* ─── Global Search — Ctrl+K ────────────────────────────────────────── */}
      <div className="flex-1 max-w-sm mx-4 hidden md:block">
        <GlobalSearchWidget />
      </div>
      <div className="flex items-center gap-1">
        <LanguageSelector />
        <ThemeToggle variant="dropdown" />
        <div className="relative">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4 text-muted-foreground" />
              {totalBadge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                  {totalBadge > 99 ? "99+" : totalBadge}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96 p-0">
            {/* Tab bar */}
            <div className="flex border-b">
              <button
                className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === "platform" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("platform")}
              >
                Platform {platformUnread > 0 && <span className="ml-1 bg-primary/20 text-primary text-[9px] px-1 rounded">{platformUnread}</span>}
              </button>
              <button
                className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === "security" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("security")}
              >
                Security {alerts.length > 0 && <span className="ml-1 bg-destructive/20 text-destructive text-[9px] px-1 rounded">{alerts.length}</span>}
              </button>
            </div>

            {/* Platform notifications tab */}
            {activeTab === "platform" && (
              <div className="max-h-80 overflow-y-auto">
                <div className="px-3 py-1.5 border-b flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">{notifs.length} notifications</p>
                  {platformUnread > 0 && (
                    <button
                      className="text-[10px] text-primary hover:underline"
                      onClick={(e) => { e.stopPropagation(); markAllReadMutation.mutate(); }}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                {notifs.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">No notifications</div>
                ) : (
                  notifs.slice(0, 15).map((n: any) => (
                    <div
                      key={n.id}
                      className={`flex items-start gap-2 px-3 py-2 border-b border-border/30 last:border-0 cursor-pointer hover:bg-accent/50 ${
                        !n.read_at ? "bg-primary/5" : ""
                      }`}
                      onClick={() => {
                        if (!n.read_at) markReadMutation.mutate({ id: n.id });
                        if (n.action_url) { setOpen(false); setLocation(n.action_url); }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase shrink-0 ${severityStyle(n.severity)}`}>
                            {n.severity ?? "info"}
                          </span>
                          <span className="text-xs font-medium truncate">{n.title}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2">{n.message}</p>
                        <span className="text-[9px] text-muted-foreground/60 mt-0.5 block">
                          {n.created_at ? new Date(n.created_at).toLocaleString() : ""}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Security alerts tab */}
            {activeTab === "security" && (
              <div className="max-h-80 overflow-y-auto">
                <div className="px-3 py-1.5 border-b flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">{alerts.length} unresolved</p>
                  {alerts.length > 0 && (
                    <button
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); alerts.slice(0, 10).forEach((a: any) => resolveMutation.mutate({ alertId: a.id })); }}
                    >
                      Dismiss all
                    </button>
                  )}
                </div>
                {alerts.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">No unresolved alerts</div>
                ) : (
                  alerts.slice(0, 10).map((alert: any) => (
                    <div
                      key={alert.id}
                      className="flex items-start gap-2 px-3 py-2 hover:bg-accent/50 cursor-pointer border-b border-border/30 last:border-0"
                      onClick={() => { setOpen(false); setLocation("/siem"); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase shrink-0 ${
                            alert.severity === "critical" ? "bg-red-500/20 text-red-400" :
                            alert.severity === "high" ? "bg-orange-500/20 text-orange-400" :
                            alert.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-blue-500/20 text-blue-400"
                          }`}>
                            {alert.severity}
                          </span>
                          <span className="text-xs font-medium truncate">{alert.title}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground truncate block mt-0.5">{alert.source}</span>
                      </div>
                      <button
                        className="shrink-0 h-6 w-6 flex items-center justify-center rounded hover:bg-emerald-500/20 text-muted-foreground hover:text-emerald-400 transition-colors"
                        title="Acknowledge alert"
                        disabled={acknowledging.has(alert.id)}
                        onClick={(e) => handleAcknowledge(e, alert.id)}
                      >
                        {acknowledging.has(alert.id) ? <span className="text-[8px]">...</span> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ))
                )}
                {alerts.length > 10 && (
                  <div
                    className="text-xs text-center text-primary cursor-pointer px-3 py-2 hover:bg-accent/50"
                    onClick={() => { setOpen(false); setLocation("/siem"); }}
                  >
                    View all {alerts.length} alerts
                  </div>
                )}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen relative overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(0.10 0.04 265), oklch(0.08 0.03 250), oklch(0.10 0.03 290))' }}>
        {/* Animated gradient orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl animate-float" style={{ background: 'radial-gradient(circle, oklch(0.55 0.22 250 / 0.4), transparent 70%)' }} />
          <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full opacity-15 blur-3xl" style={{ background: 'radial-gradient(circle, oklch(0.58 0.20 290 / 0.35), transparent 70%)', animation: 'float 4s ease-in-out infinite reverse' }} />
          <div className="absolute top-1/2 right-1/3 w-64 h-64 rounded-full opacity-10 blur-3xl" style={{ background: 'radial-gradient(circle, oklch(0.60 0.20 160 / 0.3), transparent 70%)', animation: 'float 5s ease-in-out infinite 1s' }} />
        </div>
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full relative z-10">
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, oklch(0.55 0.22 250), oklch(0.58 0.20 290))' }}>
                <Shield className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-white tracking-tight heading-display">NDSEP</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-center text-white heading-display">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
              Access to this dashboard requires authentication. Sign in with your Manus account or preview the DPCO portal in demo mode.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full glass-card p-6" style={{ background: 'oklch(0.15 0.02 265 / 0.5)' }}>
            <Button
              onClick={() => { window.location.href = getLoginUrl(); }}
              size="lg"
              className="w-full text-white shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-[1.01]"
              style={{ background: 'linear-gradient(135deg, oklch(0.55 0.22 250), oklch(0.58 0.20 290))' }}
            >
              Sign in with Manus
            </Button>
            <div className="relative flex items-center gap-2 my-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                const returnTo = window.location.pathname + window.location.search;
                window.location.href = `/api/demo-login?returnTo=${encodeURIComponent(returnTo)}`;
              }}
              className="w-full border-border text-muted-foreground hover:bg-muted hover:text-white transition-all duration-200"
            >
              Preview as Demo DPCO
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                window.location.href = `/api/demo-login?role=admin`;
              }}
              className="w-full border-primary/40 text-primary hover:bg-primary/10 transition-all duration-200"
            >
              Preview as NDPC Admin
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-1 leading-relaxed">
              Demo mode uses sample accounts — no real credentials required. DPCO: DataGuard Ltd &middot; Admin: NDPC Staff.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

// No longer needed — sidebar uses grouped sections now

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = (title: string) => setCollapsedSections(prev => {
    const next = new Set(prev);
    next.has(title) ? next.delete(title) : next.add(title);
    return next;
  });
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();
  const { data: openCasesData } = trpc.enforcementCases.openCount.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const openCaseCount = openCasesData?.count ?? 0;

  // ── Sidebar search ──
  const [navSearch, setNavSearch] = useState("");
  const navSearchRef = useRef<HTMLInputElement>(null);
  const filteredSections = useMemo(() => {
    if (!navSearch.trim()) return menuSections;
    const q = navSearch.toLowerCase();
    return menuSections.map(s => ({
      ...s,
      items: s.items.filter(i => i.label.toLowerCase().includes(q)),
    })).filter(s => s.items.length > 0);
  }, [navSearch]);

  // ── Favorites & Recents ──
  const { favorites, toggle: toggleFavorite } = useFavorites();
  const recents = useRecents(location);
  const favoriteItems = useMemo(() => menuItems.filter(i => favorites.includes(i.path)), [favorites]);
  const recentItems = useMemo(() => recents.map(p => menuItems.find(i => i.path === p)).filter(Boolean) as MenuItem[], [recents]);

  // ── Badge counts ──
  const { data: dsarCountData } = trpc.dsar.pendingCount.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const dsarCount = (dsarCountData as any)?.count ?? 0;
  const { data: breachCountData } = trpc.breaches.activeCount.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const breachCount = (breachCountData as any)?.count ?? 0;
  const { data: transferCountData } = trpc.transfers.pendingCount.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const transferCount = (transferCountData as any)?.count ?? 0;

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center sidebar-brand">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-primary" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="heading-display text-sm tracking-tight truncate gradient-text">NDSEP</span>
                    <span className="mono text-[8px] text-muted-foreground tracking-[0.15em] uppercase truncate">Data Sovereignty</span>
                  </div>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            {/* ── Sidebar Search ── */}
            {!isCollapsed && (
              <div className="px-3 pt-2 pb-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={navSearchRef}
                    value={navSearch}
                    onChange={e => setNavSearch(e.target.value)}
                    placeholder="Filter pages..."
                    className="h-8 pl-8 pr-8 text-xs bg-sidebar-accent/40 border-sidebar-border"
                    aria-label="Filter navigation items"
                  />
                  {navSearch && (
                    <button
                      onClick={() => setNavSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded-sm hover:bg-accent"
                      aria-label="Clear search"
                    >
                      <span className="text-xs text-muted-foreground">&times;</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Favorites Section ── */}
            {!isCollapsed && favoriteItems.length > 0 && !navSearch && (
              <div className="px-2 pt-1 pb-1">
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                  <span className="mono text-[10px] font-semibold uppercase tracking-wider text-amber-400">Pinned</span>
                  <span className="mono text-[9px] text-muted-foreground">{favoriteItems.length}</span>
                </div>
                {favoriteItems.map(item => {
                  const isActive = location === item.path;
                  return (
                    <SidebarMenuItem key={`fav-${item.path}`}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setLocation(item.path)}
                        tooltip={item.label}
                        className={`h-8 transition-all duration-200 font-normal rounded-lg ${isActive ? "sidebar-item-active shadow-sm font-medium" : "hover:translate-x-0.5 hover:bg-accent/40"}`}
                      >
                        <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                        <span className="flex-1 truncate text-sm">{item.label}</span>
                        <Star className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </div>
            )}

            {/* ── Recently Visited ── */}
            {!isCollapsed && recentItems.length > 0 && !navSearch && (
              <div className="px-2 pt-1 pb-1">
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="mono text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Recent</span>
                  <span className="mono text-[9px] text-muted-foreground">{recentItems.length}</span>
                </div>
                {recentItems.slice(0, 5).map(item => {
                  const isActive = location === item.path;
                  return (
                    <SidebarMenuItem key={`recent-${item.path}`}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setLocation(item.path)}
                        tooltip={item.label}
                        className={`h-8 transition-all duration-200 font-normal rounded-lg ${isActive ? "sidebar-item-active shadow-sm font-medium" : "hover:translate-x-0.5 hover:bg-accent/40"}`}
                      >
                        <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                        <span className="flex-1 truncate text-sm">{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </div>
            )}

            <SidebarMenu className="px-2 py-1" role="navigation" aria-label="Main navigation">
              {filteredSections.map(section => {
                const isSectionCollapsed = collapsedSections.has(section.title);
                const hasActiveItem = section.items.some(item => item.path === location);
                return (
                  <div key={section.title} className="mb-1">
                    {!isCollapsed && (
                      <button
                        onClick={() => toggleSection(section.title)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-left group/header hover:bg-accent/30 rounded-md transition-colors"
                        aria-expanded={!isSectionCollapsed}
                        aria-controls={`section-${section.title.replace(/\s+/g, '-').toLowerCase()}`}
                        aria-label={`${section.title} section, ${section.items.length} items`}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ background: section.color }}
                        />
                        <span className="mono text-[10px] font-semibold uppercase tracking-wider flex-1" style={{ color: section.color }}>
                          {section.title}
                        </span>
                        <span className="mono text-[9px] text-muted-foreground">{section.items.length}</span>
                        <svg className={`h-3 w-3 text-muted-foreground transition-transform ${isSectionCollapsed ? "-rotate-90" : ""}`} viewBox="0 0 12 12"><path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    )}
                    {(!isSectionCollapsed || isCollapsed) && section.items.map(item => {
                      const isActive = location === item.path;
                      return (
                        <SidebarMenuItem key={item.path} className="group/item">
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => setLocation(item.path)}
                            tooltip={item.label}
                            className={`h-8 transition-all duration-200 font-normal rounded-lg ${isActive ? "sidebar-item-active shadow-sm font-medium" : "hover:translate-x-0.5 hover:bg-accent/40"}`}
                            aria-label={item.label}
                            aria-current={isActive ? "page" : undefined}
                            role="link"
                            data-tour={
                              item.path === "/dpco/billing" ? "dpco-nav-billing" :
                              item.path === "/dpco/audit" ? "dpco-nav-audit" :
                              item.path === "/dpco/subscription" ? "dpco-nav-subscription" :
                              undefined
                            }
                          >
                            <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                            <span className="flex-1 truncate text-sm">{item.label}</span>
                            {item.path === "/enforcement-cases" && openCaseCount > 0 && (
                              <span className="mono text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white group-data-[collapsible=icon]:hidden">{openCaseCount}</span>
                            )}
                            {item.path === "/dsar" && dsarCount > 0 && (
                              <span className="mono text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white group-data-[collapsible=icon]:hidden">{dsarCount}</span>
                            )}
                            {item.path === "/breach-notification" && breachCount > 0 && (
                              <span className="mono text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500 text-white group-data-[collapsible=icon]:hidden">{breachCount}</span>
                            )}
                            {item.path === "/transfers" && transferCount > 0 && (
                              <span className="mono text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500 text-white group-data-[collapsible=icon]:hidden">{transferCount}</span>
                            )}
                            {!isCollapsed && (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleFavorite(item.path); }}
                                className={`h-4 w-4 flex items-center justify-center rounded-sm opacity-0 group-hover/item:opacity-100 transition-opacity ${favorites.includes(item.path) ? "opacity-100" : ""}`}
                                aria-label={favorites.includes(item.path) ? `Unpin ${item.label}` : `Pin ${item.label}`}
                              >
                                <Star className={`h-3 w-3 ${favorites.includes(item.path) ? "text-amber-400 fill-amber-400" : "text-muted-foreground hover:text-amber-400"}`} />
                              </button>
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </div>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <RoleBadgeFooter user={user} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="flex flex-col h-screen overflow-hidden">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">Skip to content</a>
        <NotificationsHeader isMobile={isMobile} activeMenuLabel={activeMenuItem?.label} />
        {user?.openId === "demo-dpco-user-001" && <DemoModeBanner role="dpco" />}
        {user?.openId === "demo-admin-user-001" && <DemoModeBanner role="admin" />}
        <CriticalEventBanner />
        <OnboardingBanner />
        <FloatingChatBubble />
        <WhatsNewModal />
        <PwaInstallPrompt />
        <main id="main-content" role="main" className="flex-1 min-h-0 overflow-hidden gradient-mesh">
          <div className="relative z-10 h-full">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </SidebarInset>
    </>
  );
}
