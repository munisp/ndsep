import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Bell, CheckCheck, Trash2, Circle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function Phase13NotificationCenter() {
  const [isReadFilter, setIsReadFilter] = useState<boolean | undefined>(undefined);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);

  const utils = trpc.useUtils();
  const { data: notifications, isLoading } = trpc.phase13.notificationCenter.list.useQuery({
    is_read: isReadFilter,
    priority: priorityFilter === "all" ? undefined : priorityFilter || undefined,
    page,
    limit: 20,
  });
  const { data: unreadData } = trpc.phase13.notificationCenter.getUnreadCount.useQuery();
  const markRead = trpc.phase13.notificationCenter.markRead.useMutation({
    onSuccess: () => { utils.phase13.notificationCenter.list.invalidate(); utils.phase13.notificationCenter.getUnreadCount.invalidate(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const markAllRead = trpc.phase13.notificationCenter.markAllRead.useMutation({
    onSuccess: () => { utils.phase13.notificationCenter.list.invalidate(); utils.phase13.notificationCenter.getUnreadCount.invalidate(); toast.success("All notifications marked as read"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteNotif = trpc.phase13.notificationCenter.delete.useMutation({
    onSuccess: () => { utils.phase13.notificationCenter.list.invalidate(); toast.success("Notification deleted"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (notifications as any[]) ?? [];
  const unreadCount = (unreadData as any)?.count ?? 0;

  const priorityColor: Record<string, string> = {
    critical: "text-red-700 bg-red-50 dark:bg-red-950/30",
    high: "text-red-600 bg-red-50 dark:bg-red-950/20",
    medium: "text-orange-600 bg-orange-50 dark:bg-orange-950/20",
    low: "text-green-600 bg-green-50 dark:bg-green-950/20",
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-6 w-6 text-blue-600" />
              Notification Center
              {unreadCount > 0 && (
                <Badge className="ml-1 bg-red-500 text-white">{unreadCount}</Badge>
              )}
            </h1>
            <p className="text-muted-foreground mt-1">Compliance alerts, regulatory updates, and system notifications</p>
          </div>
          <Button variant="outline" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending || unreadCount === 0}>
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark All Read
          </Button>
        </div>

        <div className="flex gap-3">
          <Select
            value={isReadFilter === undefined ? "" : isReadFilter ? "read" : "unread"}
            onValueChange={v => setIsReadFilter(v === "" ? undefined : v === "read")}
          >
            <SelectTrigger className="w-40"><SelectValue placeholder="All Notifications" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Priorities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Notifications ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading notifications...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No notifications found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {list.map((n: any) => (
                  <div key={n.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${!n.is_read ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-500/20 dark:border-blue-800" : "border-transparent hover:bg-muted/30"}`}>
                    <div className="mt-1">
                      {!n.is_read ? (
                        <Circle className="h-3 w-3 fill-blue-500 text-blue-500" />
                      ) : (
                        <Circle className="h-3 w-3 text-muted-foreground/30" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{n.title ?? n.subject ?? "Notification"}</span>
                        {n.priority && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityColor[n.priority] ?? ""}`}>
                            {n.priority}
                          </span>
                        )}
                        {n.notification_type && (
                          <Badge variant="outline" className="text-xs">{n.notification_type?.replace(/_/g, " ")}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{n.message ?? n.body ?? "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1">{n.created_at ? new Date(n.created_at).toLocaleString() : "—"}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!n.is_read && (
                        <Button size="sm" variant="ghost" title="Mark as read" onClick={() => markRead.mutate({ id: n.id })}>
                          <CheckCheck className="h-3 w-3 text-blue-600" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" title="Delete" onClick={() => deleteNotif.mutate({ id: n.id })}>
                        <Trash2 className="h-3 w-3 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {list.length === 20 && (
          <div className="flex justify-center gap-2">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="flex items-center px-3 text-sm text-muted-foreground">Page {page}</span>
            <Button variant="outline" onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </>
  );
}
