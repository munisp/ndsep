import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Bell, CheckCheck, Info, AlertTriangle, XCircle, CheckCircle } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const SEV_ICONS: Record<string,any> = { info:Info, warning:AlertTriangle, error:XCircle, success:CheckCircle };
const SEV_COLORS: Record<string,string> = { info:"text-blue-600 bg-blue-50", warning:"text-yellow-600 bg-yellow-50", error:"text-red-600 bg-red-50", success:"text-green-600 bg-green-50" };

export default function NotificationCenter() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data: list, refetch } = trpc.notificationCenter.list.useQuery({ page, limit:20, unreadOnly });
  const markReadM = trpc.notificationCenter.markRead.useMutation({ onSuccess:()=>refetch() });
  const markAllM = trpc.notificationCenter.markAllRead.useMutation({ onSuccess:()=>{ toast.success("All notifications marked as read"); refetch(); } });
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Notification Center" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Bell className="h-7 w-7 text-primary"/><div><h1 className="text-2xl font-bold">Notification Center</h1><p className="text-muted-foreground text-sm">System alerts, compliance deadlines, and enforcement notifications</p></div></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={()=>setUnreadOnly(!unreadOnly)}>{unreadOnly?"Show All":"Unread Only"}</Button>
          <Button variant="outline" size="sm" onClick={()=>markAllM.mutate()}><CheckCheck className="h-4 w-4 mr-1"/>Mark All Read</Button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="secondary">{list?.total??0} total</Badge>
        <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">{list?.unreadCount??0} unread</Badge>
      </div>
      <div className="space-y-2">
        {(list?.data??[]).map((n:any)=>{
          const Icon = SEV_ICONS[n.severity]??Info;
          return (
            <div key={n.id} className={`flex items-start gap-3 p-4 border rounded-lg ${!n.is_read?"bg-primary/5 border-primary/20":"hover:bg-muted/30"}`}>
              <div className={`p-1.5 rounded-full ${SEV_COLORS[n.severity]??''}`}><Icon className="h-4 w-4"/></div>
              <div className="flex-1">
                <div className="flex items-center gap-2"><p className="font-medium text-sm">{n.title}</p>{!n.is_read&&<Badge className="bg-primary/10 text-primary text-xs">New</Badge>}</div>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{n.created_at?new Date(n.created_at).toLocaleString():''} · {n.category}</p>
              </div>
              {!n.is_read&&<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={()=>markReadM.mutate({id:n.id})}>Mark Read</Button>}
            </div>
          );
        })}
        {(list?.data??[]).length===0&&<div className="text-center py-12 text-muted-foreground"><Bell className="h-12 w-12 mx-auto mb-3 opacity-30"/><p>No notifications</p></div>}
      </div>
      <div className="flex justify-between"><p className="text-sm text-muted-foreground">Page {page}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Prev</Button><Button variant="outline" size="sm" disabled={(list?.data?.length??0)<20} onClick={()=>setPage(p=>p+1)}>Next</Button></div></div>
    </div>
  );
}
