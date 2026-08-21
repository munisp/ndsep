import { useState } from "react";
import { Mail, Bell, BellOff, Send, Eye, CheckCircle2, RefreshCw, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
export default function EmailDigestSettings() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [showPreview, setShowPreview] = useState(false);

  const { data: status, isLoading } = trpc.emailDigest.getStatus.useQuery();
  const { data: preview, isLoading: previewLoading } = trpc.emailDigest.preview.useQuery(
    undefined,
    { enabled: showPreview }
  );

  const subscribe = trpc.emailDigest.subscribe.useMutation({
    onSuccess: (data) => {
      utils.emailDigest.getStatus.invalidate();
      toast.success(`Subscribed! First digest will be sent to ${data.email}`);
    },
  });

  const unsubscribe = trpc.emailDigest.unsubscribe.useMutation({
    onSuccess: () => {
      utils.emailDigest.getStatus.invalidate();
      toast.success("Unsubscribed from weekly digest.");
    },
  });

  const sendNow = trpc.emailDigest.sendNow.useMutation({
    onSuccess: (data) => {
      utils.emailDigest.getStatus.invalidate();
      if (data.sent) {
        toast.success(`Digest sent to ${data.email}!`);
      } else {
        toast.info("Digest generated. Email delivery will be attempted shortly.");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const isSubscribed = status?.active === 1;

  return (
    <>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Mail className="h-7 w-7 text-cyan-600" />
            <h1 className="text-2xl font-bold text-foreground">Email Digest Settings</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Receive a weekly summary of upcoming compliance deadlines, active SLA timers, breach incidents, and sector scores directly in your inbox.
          </p>
        </div>

        {/* Status card */}
        <div className="bg-muted border border-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isSubscribed ? (
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Bell className="h-5 w-5 text-emerald-400" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div>
                <div className="font-semibold text-foreground">
                  {isSubscribed ? "Weekly Digest Active" : "Not Subscribed"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {isSubscribed
                    ? `Sending to: ${status?.email ?? user?.email ?? "your email"}`
                    : "Subscribe to receive weekly compliance summaries"}
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className={isSubscribed ? "border-emerald-500/30 text-emerald-400" : "border-border text-muted-foreground"}
            >
              {isSubscribed ? "Active" : "Inactive"}
            </Badge>
          </div>

          {isSubscribed && status?.next_send_at && (
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-4">
              <Calendar className="h-3.5 w-3.5" />
              <span>Next digest: {new Date(status.next_send_at).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
              {status?.last_sent_at && (
                <span className="ml-4">Last sent: {new Date(status.last_sent_at).toLocaleDateString()}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 mb-8">
          {!isSubscribed ? (
            <Button
              className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold gap-2"
              onClick={() => subscribe.mutate({ email: user?.email ?? undefined })}
              disabled={subscribe.isPending || isLoading}
            >
              <Bell className="h-4 w-4" />
              Subscribe to Weekly Digest
            </Button>
          ) : (
            <>
              <Button
                className="bg-emerald-600 hover:bg-emerald-500 text-foreground gap-2"
                onClick={() => sendNow.mutate()}
                disabled={sendNow.isPending}
              >
                <Send className="h-4 w-4" />
                {sendNow.isPending ? "Sending…" : "Send Digest Now"}
              </Button>
              <Button
                variant="outline"
                className="border-border text-muted-foreground hover:text-foreground gap-2"
                onClick={() => setShowPreview((p) => !p)}
              >
                <Eye className="h-4 w-4" />
                {showPreview ? "Hide Preview" : "Preview Digest"}
              </Button>
              <Button
                variant="ghost"
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-2"
                onClick={() => unsubscribe.mutate()}
                disabled={unsubscribe.isPending}
              >
                <BellOff className="h-4 w-4" />
                Unsubscribe
              </Button>
            </>
          )}
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="bg-muted border border-border rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-cyan-600 mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4" /> Digest Preview
            </h3>
            {previewLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <RefreshCw className="h-4 w-4 animate-spin" /> Generating preview…
              </div>
            ) : (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                {preview?.content ?? "No content available."}
              </pre>
            )}
          </div>
        )}

        {/* What's included */}
        <div className="bg-muted border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">What's included in each digest</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: "⏰", label: "Upcoming deadlines", desc: "Compliance deadlines in the next 14 days" },
              { icon: "🚨", label: "Active SLA timers", desc: "Enforcement timers expiring within 7 days" },
              { icon: "🔴", label: "Breach incidents", desc: "New breach incidents from the last 7 days" },
              { icon: "📊", label: "Sector scores", desc: "Latest compliance scores across all sectors" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2 p-3 rounded-lg bg-card/30">
                <span className="text-lg">{item.icon}</span>
                <div>
                  <div className="text-xs font-medium text-foreground">{item.label}</div>
                  <div className="text-[11px] text-muted-foreground">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
