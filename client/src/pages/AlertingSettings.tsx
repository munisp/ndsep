import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Bell, Mail, MessageSquare, Siren, CheckCircle2, XCircle,
  Send, RefreshCw, ShieldAlert, Zap, Settings2
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

function StatusBadge({ configured, label }: { configured: boolean; label: string }) {
  return configured ? (
    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1">
      <CheckCircle2 className="h-3 w-3" /> {label}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground gap-1">
      <XCircle className="h-3 w-3" /> Not configured
    </Badge>
  );
}

export default function AlertingSettings() {
  const { data: status, isLoading: statusLoading, refetch } = trpc.system.alertingStatus.useQuery();

  // Email test state
  const [emailTo, setEmailTo] = useState("");
  const [emailType, setEmailType] = useState<"penalty" | "certificate">("penalty");
  const testEmailMutation = trpc.system.testEmail.useMutation({
    onSuccess: (data) => {
      if (data.success) toast.success(data.message);
      else toast.error(data.message);
    },
    onError: (err) => toast.error(`Email test failed: ${err.message}`),
  });

  // Slack test state
  const [slackSeverity, setSlackSeverity] = useState<"critical" | "warning" | "info" | "resolved">("info");
  const testSlackMutation = trpc.system.testSlack.useMutation({
    onSuccess: (data) => {
      if (data.success) toast.success(data.message);
      else toast.warning(data.message);
    },
    onError: (err) => toast.error(`Slack test failed: ${err.message}`),
  });

  // PagerDuty test state
  const testPagerDutyMutation = trpc.system.testPagerDuty.useMutation({
    onSuccess: (data) => {
      if (data.success) toast.success(data.message);
      else toast.warning(data.message);
    },
    onError: (err) => toast.error(`PagerDuty test failed: ${err.message}`),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: "/" }, { label: "Alerting Settings" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            Alerting & Notification Settings
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configure and test email, Slack, and PagerDuty alerting channels for enforcement events.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={statusLoading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${statusLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Channel Status Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Channel Status
          </CardTitle>
          <CardDescription className="text-xs">
            Current alerting channel configuration. Add secrets via the Management UI Secrets panel to activate channels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Email */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Email</span>
                </div>
                <StatusBadge configured={true} label={status?.email?.transport === "resend" ? "Resend" : "Forge API"} />
              </div>
              <p className="text-xs text-muted-foreground">
                {status?.email?.transport === "resend"
                  ? "Using Resend for transactional email delivery"
                  : "Using Manus Forge API (fallback). Add RESEND_API_KEY for production delivery."}
              </p>
              {status?.email?.from && (
                <p className="text-xs font-mono text-muted-foreground truncate">{status.email.from}</p>
              )}
            </div>

            {/* Slack */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-purple-500" />
                  <span className="text-sm font-medium">Slack</span>
                </div>
                <StatusBadge configured={status?.slack?.configured ?? false} label="Webhook active" />
              </div>
              <p className="text-xs text-muted-foreground">
                {status?.slack?.configured
                  ? "Incoming webhook configured. Alerts route to #ndsep-alerts."
                  : "Add SLACK_WEBHOOK_URL to activate. Create webhook at api.slack.com/apps."}
              </p>
            </div>

            {/* PagerDuty */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Siren className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">PagerDuty</span>
                </div>
                <StatusBadge configured={status?.pagerduty?.configured ?? false} label="Integration active" />
              </div>
              <p className="text-xs text-muted-foreground">
                {status?.pagerduty?.configured
                  ? "Events API v2 integration key configured. Critical alerts will page on-call."
                  : "Add PAGERDUTY_INTEGRATION_KEY to activate on-call paging for critical alerts."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email Test */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-500" />
            Test Email Delivery
          </CardTitle>
          <CardDescription className="text-xs">
            Send a test enforcement email to verify the email transport is working correctly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-medium">Recipient Email</Label>
              <Input
                type="email"
                placeholder="admin@example.com"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Email Template</Label>
              <Select value={emailType} onValueChange={(v: any) => setEmailType(v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="penalty">Penalty Notice (NGN 500,000)</SelectItem>
                  <SelectItem value="certificate">Compliance Certificate Granted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => {
                if (!emailTo) { toast.error("Enter a recipient email address"); return; }
                testEmailMutation.mutate({ to: emailTo, type: emailType });
              }}
              disabled={testEmailMutation.isPending || !emailTo}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {testEmailMutation.isPending ? "Sending..." : "Send Test Email"}
            </Button>
            {testEmailMutation.data && (
              <span className={`text-xs ${testEmailMutation.data.success ? "text-emerald-600" : "text-red-500"}`}>
                {testEmailMutation.data.message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Slack Test */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-purple-500" />
            Test Slack Webhook
          </CardTitle>
          <CardDescription className="text-xs">
            Send a test alert to your configured Slack channel to verify webhook connectivity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div>
              <Label className="text-xs font-medium">Alert Severity</Label>
              <Select value={slackSeverity} onValueChange={(v: any) => setSlackSeverity(v)}>
                <SelectTrigger className="mt-1 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => testSlackMutation.mutate({ severity: slackSeverity })}
              disabled={testSlackMutation.isPending}
              variant="outline"
              className="gap-2"
            >
              <Zap className="h-4 w-4" />
              {testSlackMutation.isPending ? "Sending..." : "Send Test Alert"}
            </Button>
          </div>
          {testSlackMutation.data && (
            <p className={`text-xs ${testSlackMutation.data.success ? "text-emerald-600" : "text-yellow-600"}`}>
              {testSlackMutation.data.message}
            </p>
          )}
          {!status?.slack?.configured && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
              Slack is not configured. Add <code className="font-mono text-xs bg-muted px-1 rounded">SLACK_WEBHOOK_URL</code> via the Management UI Secrets panel to activate.
            </p>
          )}
        </CardContent>
      </Card>

      {/* PagerDuty Test */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Siren className="h-4 w-4 text-red-500" />
            Test PagerDuty Integration
          </CardTitle>
          <CardDescription className="text-xs">
            Trigger a test incident in PagerDuty to verify the Events API v2 integration key is valid.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => testPagerDutyMutation.mutate()}
              disabled={testPagerDutyMutation.isPending}
              variant="outline"
              className="gap-2"
            >
              <ShieldAlert className="h-4 w-4" />
              {testPagerDutyMutation.isPending ? "Triggering..." : "Trigger Test Incident"}
            </Button>
            {testPagerDutyMutation.data && (
              <span className={`text-xs ${testPagerDutyMutation.data.success ? "text-emerald-600" : "text-yellow-600"}`}>
                {testPagerDutyMutation.data.message}
              </span>
            )}
          </div>
          {!status?.pagerduty?.configured && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
              PagerDuty is not configured. Add <code className="font-mono text-xs bg-muted px-1 rounded">PAGERDUTY_INTEGRATION_KEY</code> via the Management UI Secrets panel to activate on-call paging.
            </p>
          )}
        </CardContent>
      </Card>

      {/* How to configure */}
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground">How to Configure</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p><strong>Resend (email):</strong> Create a free account at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">resend.com</a>, verify your domain, generate an API key, and add it as <code className="font-mono bg-muted px-1 rounded">RESEND_API_KEY</code> in the Secrets panel.</p>
          <p><strong>Slack:</strong> Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline">api.slack.com/apps</a>, create an app, enable Incoming Webhooks, and add the webhook URL as <code className="font-mono bg-muted px-1 rounded">SLACK_WEBHOOK_URL</code>.</p>
          <p><strong>PagerDuty:</strong> In PagerDuty, create a new service with Events API v2 integration, copy the integration key, and add it as <code className="font-mono bg-muted px-1 rounded">PAGERDUTY_INTEGRATION_KEY</code>.</p>
        </CardContent>
      </Card>
    </div>
  );
}
