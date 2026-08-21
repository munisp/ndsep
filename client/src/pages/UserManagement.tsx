import { toast } from "sonner";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, Search, Shield, UserX, Activity } from "lucide-react";


const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  government_staff: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20",
  org_admin: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  auditor: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  user: "bg-muted text-foreground border-border",
};

export default function UserManagement() {
  
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newRole, setNewRole] = useState("");
  const [activityUserId, setActivityUserId] = useState<number | null>(null);

  const limit = 20;
  const { data, refetch } = trpc.userManagement.list.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    role: (roleFilter !== "all" ? roleFilter : undefined) as any,
  });

  const { data: activityData } = trpc.userManagement.getActivity.useQuery(
    { userId: activityUserId! },
    { enabled: activityUserId !== null }
  );

  const updateRole = trpc.userManagement.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated successfully");
      setSelectedUser(null);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deactivate = trpc.userManagement.deactivate.useMutation({
    onSuccess: () => {
      toast.success("User deactivated");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-blue-600" />
              User Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage platform users, roles, and access levels
            </p>
          </div>
          <Badge variant="outline" className="text-sm">{total} users total</Badge>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="government_staff">Government Staff</SelectItem>
              <SelectItem value="org_admin">Org Admin</SelectItem>
              <SelectItem value="auditor">Auditor</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Users Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-3 px-4 font-medium">User</th>
                    <th className="text-left py-3 px-4 font-medium">Role</th>
                    <th className="text-left py-3 px-4 font-medium">Joined</th>
                    <th className="text-left py-3 px-4 font-medium">Last Activity</th>
                    <th className="text-right py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email ?? u.open_id}</div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge className={`text-xs border ${ROLE_COLORS[u.role] ?? ROLE_COLORS.user}`}>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {u.last_activity ? new Date(u.last_activity).toLocaleDateString() : "Never"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 gap-1 text-xs"
                            onClick={() => setActivityUserId(u.id)}
                          >
                            <Activity className="h-3 w-3" /> Activity
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 gap-1 text-xs"
                            onClick={() => { setSelectedUser(u); setNewRole(u.role); }}
                          >
                            <Shield className="h-3 w-3" /> Role
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 gap-1 text-xs text-red-600 hover:text-red-700"
                            onClick={() => {
                              if (confirm(`Deactivate ${u.name}?`)) deactivate.mutate({ userId: u.id });
                            }}
                          >
                            <UserX className="h-3 w-3" /> Deactivate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted-foreground">
                        No users found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
              <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total}>Next</Button>
            </div>
          </div>
        )}

        {/* Change Role Dialog */}
        <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Role — {selectedUser?.name}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="government_staff">Government Staff</SelectItem>
                  <SelectItem value="org_admin">Org Admin</SelectItem>
                  <SelectItem value="auditor">Auditor</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedUser(null)}>Cancel</Button>
              <Button
                onClick={() => updateRole.mutate({ userId: selectedUser.id, role: newRole as any })}
                disabled={updateRole.isPending || newRole === selectedUser?.role}
              >
                Save Role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Activity Dialog */}
        <Dialog open={activityUserId !== null} onOpenChange={() => setActivityUserId(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Activity Log — {activityData?.user?.name}</DialogTitle>
            </DialogHeader>
            <div className="max-h-96 overflow-y-auto space-y-1 py-2">
              {activityData?.activity?.map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                  <span className="text-xs text-muted-foreground w-36 shrink-0">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-xs shrink-0">{a.action}</Badge>
                  <span className="text-muted-foreground text-xs">{a.resource_type}/{a.resource_id}</span>
                </div>
              ))}
              {(!activityData?.activity || activityData.activity.length === 0) && (
                <p className="text-center text-muted-foreground py-8">No activity recorded.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
