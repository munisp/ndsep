import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Settings, GripVertical, Plus, Minus, Save, RotateCcw,
  AlertTriangle, CheckCircle, Clock, FileText, BarChart3,
  Shield, TrendingUp, Bell, Award, Activity, DollarSign, Building2,
  Zap, Globe, Lock
} from "lucide-react";
import { SparklineWidget } from "@/components/SparklineWidget";

// ── Widget definitions ────────────────────────────────────────────────────────
const WIDGET_CATALOG = [
  { id: "breach_count",      label: "Active Breaches",        icon: AlertTriangle,  color: "text-red-500",    category: "NDPA" },
  { id: "compliance_score",  label: "Compliance Score",       icon: CheckCircle,    color: "text-green-500",  category: "NDPA" },
  { id: "pending_dsar",      label: "Pending DSARs",          icon: FileText,       color: "text-blue-500",   category: "NDPA" },
  { id: "active_cases",      label: "Active Cases",           icon: Shield,         color: "text-orange-500", category: "Enforcement" },
  { id: "sector_breakdown",  label: "Sector Breakdown",       icon: BarChart3,      color: "text-purple-500", category: "Analytics" },
  { id: "risk_heatmap",      label: "Risk Heatmap",           icon: Activity,       color: "text-red-400",    category: "Analytics" },
  { id: "deadline_countdown",label: "Upcoming Deadlines",     icon: Clock,          color: "text-yellow-500", category: "NDPA" },
  { id: "recent_alerts",     label: "Recent Alerts",          icon: Bell,           color: "text-orange-400", category: "Alerts" },
  { id: "cert_status",       label: "Active Certificates",    icon: Award,          color: "text-green-400",  category: "DPCO" },
  { id: "nip_volume",        label: "NIP Transaction Volume", icon: TrendingUp,     color: "text-blue-400",   category: "Banking" },
  { id: "fine_total",        label: "Total Fines Collected",  icon: DollarSign,     color: "text-emerald-500",category: "Enforcement" },
  { id: "org_count",         label: "Registered Orgs",        icon: Building2,      color: "text-indigo-500", category: "Registry" },
] as const;

type WidgetId = typeof WIDGET_CATALOG[number]["id"];
type Theme = "default" | "dark" | "compact" | "wide";

// ── Individual Widget Renderer ────────────────────────────────────────────────
function Widget({ id, data, onRemove, editMode }: {
  id: WidgetId;
  data: Record<string, unknown>;
  onRemove: (id: WidgetId) => void;
  editMode: boolean;
}) {
  const def = WIDGET_CATALOG.find(w => w.id === id);
  if (!def) return null;
  const Icon = def.icon;

  const renderContent = () => {
    switch (id) {
      case "breach_count":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-red-500">{String(data.breach_count ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Require immediate attention</p>
            </div>
            <AlertTriangle className="h-12 w-12 text-red-200" />
          </div>
        );
      case "compliance_score":
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-green-500">{String(data.compliance_score ?? 0)}%</p>
                <p className="text-xs text-muted-foreground mt-1">30-day average</p>
              </div>
              <div className="w-16 h-16 rounded-full border-4 border-green-500 flex items-center justify-center">
                <span className="text-xs font-bold text-green-500">{String(data.compliance_score ?? 0)}</span>
              </div>
            </div>
            <SparklineWidget days={30} height={60} showLabel={false} />
            <a
              href="/trends"
              className="text-xs text-primary hover:underline underline-offset-2"
            >
              View full 90-day trend →
            </a>
          </div>
        );
      case "pending_dsar":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-blue-500">{String(data.pending_dsar ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Awaiting response (30-day limit)</p>
            </div>
            <FileText className="h-12 w-12 text-blue-200" />
          </div>
        );
      case "active_cases":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-orange-500">{String(data.active_cases ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Open enforcement cases</p>
            </div>
            <Shield className="h-12 w-12 text-orange-200" />
          </div>
        );
      case "sector_breakdown": {
        const sectors = (data.sector_breakdown as Array<{ sector: string; count: number }>) ?? [];
        return (
          <div className="space-y-1">
            {sectors.slice(0, 5).map(s => (
              <div key={s.sector} className="flex items-center justify-between text-sm">
                <span className="capitalize text-muted-foreground">{s.sector}</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, (s.count / (sectors[0]?.count || 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="font-medium w-6 text-right">{s.count}</span>
                </div>
              </div>
            ))}
          </div>
        );
      }
      case "risk_heatmap": {
        const heatmap = (data.risk_heatmap as Array<{ sector: string; score: number }>) ?? [];
        return (
          <div className="grid grid-cols-3 gap-1">
            {heatmap.map(h => (
              <div
                key={h.sector}
                className="rounded p-1 text-center text-xs"
                style={{ backgroundColor: h.score > 80 ? '#fee2e2' : h.score > 70 ? '#fef3c7' : '#dcfce7' }}
              >
                <div className="font-bold capitalize truncate" style={{ color: h.score > 80 ? '#dc2626' : h.score > 70 ? '#d97706' : '#16a34a' }}>
                  {h.sector.slice(0, 4)}
                </div>
                <div style={{ color: h.score > 80 ? '#dc2626' : h.score > 70 ? '#d97706' : '#16a34a' }}>{h.score}</div>
              </div>
            ))}
          </div>
        );
      }
      case "deadline_countdown":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-yellow-500">{String(data.deadline_countdown ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Breaches within 72-hour window</p>
            </div>
            <Clock className="h-12 w-12 text-yellow-200" />
          </div>
        );
      case "recent_alerts": {
        const alerts = (data.recent_alert_list as Array<{ id: number; title: string; severity: string }>) ?? [];
        return (
          <div className="space-y-1">
            {alerts.slice(0, 4).map(a => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <Badge variant={a.severity === 'critical' ? 'destructive' : a.severity === 'high' ? 'default' : 'secondary'} className="text-xs">
                  {a.severity}
                </Badge>
                <span className="truncate text-muted-foreground">{a.title}</span>
              </div>
            ))}
            {alerts.length === 0 && <p className="text-sm text-muted-foreground">No active alerts</p>}
          </div>
        );
      }
      case "cert_status":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-green-400">{String(data.cert_status ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">DPCO certificates active</p>
            </div>
            <Award className="h-12 w-12 text-green-200" />
          </div>
        );
      case "nip_volume":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-blue-400">{Number(data.nip_volume ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">NIP transactions today</p>
            </div>
            <Zap className="h-12 w-12 text-blue-200" />
          </div>
        );
      case "fine_total":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-emerald-500">₦{(Number(data.fine_total ?? 0) / 1_000_000).toFixed(1)}M</p>
              <p className="text-xs text-muted-foreground mt-1">Total fines collected</p>
            </div>
            <DollarSign className="h-12 w-12 text-emerald-200" />
          </div>
        );
      case "org_count":
        return (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-indigo-500">{String(data.org_count ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Registered organisations</p>
            </div>
            <Building2 className="h-12 w-12 text-indigo-200" />
          </div>
        );
      default:
        return <p className="text-muted-foreground text-sm">No data</p>;
    }
  };

  return (
    <Card className="relative group">
      {editMode && (
        <button
          onClick={() => onRemove(id)}
          className="absolute -top-2 -right-2 z-10 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        >
          ×
        </button>
      )}
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center gap-2">
          {editMode && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />}
          <Icon className={`h-4 w-4 ${def.color}`} />
          <CardTitle className="text-sm font-medium">{def.label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {renderContent()}
      </CardContent>
    </Card>
  );
}

// ── Widget Library Panel ──────────────────────────────────────────────────────
function WidgetLibrary({ enabled, onToggle }: {
  enabled: Set<WidgetId>;
  onToggle: (id: WidgetId) => void;
}) {
  const categories = Array.from(new Set(WIDGET_CATALOG.map(w => w.category)));
  return (
    <div className="space-y-4">
      {categories.map(cat => (
        <div key={cat}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{cat}</p>
          <div className="space-y-2">
            {WIDGET_CATALOG.filter(w => w.category === cat).map(w => {
              const Icon = w.icon;
              return (
                <div key={w.id} className="flex items-center justify-between p-2 rounded-lg border bg-card">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${w.color}`} />
                    <span className="text-sm">{w.label}</span>
                  </div>
                  <Switch
                    checked={enabled.has(w.id)}
                    onCheckedChange={() => onToggle(w.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CustomizableDashboard() {
  const [editMode, setEditMode] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [theme, setTheme] = useState<Theme>("default");
  const [enabledWidgets, setEnabledWidgets] = useState<Set<WidgetId>>(
    () => new Set<WidgetId>(["breach_count", "compliance_score", "pending_dsar", "active_cases", "sector_breakdown", "risk_heatmap"])
  );
  const [isDirty, setIsDirty] = useState(false);

  const { data: config } = trpc.widgetDashboard.getConfig.useQuery();
  const { data: widgetData, isLoading: dataLoading } = trpc.widgetDashboard.getWidgetData.useQuery();
  const saveConfig = trpc.widgetDashboard.saveConfig.useMutation({
    onSuccess: () => { toast.success("Dashboard saved"); setIsDirty(false); setEditMode(false); },
    onError: () => toast.error("Failed to save dashboard")
  });

  // Load saved config
  useEffect(() => {
    if (config?.widgets && config.widgets.length > 0) {
      setEnabledWidgets(new Set(config.widgets as WidgetId[]));
      setTheme((config.theme as Theme) ?? "default");
    }
  }, [config]);

  const handleToggleWidget = useCallback((id: WidgetId) => {
    setEnabledWidgets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setIsDirty(true);
  }, []);

  const handleRemoveWidget = useCallback((id: WidgetId) => {
    setEnabledWidgets(prev => { const next = new Set(prev); next.delete(id); return next; });
    setIsDirty(true);
  }, []);

  const handleSave = () => {
    saveConfig.mutate({ widgets: Array.from(enabledWidgets), theme });
  };

  const handleReset = () => {
    const defaults = new Set<WidgetId>(["breach_count" as WidgetId, "compliance_score" as WidgetId, "pending_dsar" as WidgetId, "active_cases" as WidgetId, "sector_breakdown" as WidgetId, "risk_heatmap" as WidgetId, "deadline_countdown" as WidgetId, "recent_alerts" as WidgetId]);
    setEnabledWidgets(defaults);
    setTheme("default");
    setIsDirty(true);
  };

  const orderedWidgets = WIDGET_CATALOG.filter(w => enabledWidgets.has(w.id as WidgetId)).map(w => w.id as WidgetId);
  const data = widgetData ?? {} as Record<string, unknown>;

  const gridCols = theme === "compact" ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4" :
                   theme === "wide"    ? "grid-cols-1 md:grid-cols-2" :
                                         "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Dashboard</h1>
            <p className="text-muted-foreground text-sm">Customise your compliance metrics view</p>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <Badge variant="outline" className="text-yellow-600 border-yellow-400">Unsaved changes</Badge>
            )}
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reset
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setShowLibrary(!showLibrary); setEditMode(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Widgets
            </Button>
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => setEditMode(!editMode)}
            >
              <Settings className="h-4 w-4 mr-1" /> {editMode ? "Done Editing" : "Edit Layout"}
            </Button>
            {isDirty && (
              <Button size="sm" onClick={handleSave} disabled={saveConfig.isPending}>
                <Save className="h-4 w-4 mr-1" /> Save Dashboard
              </Button>
            )}
          </div>
        </div>

        {/* Theme selector */}
        {editMode && (
          <Card className="border-dashed">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">Layout:</span>
                {(["default", "compact", "wide"] as Theme[]).map(t => (
                  <Button
                    key={t}
                    variant={theme === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setTheme(t); setIsDirty(true); }}
                    className="capitalize"
                  >
                    {t}
                  </Button>
                ))}
                <span className="text-sm text-muted-foreground ml-4">
                  {enabledWidgets.size} of {WIDGET_CATALOG.length} widgets enabled
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-6">
          {/* Widget Grid */}
          <div className="flex-1">
            {dataLoading ? (
              <div className={`grid ${gridCols} gap-4`}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="h-28" />
                  </Card>
                ))}
              </div>
            ) : orderedWidgets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed rounded-xl">
                <Globe className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No widgets enabled</p>
                <p className="text-muted-foreground text-sm mb-4">Click "Add Widgets" to customise your dashboard</p>
                <Button onClick={() => { setShowLibrary(true); setEditMode(true); }}>
                  <Plus className="h-4 w-4 mr-2" /> Add Widgets
                </Button>
              </div>
            ) : (
              <div className={`grid ${gridCols} gap-4`}>
                {orderedWidgets.map(id => (
                  <Widget
                    key={id}
                    id={id}
                    data={data}
                    onRemove={handleRemoveWidget}
                    editMode={editMode}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Widget Library Sidebar */}
          {showLibrary && editMode && (
            <div className="w-72 shrink-0">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Widget Library</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setShowLibrary(false)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="max-h-[600px] overflow-y-auto">
                  <WidgetLibrary enabled={enabledWidgets} onToggle={handleToggleWidget} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Stats footer */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-4">
          <Lock className="h-3 w-3" />
          <span>Dashboard preferences are saved per user account</span>
          <span>·</span>
          <span>Data refreshes every 30 seconds</span>
          <span>·</span>
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </>
  );
}
