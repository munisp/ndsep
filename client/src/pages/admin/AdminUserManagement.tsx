import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { exportToCsv } from "@/lib/safeExport";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/15 text-red-600 dark:text-red-400",
  auditor: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  org_admin: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  user: "bg-muted text-foreground",
};

export default function AdminUserManagement() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const { data: users = [], isLoading, refetch } = trpc.users.list.useQuery();
  const updateRole = trpc.users.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated successfully");
      refetch();
      setUpdatingId(null);
    },
    onError: (e) => {
      toast.error("Failed to update role: " + (e instanceof Error ? e.message : String(e)));
      setUpdatingId(null);
    },
  });

  const filtered = (users as any[]).filter(u => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (search && !u.name?.toLowerCase().includes(search.toLowerCase()) && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function exportToExcel() {
    const rows = filtered.map((u: any) => ({
      "ID": u.id,
      "Name": u.name ?? "",
      "Email": u.email ?? "",
      "Role": u.role ?? "user",
      "Organisation ID": u.organizationId ?? "",
      "Created At": u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "",
    }));
    exportToCsv(rows as Record<string, unknown>[], `ndsep-users-${new Date().toISOString().split("T")[0]}`);
    toast.success("Export complete");
  }

  const roleCounts = (users as any[]).reduce((acc: Record<string, number>, u: any) => {
    acc[u.role ?? "user"] = (acc[u.role ?? "user"] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground mt-1">Manage platform users, roles, and access levels</p>
        </div>
        <Button onClick={exportToExcel} variant="outline" size="sm">Export XLSX</Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{(users as any[]).length}</div><div className="text-sm text-muted-foreground">Total Users</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-red-600">{roleCounts.admin ?? 0}</div><div className="text-sm text-muted-foreground">Admins</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-orange-600">{roleCounts.auditor ?? 0}</div><div className="text-sm text-muted-foreground">Auditors</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-blue-600">{roleCounts.org_admin ?? 0}</div><div className="text-sm text-muted-foreground">Org Admins</div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="auditor">Auditor</SelectItem>
            <SelectItem value="org_admin">Org Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading users...</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Org ID</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No users found</TableCell>
                  </TableRow>
                ) : filtered.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-xs">{u.id}</TableCell>
                    <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{u.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={ROLE_COLORS[u.role ?? "user"] ?? "bg-muted text-foreground"}>
                        {u.role ?? "user"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{u.organizationId ?? "—"}</TableCell>
                    <TableCell className="text-sm">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role ?? "user"}
                        onValueChange={(newRole) => {
                          setUpdatingId(u.id);
                          updateRole.mutate({ userId: u.id, role: newRole as any });
                        }}
                        disabled={updatingId === u.id}
                      >
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="org_admin">Org Admin</SelectItem>
                          <SelectItem value="auditor">Auditor</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
