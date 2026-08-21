/**
 * PushNotificationSettings
 *
 * A settings panel component for managing Web Push subscriptions.
 * Used in the DPCO PWA settings tab.
 */
import { Bell, BellOff, BellRing, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export function PushNotificationSettings() {
  const { permission, isSubscribed, isLoading, subscribe, unsubscribe, sendTest } =
    usePushNotifications();

  if (permission === "unsupported") {
    return (
      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="flex items-center gap-3 mb-2">
          <BellOff className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-semibold text-muted-foreground">Push Notifications</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Push notifications are not supported in this browser. Use Chrome or Edge for the best
          experience.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSubscribed ? (
            <BellRing className="h-5 w-5 text-cyan-400" />
          ) : (
            <Bell className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-semibold text-white">Push Notifications</p>
            <p className="text-[11px] text-muted-foreground">
              {isSubscribed
                ? "Active — you'll receive overdue invoice and audit alerts"
                : "Disabled — enable to receive real-time alerts"}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0">
          {isSubscribed ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Permission denied warning */}
      {permission === "denied" && (
        <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl px-3 py-2">
          <p className="text-xs text-rose-300">
            Notifications are blocked in your browser settings. To enable, click the lock icon in
            your address bar and allow notifications for this site.
          </p>
        </div>
      )}

      {/* What you'll receive */}
      {!isSubscribed && permission !== "denied" && (
        <div className="space-y-1.5">
          {[
            "Overdue invoice alerts",
            "Audit deadline reminders",
            "Client registration updates",
            "Subscription renewal notices",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 flex-shrink-0" />
              <p className="text-xs text-foreground">{item}</p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {isSubscribed ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs border-border text-foreground hover:text-white gap-1.5"
              onClick={sendTest}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />}
              Send Test
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs border-rose-800/60 text-rose-400 hover:text-rose-300 hover:border-rose-700 gap-1.5"
              onClick={unsubscribe}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellOff className="h-3 w-3" />}
              Disable
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            className="flex-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white gap-1.5"
            onClick={subscribe}
            disabled={isLoading || permission === "denied"}
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
            Enable Push Notifications
          </Button>
        )}
      </div>
    </div>
  );
}
