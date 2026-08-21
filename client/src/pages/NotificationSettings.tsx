import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bell, Mail, Shield, Gavel, Award, RefreshCw, Save, AlertTriangle, CheckCircle2, Users, Clock } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const TOGGLE_GROUPS = [
  {
    label: "Financial Enforcement",
    icon: Gavel,
    color: "text-red-500",
    items: [
      { key: "penaltyIssued", label: "Penalty Issued", description: "Notify when a new penalty is issued to this organization" },
      { key: "penaltyPaid", label: "Penalty Payment Confirmed", description: "Notify when a penalty payment is confirmed" },
      { key: "penaltyAppealFiled", label: "Appeal Filed", description: "Notify when an appeal is submitted against a penalty" },
      { key: "penaltyAppealDecision", label: "Appeal Decision", description: "Notify when an appeal is upheld or dismissed" },
    ],
  },
  {
    label: "Enforcement Cases",
    icon: Shield,
    color: "text-orange-500",
    items: [
      { key: "enforcementCaseOpened", label: "Case Opened", description: "Notify when a new enforcement case is opened" },
    ],
  },
  {
    label: "Compliance & Certification",
    icon: Award,
    color: "text-emerald-500",
    items: [
      { key: "certificateGranted", label: "Compliance Certificate Granted", description: "Notify when a compliance certificate is issued" },
      { key: "complianceScoreChange", label: "Compliance Score Change", description: "Notify on significant compliance score changes (±10 points)" },
      { key: "slaBreachWarning", label: "SLA Breach Warning", description: "Notify when citizen request SLAs are at risk of breach" },
    ],
  },
  {
    label: "Portal & Onboarding",
    icon: RefreshCw,
    color: "text-blue-500",
    items: [
      { key: "portalPhaseUpdate", label: "Portal Onboarding Phase Update", description: "Notify on each onboarding phase status change" },
      { key: "citizenRequestUpdate", label: "Citizen Rights Request Update", description: "Notify when a citizen data rights request changes status" },
    ],
  },
];

export default function NotificationSettings() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // Get the user's organization ID
  const { data: orgsData } = trpc.organizations.list.useQuery({ limit: 200 });
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);

  // Fetch notification settings for selected org
  const { data: settings, isLoading } = trpc.notificationSettings.get.useQuery(
    { organizationId: selectedOrgId! },
    { enabled: !!selectedOrgId }
  );

  const upsertMutation = trpc.notificationSettings.upsert.useMutation({
    onSuccess: () => {
      toast.success("Notification settings saved successfully");
      utils.notificationSettings.get.invalidate({ organizationId: selectedOrgId! });
    },
    onError: (err) => toast.error(`Failed to save: ${err.message}`),
  });

  // Local form state
  const [form, setForm] = useState({
    penaltyIssued: true,
    penaltyPaid: true,
    penaltyAppealFiled: true,
    penaltyAppealDecision: true,
    enforcementCaseOpened: true,
    certificateGranted: true,
    portalPhaseUpdate: true,
    citizenRequestUpdate: true,
    slaBreachWarning: true,
    complianceScoreChange: false,
    dpoEmail: "",
    technicalEmail: "",
    legalEmail: "",
    digestFrequency: "immediate" as "immediate" | "daily" | "weekly",
  });

  // Sync form with fetched settings
  useEffect(() => {
    if (settings) {
      setForm({
        penaltyIssued: settings.penalty_issued ?? true,
        penaltyPaid: settings.penalty_paid ?? true,
        penaltyAppealFiled: settings.penalty_appeal_filed ?? true,
        penaltyAppealDecision: settings.penalty_appeal_decision ?? true,
        enforcementCaseOpened: settings.enforcement_case_opened ?? true,
        certificateGranted: settings.certificate_granted ?? true,
        portalPhaseUpdate: settings.portal_phase_update ?? true,
        citizenRequestUpdate: settings.citizen_request_update ?? true,
        slaBreachWarning: settings.sla_breach_warning ?? true,
        complianceScoreChange: settings.compliance_score_change ?? false,
        dpoEmail: settings.dpo_email ?? "",
        technicalEmail: settings.technical_email ?? "",
        legalEmail: settings.legal_email ?? "",
        digestFrequency: (settings.digest_frequency as any) ?? "immediate",
      });
    }
  }, [settings]);

  const orgs = (orgsData as any[]) ?? [];

  const handleSave = () => {
    if (!selectedOrgId) { toast.error("Please select an organization first"); return; }
    upsertMutation.mutate({
      organizationId: selectedOrgId,
      ...form,
      dpoEmail: form.dpoEmail || null,
      technicalEmail: form.technicalEmail || null,
      legalEmail: form.legalEmail || null,
    });
  };

  const enabledCount = [
    form.penaltyIssued, form.penaltyPaid, form.penaltyAppealFiled, form.penaltyAppealDecision,
    form.enforcementCaseOpened, form.certificateGranted, form.portalPhaseUpdate,
    form.citizenRequestUpdate, form.slaBreachWarning, form.complianceScoreChange,
  ].filter(Boolean).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Notification Settings" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            Notification Settings
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configure email notification preferences for enforcement events per organization.
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {enabledCount}/10 channels active
        </Badge>
      </div>

      {/* Organization Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Select Organization
          </CardTitle>
          <CardDescription className="text-xs">
            Choose the organization whose notification preferences you want to configure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedOrgId?.toString() ?? ""}
            onValueChange={(v) => setSelectedOrgId(Number(v))}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select an organization..." />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((org: any) => (
                <SelectItem key={org.id} value={org.id.toString()}>
                  {org.name}
                  {org.sector && <span className="text-muted-foreground ml-2 text-xs">({org.sector})</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!selectedOrgId && (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-muted-foreground">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm">Select an organization above to view and edit its notification settings.</p>
        </div>
      )}

      {selectedOrgId && (
        <>
          {/* Notification Toggles */}
          {TOGGLE_GROUPS.map((group) => (
            <Card key={group.label}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <group.icon className={`h-4 w-4 ${group.color}`} />
                  {group.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {group.items.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <Label htmlFor={item.key} className="text-sm font-medium cursor-pointer">
                        {item.label}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                    <Switch
                      id={item.key}
                      checked={(form as any)[item.key]}
                      onCheckedChange={(v) => setForm(f => ({ ...f, [item.key]: v }))}
                      disabled={isLoading}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          {/* Contact Email Overrides */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Contact Email Overrides
              </CardTitle>
              <CardDescription className="text-xs">
                Optionally route specific notification types to dedicated contacts. Leave blank to use the organization's primary contact email.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs font-medium">DPO Email</Label>
                <Input
                  type="email"
                  placeholder="dpo@organization.com"
                  value={form.dpoEmail}
                  onChange={e => setForm(f => ({ ...f, dpoEmail: e.target.value }))}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Data Protection Officer</p>
              </div>
              <div>
                <Label className="text-xs font-medium">Technical Email</Label>
                <Input
                  type="email"
                  placeholder="tech@organization.com"
                  value={form.technicalEmail}
                  onChange={e => setForm(f => ({ ...f, technicalEmail: e.target.value }))}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">System / IT contact</p>
              </div>
              <div>
                <Label className="text-xs font-medium">Legal Email</Label>
                <Input
                  type="email"
                  placeholder="legal@organization.com"
                  value={form.legalEmail}
                  onChange={e => setForm(f => ({ ...f, legalEmail: e.target.value }))}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Legal / Compliance team</p>
              </div>
            </CardContent>
          </Card>

          {/* Digest Frequency */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Delivery Frequency
              </CardTitle>
              <CardDescription className="text-xs">
                Control how often notification emails are sent. "Immediate" sends an email for each event; "Daily" and "Weekly" batch events into a digest.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={form.digestFrequency}
                onValueChange={(v: any) => setForm(f => ({ ...f, digestFrequency: v }))}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="immediate">Immediate — send on each event</SelectItem>
                  <SelectItem value="daily">Daily digest — batch into one email/day</SelectItem>
                  <SelectItem value="weekly">Weekly digest — batch into one email/week</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {settings ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  Settings saved — last updated {new Date(settings.updated_at).toLocaleString()}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                  No settings saved yet — using platform defaults
                </>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={upsertMutation.isPending}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {upsertMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
