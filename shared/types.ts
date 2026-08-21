/**
 * Shared type definitions for NDSEP platform.
 * Replaces `any` types with proper interfaces across server and client code.
 */

// ── Database Row Types ──────────────────────────────────────────

/** Generic database row from raw SQL queries */
export interface DbRow {
  [key: string]: string | number | boolean | null | Date;
}

/** Query result from pg Pool.query() */
export interface QueryResult<T = DbRow> {
  rows: T[];
  rowCount: number | null;
  command: string;
}

// ── Violation / Compliance Types ────────────────────────────────

export interface Violation {
  id: string | number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  status?: string;
  category?: string;
  description?: string;
  resolved?: boolean;
  createdAt?: string | Date;
}

export interface ComplianceEvent {
  id: string | number;
  sector: string;
  severity: string;
  resolved: boolean;
  count: number;
  createdAt?: string | Date;
}

// ── API / tRPC Response Types ───────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ApiError {
  message: string;
  code?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

// ── Worker Types ────────────────────────────────────────────────

export interface WorkerProcess {
  id: string;
  name: string;
  type: string;
  status: "running" | "stopped" | "error" | "starting";
  pid?: number;
  uptime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
  lastHeartbeat?: string | Date;
}

// ── Notification Types ──────────────────────────────────────────

export interface Notification {
  id: string | number;
  title: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  read: boolean;
  createdAt: string | Date;
  link?: string;
}

export interface Alert {
  id: string | number;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  source: string;
  acknowledged: boolean;
  createdAt: string | Date;
}

// ── Enforcement Types ───────────────────────────────────────────

export interface EnforcementCase {
  id: string | number;
  title: string;
  status: string;
  penalty?: number;
  organization?: string;
  sector?: string;
  createdAt?: string | Date;
}

export interface PenaltyRecord {
  id: string | number;
  amount: number;
  currency: string;
  status: string;
  organizationId?: string | number;
  enforcementCaseId?: string | number;
}

// ── Organization Types ──────────────────────────────────────────

export interface Organization {
  id: string | number;
  name: string;
  sector?: string;
  complianceScore?: number;
  status?: string;
  registrationNumber?: string;
}

// ── DPCO Types ──────────────────────────────────────────────────

export interface DpcoEntity {
  id: string | number;
  name: string;
  status: string;
  score?: number;
  accreditedAt?: string | Date;
  expiresAt?: string | Date;
}

export interface AuditFinding {
  id: string | number;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  status: "open" | "resolved" | "accepted";
  evidence?: string;
}

// ── Data Catalog Types ──────────────────────────────────────────

export interface LakehouseNamespace {
  name: string;
}

export interface LakehouseTable {
  namespace: string;
  name: string;
}

// ── Menu / UI Types ─────────────────────────────────────────────

export interface MenuItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string;
  section?: string;
  badge?: number;
}

// ── User Types ──────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  name: string;
  email?: string;
  role: string;
  permissions?: string[];
  avatar?: string;
}

// ── Error Handling ──────────────────────────────────────────────

/** Type guard to safely extract error message from unknown catch */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/** Type guard to safely extract error with stack trace */
export function getErrorDetails(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      code: (error as NodeJS.ErrnoException).code,
    };
  }
  return { message: String(error) };
}

// ── Telecom Types ───────────────────────────────────────────────

export interface TelecomOperator {
  id: string | number;
  name: string;
  licenseType?: string;
  status?: string;
}

export interface SpectrumLicense {
  id: string | number;
  band: string;
  operator: string;
  expiresAt?: string | Date;
}

export interface TelecomDispute {
  id: string | number;
  parties: string;
  status: string;
  filedAt?: string | Date;
}

export interface LawfulIntercept {
  id: string | number;
  target: string;
  authority: string;
  status: string;
  issuedAt?: string | Date;
}

// ── Data Flow Types ─────────────────────────────────────────────

export interface DataTransfer {
  id: string | number;
  source: string;
  destination: string;
  status: "approved" | "rejected" | "blocked" | "pending";
  dataType?: string;
  volume?: number;
}

export interface DataFlow {
  source: string;
  target: string;
  value: number;
}

// ── Search / OpenSearch Types ───────────────────────────────────

export interface SearchHit {
  _id: string;
  _source: Record<string, unknown>;
  _score: number;
}

export interface BulkIndexItem {
  index?: {
    _id: string;
    error?: Record<string, unknown>;
  };
}
