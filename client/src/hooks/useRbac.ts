import { useAuth } from "@/_core/hooks/useAuth";

export type NdsepRole =
  | "admin"
  | "government_staff"
  | "org_admin"
  | "auditor"
  | "user";

export interface RbacPermissions {
  // Layer access
  canViewDashboard: boolean;
  canViewDiscovery: boolean;
  canViewDataCatalog: boolean;
  canViewCompliance: boolean;
  canViewSiem: boolean;
  canViewNetworkDpi: boolean;
  canViewFinancial: boolean;
  canViewStreaming: boolean;
  canViewAiAssistant: boolean;
  canViewOrganizations: boolean;

  // Action permissions
  canManagePolicies: boolean;
  canIssueEnforcement: boolean;
  canViewAllOrgs: boolean;
  canManageUsers: boolean;
  canExportData: boolean;
  canViewAuditLogs: boolean;
  canViewThreatIntel: boolean;
  canManageFinancial: boolean;

  // Role info
  role: NdsepRole;
  isGovernmentStaff: boolean;
  isOrgAdmin: boolean;
  isAuditor: boolean;
  isAdmin: boolean;
  organizationId: number | null;
}

const PERMISSIONS_BY_ROLE: Record<NdsepRole, Omit<RbacPermissions, "role" | "isGovernmentStaff" | "isOrgAdmin" | "isAuditor" | "isAdmin" | "organizationId">> = {
  admin: {
    canViewDashboard: true,
    canViewDiscovery: true,
    canViewDataCatalog: true,
    canViewCompliance: true,
    canViewSiem: true,
    canViewNetworkDpi: true,
    canViewFinancial: true,
    canViewStreaming: true,
    canViewAiAssistant: true,
    canViewOrganizations: true,
    canManagePolicies: true,
    canIssueEnforcement: true,
    canViewAllOrgs: true,
    canManageUsers: true,
    canExportData: true,
    canViewAuditLogs: true,
    canViewThreatIntel: true,
    canManageFinancial: true,
  },
  government_staff: {
    canViewDashboard: true,
    canViewDiscovery: true,
    canViewDataCatalog: true,
    canViewCompliance: true,
    canViewSiem: true,
    canViewNetworkDpi: true,
    canViewFinancial: true,
    canViewStreaming: true,
    canViewAiAssistant: true,
    canViewOrganizations: true,
    canManagePolicies: true,
    canIssueEnforcement: true,
    canViewAllOrgs: true,
    canManageUsers: false,
    canExportData: true,
    canViewAuditLogs: true,
    canViewThreatIntel: true,
    canManageFinancial: true,
  },
  org_admin: {
    canViewDashboard: false,
    canViewDiscovery: true,
    canViewDataCatalog: true,
    canViewCompliance: true,
    canViewSiem: false,
    canViewNetworkDpi: false,
    canViewFinancial: true,
    canViewStreaming: false,
    canViewAiAssistant: true,
    canViewOrganizations: true,
    canManagePolicies: false,
    canIssueEnforcement: false,
    canViewAllOrgs: false,
    canManageUsers: false,
    canExportData: true,
    canViewAuditLogs: true,
    canViewThreatIntel: false,
    canManageFinancial: false,
  },
  auditor: {
    canViewDashboard: false,
    canViewDiscovery: false,
    canViewDataCatalog: true,
    canViewCompliance: true,
    canViewSiem: true,
    canViewNetworkDpi: false,
    canViewFinancial: true,
    canViewStreaming: false,
    canViewAiAssistant: false,
    canViewOrganizations: true,
    canManagePolicies: false,
    canIssueEnforcement: false,
    canViewAllOrgs: true,
    canManageUsers: false,
    canExportData: false,
    canViewAuditLogs: true,
    canViewThreatIntel: true,
    canManageFinancial: false,
  },
  user: {
    canViewDashboard: false,
    canViewDiscovery: false,
    canViewDataCatalog: false,
    canViewCompliance: false,
    canViewSiem: false,
    canViewNetworkDpi: false,
    canViewFinancial: false,
    canViewStreaming: false,
    canViewAiAssistant: false,
    canViewOrganizations: false,
    canManagePolicies: false,
    canIssueEnforcement: false,
    canViewAllOrgs: false,
    canManageUsers: false,
    canExportData: false,
    canViewAuditLogs: false,
    canViewThreatIntel: false,
    canManageFinancial: false,
  },
};

export function useRbac(): RbacPermissions {
  const { user } = useAuth();
  const role = (user?.role ?? "user") as NdsepRole;
  const perms = PERMISSIONS_BY_ROLE[role] ?? PERMISSIONS_BY_ROLE.user;

  return {
    ...perms,
    role,
    isAdmin: role === "admin",
    isGovernmentStaff: role === "admin" || role === "government_staff",
    isOrgAdmin: role === "org_admin",
    isAuditor: role === "auditor",
    organizationId: (user as any)?.organizationId ?? null,
  };
}

export function getRoleBadgeColor(role: NdsepRole): string {
  const colors: Record<NdsepRole, string> = {
    admin: "#ef4444",
    government_staff: "#2563eb",
    org_admin: "#8b5cf6",
    auditor: "#f59e0b",
    user: "#6b7280",
  };
  return colors[role] ?? "#6b7280";
}

export function getRoleLabel(role: NdsepRole): string {
  const labels: Record<NdsepRole, string> = {
    admin: "System Admin",
    government_staff: "Government Staff",
    org_admin: "Organization Admin",
    auditor: "Auditor",
    user: "User",
  };
  return labels[role] ?? role;
}
