import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRbac, getRoleBadgeColor, getRoleLabel, type NdsepRole } from "@/hooks/useRbac";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Users, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const ROLES: NdsepRole[] = ["admin", "government_staff", "org_admin", "auditor", "user"];

const PERMISSION_MATRIX: { label: string; key: string }[] = [
  { label: "Government Dashboard", key: "canViewDashboard" },
  { label: "Discovery Engine", key: "canViewDiscovery" },
  { label: "Data Catalog & Lakehouse", key: "canViewDataCatalog" },
  { label: "Compliance Engine", key: "canViewCompliance" },
  { label: "SIEM & Audit Trail", key: "canViewSiem" },
  { label: "Network DPI", key: "canViewNetworkDpi" },
  { label: "Financial Enforcement", key: "canViewFinancial" },
  { label: "Streaming Events", key: "canViewStreaming" },
  { label: "AI Advisor", key: "canViewAiAssistant" },
  { label: "Organizations", key: "canViewOrganizations" },
  { label: "Manage Policies", key: "canManagePolicies" },
  { label: "Issue Enforcement", key: "canIssueEnforcement" },
  { label: "View All Organizations", key: "canViewAllOrgs" },
  { label: "Manage Users", key: "canManageUsers" },
  { label: "Export Data", key: "canExportData" },
  { label: "View Audit Logs", key: "canViewAuditLogs" },
  { label: "Threat Intelligence", key: "canViewThreatIntel" },
  { label: "Manage Financial Penalties", key: "canManageFinancial" },
];

export default function RoleManagement() {
  const { user } = useAuth();
  const rbac = useRbac();
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);

  const { data: userList, isLoading: usersLoading, refetch: refetchUsers } = trpc.users.list.useQuery();
  const utils = trpc.useUtils();

  const updateRoleMutation = trpc.users.updateRole.useMutation({
    onMutate: ({ userId }) => setUpdatingUserId(userId),
    onSuccess: () => {
      utils.users.list.invalidate();
      toast.success("User role has been updated successfully.");
    },
    onError: (err) => {
      toast.error(`Error: ${err.message}`);
    },
    onSettled: () => setUpdatingUserId(null),
  });

  if (!rbac.isAdmin && !rbac.isGovernmentStaff) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Lock className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground mono text-sm">Access restricted to Government Staff and System Administrators</p>
      </div>
    );
  }

  const currentRole = rbac.role;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Role Management" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">RBAC</span>
            <span className="data-label">Keycloak · Role-Based Access Control</span>
          </div>
          <h1 className="text-2xl font-bold">Role Management</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">
            Platform access control · Permission matrix · Role hierarchy
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="data-label">Your role:</span>
          <Badge
            variant="outline"
            className="mono text-xs font-semibold"
            style={{ borderColor: getRoleBadgeColor(currentRole) + "60", color: getRoleBadgeColor(currentRole) }}
          >
            {getRoleLabel(currentRole)}
          </Badge>
        </div>
      </div>

      {/* Role Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {ROLES.map((role) => (
          <Card
            key={role}
            className={`border relative overflow-hidden ${role === currentRole ? "border-primary/40 bg-primary/5" : "border-border/60"}`}
          >
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-3 w-3 rounded-full" style={{ background: getRoleBadgeColor(role) }} />
                <span className="mono text-xs font-semibold">{getRoleLabel(role)}</span>
                {role === currentRole && <Badge variant="outline" className="mono text-[9px] ml-auto">YOU</Badge>}
              </div>
              <div className="space-y-1">
                {getRoleDescription(role).map((line, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground mono">{line}</p>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* User List with Role Assignment */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              Platform Users
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="data-label mono text-xs">{userList?.length ?? 0} users</span>
              <Button variant="ghost" size="sm" onClick={() => refetchUsers()} className="h-7 px-2">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {usersLoading ? (
            <div className="p-6 text-center text-muted-foreground mono text-xs">Loading users...</div>
          ) : !userList || userList.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground mono text-xs">No users found in the system.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="text-left px-4 py-3 data-label font-semibold">User</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Email</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Current Role</th>
                    <th className="text-left px-4 py-3 data-label font-semibold">Last Sign-In</th>
                    {rbac.isAdmin && <th className="text-left px-4 py-3 data-label font-semibold">Assign Role</th>}
                  </tr>
                </thead>
                <tbody>
                  {userList.map((u, idx) => (
                    <tr
                      key={u.id}
                      className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"} ${u.openId === user?.openId ? "bg-primary/5" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                            <span className="mono text-[9px] font-bold">{(u.name ?? "?").charAt(0).toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="mono font-semibold">{u.name ?? "Unknown"}</p>
                            {u.openId === user?.openId && <span className="mono text-[9px] text-primary">YOU</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{u.email ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className="mono text-[9px]"
                          style={{ borderColor: getRoleBadgeColor(u.role as NdsepRole) + "60", color: getRoleBadgeColor(u.role as NdsepRole) }}
                        >
                          {getRoleLabel(u.role as NdsepRole)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">
                        {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "Never"}
                      </td>
                      {rbac.isAdmin && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Select
                              defaultValue={u.role}
                              onValueChange={(newRole) => {
                                if (newRole !== u.role) {
                                  updateRoleMutation.mutate({ userId: u.id, role: newRole as any });
                                }
                              }}
                              disabled={updatingUserId === u.id}
                            >
                              <SelectTrigger className="h-7 w-36 mono text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="auditor">Auditor</SelectItem>
                                <SelectItem value="org_admin">Org Admin</SelectItem>
                                <SelectItem value="government_staff">Gov Staff</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                            {updatingUserId === u.id && (
                              <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Permission Matrix */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Permission Matrix</CardTitle>
            <span className="layer-badge">KEYCLOAK SSO</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="text-left px-4 py-3 data-label font-semibold w-48">Permission</th>
                  {ROLES.map((role) => (
                    <th key={role} className="text-center px-3 py-3 data-label font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <div className="h-2 w-2 rounded-full" style={{ background: getRoleBadgeColor(role) }} />
                        <span className="mono text-[9px]">{getRoleLabel(role).split(" ").slice(-1)[0]}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_MATRIX.map((perm, idx) => (
                  <tr
                    key={perm.key}
                    className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                  >
                    <td className="px-4 py-2.5 mono font-medium">{perm.label}</td>
                    {ROLES.map((role) => {
                      const hasPermission = getPermissionForRole(role, perm.key as string);
                      return (
                        <td key={role} className="px-3 py-2.5 text-center">
                          {hasPermission ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Keycloak Integration Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Keycloak SSO Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: "Realm", value: "ndsep-national" },
                { label: "Client ID", value: "ndsep-platform" },
                { label: "Token Endpoint", value: "/realms/ndsep-national/protocol/openid-connect/token" },
                { label: "JWKS URI", value: "/realms/ndsep-national/protocol/openid-connect/certs" },
                { label: "MFA Required", value: "government_staff, admin" },
                { label: "Session Timeout", value: "8h (staff), 2h (auditor)" },
              ].map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-4">
                  <span className="data-label shrink-0">{item.label}</span>
                  <span className="mono text-xs text-right text-muted-foreground truncate">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">RBAC Enforcement Points</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { layer: "API Gateway (APISIX)", desc: "JWT validation + role claim extraction", status: "active" },
                { layer: "tRPC Middleware", desc: "governmentStaffProcedure, orgAdminProcedure, auditorProcedure", status: "active" },
                { layer: "Database Layer", desc: "Row-level security via organizationId scoping", status: "active" },
                { layer: "Frontend UI", desc: "useRbac() hook gates navigation and actions", status: "active" },
                { layer: "OPA Policy Engine", desc: "Fine-grained data classification enforcement", status: "planned" },
              ].map((item) => (
                <div key={item.layer} className="flex items-start gap-3 p-2 rounded border border-border/40">
                  <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${item.status === "active" ? "bg-green-500" : "bg-yellow-500"}`} />
                  <div>
                    <p className="mono text-xs font-semibold">{item.layer}</p>
                    <p className="mono text-[10px] text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function getRoleDescription(role: NdsepRole): string[] {
  const descriptions: Record<NdsepRole, string[]> = {
    admin: ["Full system access", "User management", "All platform layers", "Configuration"],
    government_staff: ["All 6 platform layers", "Policy management", "Enforcement actions", "National analytics"],
    org_admin: ["Own org data only", "Asset management", "Compliance reports", "Financial penalties"],
    auditor: ["Read-only access", "Audit trail", "Compliance reports", "Threat intelligence"],
    user: ["No platform access", "Login only", "Request access", "Contact admin"],
  };
  return descriptions[role] ?? [];
}

function getPermissionForRole(role: NdsepRole, permKey: string): boolean {
  const permMap: Record<NdsepRole, Record<string, boolean>> = {
    admin: {
      canViewDashboard: true, canViewDiscovery: true, canViewDataCatalog: true,
      canViewCompliance: true, canViewSiem: true, canViewNetworkDpi: true,
      canViewFinancial: true, canViewStreaming: true, canViewAiAssistant: true,
      canViewOrganizations: true, canManagePolicies: true, canIssueEnforcement: true,
      canViewAllOrgs: true, canManageUsers: true, canExportData: true,
      canViewAuditLogs: true, canViewThreatIntel: true, canManageFinancial: true,
    },
    government_staff: {
      canViewDashboard: true, canViewDiscovery: true, canViewDataCatalog: true,
      canViewCompliance: true, canViewSiem: true, canViewNetworkDpi: true,
      canViewFinancial: true, canViewStreaming: true, canViewAiAssistant: true,
      canViewOrganizations: true, canManagePolicies: true, canIssueEnforcement: true,
      canViewAllOrgs: true, canManageUsers: false, canExportData: true,
      canViewAuditLogs: true, canViewThreatIntel: true, canManageFinancial: true,
    },
    org_admin: {
      canViewDashboard: false, canViewDiscovery: true, canViewDataCatalog: true,
      canViewCompliance: true, canViewSiem: false, canViewNetworkDpi: false,
      canViewFinancial: true, canViewStreaming: false, canViewAiAssistant: true,
      canViewOrganizations: true, canManagePolicies: false, canIssueEnforcement: false,
      canViewAllOrgs: false, canManageUsers: false, canExportData: true,
      canViewAuditLogs: true, canViewThreatIntel: false, canManageFinancial: false,
    },
    auditor: {
      canViewDashboard: false, canViewDiscovery: false, canViewDataCatalog: true,
      canViewCompliance: true, canViewSiem: true, canViewNetworkDpi: false,
      canViewFinancial: true, canViewStreaming: false, canViewAiAssistant: false,
      canViewOrganizations: true, canManagePolicies: false, canIssueEnforcement: false,
      canViewAllOrgs: true, canManageUsers: false, canExportData: false,
      canViewAuditLogs: true, canViewThreatIntel: true, canManageFinancial: false,
    },
    user: {
      canViewDashboard: false, canViewDiscovery: false, canViewDataCatalog: false,
      canViewCompliance: false, canViewSiem: false, canViewNetworkDpi: false,
      canViewFinancial: false, canViewStreaming: false, canViewAiAssistant: false,
      canViewOrganizations: false, canManagePolicies: false, canIssueEnforcement: false,
      canViewAllOrgs: false, canManageUsers: false, canExportData: false,
      canViewAuditLogs: false, canViewThreatIntel: false, canManageFinancial: false,
    },
  };
  return permMap[role]?.[permKey] ?? false;
}
