import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { runPaymentAuditMigrations } from "./paymentAuditMigrations";
import { GatewayProviderUnavailableError, GatewayTransactionVerificationError, getGatewayActivationStatus, getGatewayWebhookSecret, reverifyGatewayTransaction } from "./paymentGatewayConfig";

export type OfflinePaymentStatus = "pending_review" | "awaiting_second_approval" | "approved" | "rejected";
export type ReceiptScanOutcome = OfflinePaymentStatus | "not_found";
export type GatewayProvider = "paystack" | "flutterwave";
export type GatewayReconciliationState = "unavailable" | "unmatched" | "matched" | "mismatch";
export type PaymentSettlementStatus = "unverified" | "verified" | "verification_failed" | "unavailable";
export const PAYMENT_JURISDICTIONS = ["lagos", "fct", "kano"] as const;
export type PaymentJurisdiction = (typeof PAYMENT_JURISDICTIONS)[number];
export const PAYMENT_APPROVAL_ROLES = ["mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"] as const;
export type PaymentApprovalRole = (typeof PAYMENT_APPROVAL_ROLES)[number];
export type PaymentStateApprovalPolicy = { jurisdiction: PaymentJurisdiction; highValueThresholdKobo: number; firstApproverRole: PaymentApprovalRole; secondApproverRole: PaymentApprovalRole; version: number; updatedBy: string; updatedAt: string };

export type OfflinePaymentRecord = {
  id: string;
  applicantOpenId: string;
  applicantName: string | null;
  reference: string;
  amountKobo: number;
  currency: "NGN";
  service: string;
  evidenceDescription: string;
  status: OfflinePaymentStatus;
  dualControlRequired: boolean;
  firstApprovedAt: string | null;
  firstApprovedBy: string | null;
  firstApprovalReason: string | null;
  gatewayReconciliationState: GatewayReconciliationState;
  gatewayProvider: GatewayProvider | null;
  gatewayEventId: string | null;
  gatewayReconciledAt: string | null;
  settlementStatus: PaymentSettlementStatus;
  settlementVerifiedAt: string | null;
  gatewayVerifiedTransactionId: string | null;
  jurisdiction: PaymentJurisdiction | null;
  approvalPolicyVersion: number | null;
  firstApproverRole: PaymentApprovalRole | null;
  secondApproverRole: PaymentApprovalRole | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewReason: string | null;
};

export type PaymentAlert = { id: string; applicantOpenId: string; paymentId: string; type: "offline_payment_approved" | "offline_payment_rejected"; title: string; body: string; createdAt: string; readAt: string | null };
export type ReceiptScanRecord = { id: string; scannedBy: string; reference: string; paymentId: string | null; outcome: ReceiptScanOutcome; scannedAt: string };
export type PaymentAuditEvent = { eventId: string; aggregateType: string; aggregateId: string; sequenceNumber: number; eventType: string; actorOpenId: string | null; payload: Record<string, unknown>; occurredAt: string; previousEventHash: string | null; eventHash: string };
export type PaymentAuditFilter = { aggregateType?: string | null; eventType?: string | null; actorOpenId?: string | null; from?: string | null; to?: string | null; limit?: number };
export type GatewayWebhookResult = { state: "processed" | "duplicate"; provider: GatewayProvider; eventId: string; reconciliationState: "ignored" | "unmatched_reference" | "matched" | "mismatch"; settlementStatus: PaymentSettlementStatus | null; paymentId: string | null };
export type ReconciliationExceptionStatus = "open" | "resolved" | "dismissed";
export type PaymentReconciliationException = { id: string; provider: GatewayProvider; gatewayEventId: string; eventType: string; reference: string | null; paymentId: string | null; reconciliationState: "unmatched_reference" | "mismatch"; verificationState: "failed" | "unavailable" | "unverified"; verificationError: string | null; receivedAt: string; status: ReconciliationExceptionStatus; openedAt: string | null; resolvedAt: string | null; resolvedBy: string | null; resolutionNote: string | null };
export type PaymentGatewayOperationalHealth = { activation: ReturnType<typeof getGatewayActivationStatus>; connectionHealth: "unavailable" | "configured_not_yet_verified" | "recent_verification" | "stale_verification"; lastWebhookAt: string | null; lastVerifiedAt: string | null; openExceptionCount: number };
export type ReconciliationRetryStatus = "not_scheduled" | "scheduled" | "in_progress" | "succeeded" | "exhausted" | "blocked";
export type ReconciliationRoleAlert = { id: string; deliveryId: string; targetRole: PaymentApprovalRole; severity: "high"; title: string; body: string; createdAt: string; readAt: string | null };

export class GatewayWebhookUnavailableError extends Error { constructor() { super("Gateway reconciliation is unavailable because no signature secret is configured for this provider."); } }
export class GatewayWebhookSignatureError extends Error { constructor() { super("Gateway webhook signature validation failed."); } }

type PaymentRow = {
  id: string; applicant_open_id: string; applicant_name: string | null; reference: string; amount_kobo: string | number; currency: "NGN"; service: string; evidence_description: string; status: OfflinePaymentStatus; dual_control_required: boolean; first_approved_at: Date | null; first_approved_by: string | null; first_approval_reason: string | null; gateway_reconciliation_state: GatewayReconciliationState; gateway_provider: GatewayProvider | null; gateway_event_id: string | null; gateway_reconciled_at: Date | null; settlement_status: PaymentSettlementStatus; settlement_verified_at: Date | null; gateway_verified_transaction_id: string | null; jurisdiction: PaymentJurisdiction | null; approval_policy_version: string | number | null; first_approver_role: PaymentApprovalRole | null; second_approver_role: PaymentApprovalRole | null; submitted_at: Date; reviewed_at: Date | null; reviewed_by: string | null; review_reason: string | null;
};
type PolicyRow = { jurisdiction: PaymentJurisdiction; high_value_threshold_kobo: string | number; first_approver_role: PaymentApprovalRole; second_approver_role: PaymentApprovalRole; version: string | number; updated_by: string; updated_at: Date };
type AlertRow = { id: string; applicant_open_id: string; payment_id: string; type: PaymentAlert["type"]; title: string; body: string; created_at: Date; read_at: Date | null };
type ScanRow = { id: string; scanned_by: string; reference: string; payment_id: string | null; outcome: ReceiptScanOutcome; scanned_at: Date };
type AuditRow = { event_id: string; aggregate_type: string; aggregate_id: string; sequence_number: string | number; event_type: string; actor_open_id: string | null; payload: Record<string, unknown>; occurred_at: Date; previous_event_hash: string | null; event_hash: string };
type DeliveryRow = { id: string; provider: GatewayProvider; gateway_event_id: string; event_type: string; reference: string | null; reconciliation_state: "ignored" | "unmatched_reference" | "matched" | "mismatch"; verification_state: "unverified" | "verified" | "failed" | "unavailable"; verification_error: string | null; payment_id: string | null; received_at: Date; exception_status: "not_exception" | ReconciliationExceptionStatus; exception_opened_at: Date | null; exception_resolved_at: Date | null; exception_resolved_by: string | null; exception_resolution_note: string | null; provider_transaction_id: string | null; retry_status: ReconciliationRetryStatus; retry_count: number; retry_after: Date | null; retry_last_error: string | null };
type RoleAlertRow = { id: string; delivery_id: string; target_role: PaymentApprovalRole; severity: "high"; title: string; body: string; created_at: Date; read_at: Date | null };

const pools = new Map<string, Pool>();
const migrations = new Map<string, Promise<void>>();

function paymentAuditUrl() {
  const configured = process.env.PAYMENT_AUDIT_POSTGRES_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("Payment operations are unavailable: PAYMENT_AUDIT_POSTGRES_URL is required in production.");
  return "postgresql://ubuntu@/idlr_payment?host=/var/run/postgresql";
}
function highValueThresholdKobo() {
  const candidate = Number.parseInt(process.env.PAYMENT_DUAL_CONTROL_THRESHOLD_KOBO ?? "50000000", 10);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : 50_000_000;
}
function poolFor(url: string) { let pool = pools.get(url); if (!pool) { pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000, application_name: "idlr-pts-payment-audit" }); pools.set(url, pool); } return pool; }
async function readyPool() { const url = paymentAuditUrl(); const pool = poolFor(url); let migration = migrations.get(url); if (!migration) { migration = runPaymentAuditMigrations(pool); migrations.set(url, migration); } try { await migration; return pool; } catch (error) { migrations.delete(url); const message = error instanceof Error ? error.message : "unknown PostgreSQL error"; throw new Error(`Payment operations are unavailable because the PostgreSQL audit store could not be initialized: ${message}`); } }

function mapPayment(row: PaymentRow): OfflinePaymentRecord {
  return { id: row.id, applicantOpenId: row.applicant_open_id, applicantName: row.applicant_name, reference: row.reference, amountKobo: Number(row.amount_kobo), currency: row.currency, service: row.service, evidenceDescription: row.evidence_description, status: row.status, dualControlRequired: row.dual_control_required, firstApprovedAt: row.first_approved_at?.toISOString() ?? null, firstApprovedBy: row.first_approved_by, firstApprovalReason: row.first_approval_reason, gatewayReconciliationState: row.gateway_reconciliation_state, gatewayProvider: row.gateway_provider, gatewayEventId: row.gateway_event_id, gatewayReconciledAt: row.gateway_reconciled_at?.toISOString() ?? null, settlementStatus: row.settlement_status, settlementVerifiedAt: row.settlement_verified_at?.toISOString() ?? null, gatewayVerifiedTransactionId: row.gateway_verified_transaction_id, jurisdiction: row.jurisdiction, approvalPolicyVersion: row.approval_policy_version === null ? null : Number(row.approval_policy_version), firstApproverRole: row.first_approver_role, secondApproverRole: row.second_approver_role, submittedAt: row.submitted_at.toISOString(), reviewedAt: row.reviewed_at?.toISOString() ?? null, reviewedBy: row.reviewed_by, reviewReason: row.review_reason };
}
function mapPolicy(row: PolicyRow): PaymentStateApprovalPolicy { return { jurisdiction: row.jurisdiction, highValueThresholdKobo: Number(row.high_value_threshold_kobo), firstApproverRole: row.first_approver_role, secondApproverRole: row.second_approver_role, version: Number(row.version), updatedBy: row.updated_by, updatedAt: row.updated_at.toISOString() }; }
function mapAlert(row: AlertRow): PaymentAlert { return { id: row.id, applicantOpenId: row.applicant_open_id, paymentId: row.payment_id, type: row.type, title: row.title, body: row.body, createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }; }
function mapScan(row: ScanRow): ReceiptScanRecord { return { id: row.id, scannedBy: row.scanned_by, reference: row.reference, paymentId: row.payment_id, outcome: row.outcome, scannedAt: row.scanned_at.toISOString() }; }
function mapAudit(row: AuditRow): PaymentAuditEvent { return { eventId: row.event_id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, sequenceNumber: Number(row.sequence_number), eventType: row.event_type, actorOpenId: row.actor_open_id, payload: row.payload, occurredAt: row.occurred_at.toISOString(), previousEventHash: row.previous_event_hash, eventHash: row.event_hash }; }
function mapException(row: DeliveryRow): PaymentReconciliationException { return { id: row.id, provider: row.provider, gatewayEventId: row.gateway_event_id, eventType: row.event_type, reference: row.reference, paymentId: row.payment_id, reconciliationState: row.reconciliation_state as "unmatched_reference" | "mismatch", verificationState: row.verification_state as "failed" | "unavailable" | "unverified", verificationError: row.verification_error, receivedAt: row.received_at.toISOString(), status: row.exception_status as ReconciliationExceptionStatus, openedAt: row.exception_opened_at?.toISOString() ?? null, resolvedAt: row.exception_resolved_at?.toISOString() ?? null, resolvedBy: row.exception_resolved_by, resolutionNote: row.exception_resolution_note }; }
function mapRoleAlert(row: RoleAlertRow): ReconciliationRoleAlert { return { id: row.id, deliveryId: row.delivery_id, targetRole: row.target_role, severity: row.severity, title: row.title, body: row.body, createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }; }
function normaliseReference(value: string) { return value.trim().toUpperCase(); }
function hashEvent(input: { aggregateType: string; aggregateId: string; sequence: number; eventType: string; occurredAt: string; previousHash: string | null; data: Record<string, unknown> }) { return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex"); }

async function appendEvent(client: PoolClient, input: { aggregateType: "payment" | "alert" | "receipt_scan" | "gateway_webhook" | "payment_audit_export" | "payment_policy"; aggregateId: string; eventType: string; actorOpenId: string | null; occurredAt: string; data: Record<string, unknown> }) {
  const prior = await client.query<{ sequence_number: string; event_hash: string }>("SELECT sequence_number, event_hash FROM payment_audit_events WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE", [input.aggregateType, input.aggregateId]);
  const sequence = prior.rowCount ? Number(prior.rows[0]!.sequence_number) + 1 : 1;
  const previousHash = prior.rowCount ? prior.rows[0]!.event_hash : null;
  const eventId = crypto.randomUUID();
  const eventHash = hashEvent({ aggregateType: input.aggregateType, aggregateId: input.aggregateId, sequence, eventType: input.eventType, occurredAt: input.occurredAt, previousHash, data: input.data });
  await client.query("INSERT INTO payment_audit_events (event_id, aggregate_type, aggregate_id, sequence_number, event_type, actor_open_id, payload, occurred_at, previous_event_hash, event_hash) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9,$10)", [eventId, input.aggregateType, input.aggregateId, sequence, input.eventType, input.actorOpenId, JSON.stringify(input.data), input.occurredAt, previousHash, eventHash]);
}
const MAX_RECONCILIATION_RETRIES = 3;
function retryAfterForAttempt(attempt: number) { return new Date(Date.now() + ([5, 15, 60][Math.max(0, attempt - 1)] ?? 60) * 60_000).toISOString(); }
function isTransientVerificationError(message: string | null) { return Boolean(message && (/timed out|unavailable|network|HTTP 5\d\d/i.test(message))); }
async function createHighRiskRoleAlerts(client: PoolClient, input: { deliveryId: string; reference: string | null; reconciliationState: string; verificationError: string | null; occurredAt: string; roles: PaymentApprovalRole[] }) {
  for (const role of [...new Set(input.roles)]) { const id = crypto.randomUUID(); const title = "High-risk payment reconciliation exception"; const body = `${input.reference ?? "A webhook delivery"} requires review: ${input.reconciliationState}${input.verificationError ? `; ${input.verificationError}` : ""}. Settlement status has not changed.`; await client.query("INSERT INTO payment_reconciliation_role_alerts (id, delivery_id, target_role, severity, title, body, created_at) VALUES ($1::uuid,$2::uuid,$3,'high',$4,$5,$6::timestamptz) ON CONFLICT (delivery_id, target_role) DO NOTHING", [id, input.deliveryId, role, title, body, input.occurredAt]); }
}
async function transaction<T>(operation: (client: PoolClient) => Promise<T>) { const pool = await readyPool(); const client = await pool.connect(); try { await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); const result = await operation(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }

export async function listPaymentStateApprovalPolicies() { const pool = await readyPool(); const result = await pool.query<PolicyRow>("SELECT * FROM payment_state_approval_policies ORDER BY jurisdiction ASC"); return result.rows.map(mapPolicy); }
export async function updatePaymentStateApprovalPolicy(input: { jurisdiction: PaymentJurisdiction; highValueThresholdKobo: number; firstApproverRole: PaymentApprovalRole; secondApproverRole: PaymentApprovalRole; updatedBy: string }) {
  if (input.firstApproverRole === input.secondApproverRole) throw new Error("The first and second payment approval roles must be different.");
  return transaction(async (client) => { const result = await client.query<PolicyRow>("INSERT INTO payment_state_approval_policies (jurisdiction, high_value_threshold_kobo, first_approver_role, second_approver_role, version, updated_by, updated_at) VALUES ($1,$2,$3,$4,1,$5,now()) ON CONFLICT (jurisdiction) DO UPDATE SET high_value_threshold_kobo = EXCLUDED.high_value_threshold_kobo, first_approver_role = EXCLUDED.first_approver_role, second_approver_role = EXCLUDED.second_approver_role, version = payment_state_approval_policies.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *", [input.jurisdiction, input.highValueThresholdKobo, input.firstApproverRole, input.secondApproverRole, input.updatedBy]); const policy = mapPolicy(result.rows[0]!); await appendEvent(client, { aggregateType: "payment_policy", aggregateId: policy.jurisdiction, eventType: "payment_state_policy_updated", actorOpenId: input.updatedBy, occurredAt: policy.updatedAt, data: { highValueThresholdKobo: policy.highValueThresholdKobo, firstApproverRole: policy.firstApproverRole, secondApproverRole: policy.secondApproverRole, version: policy.version } }); return policy; });
}
async function requirePaymentStatePolicy(jurisdiction: PaymentJurisdiction) { const pool = await readyPool(); const result = await pool.query<PolicyRow>("SELECT * FROM payment_state_approval_policies WHERE jurisdiction = $1", [jurisdiction]); if (!result.rowCount) throw new Error(`Payment approvals are unavailable for ${jurisdiction.toUpperCase()} until an authorised administrator configures the high-value threshold and two distinct approval roles.`); return mapPolicy(result.rows[0]!); }

export async function submitOfflinePayment(input: { applicantOpenId: string; applicantName: string | null; jurisdiction: PaymentJurisdiction; reference: string; amountKobo: number; service: string; evidenceDescription: string }) {
  const reference = normaliseReference(input.reference);
  if (!reference) throw new Error("A bank-transfer or cash-deposit reference is required.");
  const policy = await requirePaymentStatePolicy(input.jurisdiction); const paymentId = crypto.randomUUID(); const submittedAt = new Date().toISOString(); const dualControlRequired = input.amountKobo >= policy.highValueThresholdKobo;
  return transaction(async (client) => {
    const duplicate = await client.query("SELECT 1 FROM offline_payment_records WHERE reference = $1", [reference]);
    if (duplicate.rowCount) throw new Error("That payment reference has already been submitted for review.");
    const inserted = await client.query<PaymentRow>("INSERT INTO offline_payment_records (id, applicant_open_id, applicant_name, reference, amount_kobo, currency, service, evidence_description, status, dual_control_required, jurisdiction, approval_policy_version, first_approver_role, second_approver_role, submitted_at) VALUES ($1::uuid,$2,$3,$4,$5,'NGN',$6,$7,'pending_review',$8,$9,$10,$11,$12,$13::timestamptz) RETURNING *", [paymentId, input.applicantOpenId, input.applicantName, reference, input.amountKobo, input.service.trim(), input.evidenceDescription.trim(), dualControlRequired, policy.jurisdiction, policy.version, policy.firstApproverRole, policy.secondApproverRole, submittedAt]);
    await appendEvent(client, { aggregateType: "payment", aggregateId: paymentId, eventType: "offline_payment_submitted", actorOpenId: input.applicantOpenId, occurredAt: submittedAt, data: { reference, amountKobo: input.amountKobo, currency: "NGN", service: input.service.trim(), jurisdiction: policy.jurisdiction, approvalPolicyVersion: policy.version, dualControlRequired, dualControlThresholdKobo: policy.highValueThresholdKobo, firstApproverRole: policy.firstApproverRole, secondApproverRole: policy.secondApproverRole } });
    return mapPayment(inserted.rows[0]!);
  });
}

export async function listPendingOfflinePayments() { const pool = await readyPool(); const result = await pool.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE status IN ('pending_review', 'awaiting_second_approval') ORDER BY submitted_at DESC"); return result.rows.map(mapPayment); }
export async function getOfflinePaymentSummary() {
  const pool = await readyPool(); const result = await pool.query<{ status: OfflinePaymentStatus; count: string }>("SELECT status, COUNT(*)::text AS count FROM offline_payment_records GROUP BY status"); const counts = new Map(result.rows.map((row) => [row.status, Number(row.count)]));
  const pendingCount = counts.get("pending_review") ?? 0; const awaitingSecondApprovalCount = counts.get("awaiting_second_approval") ?? 0; const approvedCount = counts.get("approved") ?? 0; const rejectedCount = counts.get("rejected") ?? 0;
  return { pendingCount, awaitingSecondApprovalCount, approvedCount, rejectedCount, totalCount: pendingCount + awaitingSecondApprovalCount + approvedCount + rejectedCount, highValueThresholdKobo: highValueThresholdKobo() };
}

async function createDecisionAlert(client: PoolClient, payment: PaymentRow, paymentId: string, decision: "approved" | "rejected", reviewerOpenId: string, reason: string, reviewedAt: string) {
  const alertId = crypto.randomUUID(); const approved = decision === "approved"; const title = approved ? "Offline payment approved" : "Offline payment requires attention"; const body = approved ? `Your ${payment.service} payment declaration (${payment.reference}) was approved after administrator review.` : `Your ${payment.service} payment declaration (${payment.reference}) was rejected: ${reason}`;
  await client.query("INSERT INTO payment_alerts (id, applicant_open_id, payment_id, type, title, body, created_at) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::timestamptz)", [alertId, payment.applicant_open_id, paymentId, approved ? "offline_payment_approved" : "offline_payment_rejected", title, body, reviewedAt]);
  await appendEvent(client, { aggregateType: "alert", aggregateId: alertId, eventType: "payment_alert_created", actorOpenId: reviewerOpenId, occurredAt: reviewedAt, data: { paymentId, type: approved ? "offline_payment_approved" : "offline_payment_rejected" } });
}

export async function reviewOfflinePayment(input: { paymentId: string; decision: "approved" | "rejected"; reviewerOpenId: string; reviewerRole: PaymentApprovalRole; reason: string }) {
  return transaction(async (client) => {
    const existing = await client.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE id = $1::uuid FOR UPDATE", [input.paymentId]); const payment = existing.rows[0];
    if (!payment) throw new Error("The offline payment record no longer exists.");
    if (payment.status !== "pending_review" && payment.status !== "awaiting_second_approval") throw new Error("Only payment records awaiting an authorised review can be decided.");
    if (!payment.jurisdiction || !payment.first_approver_role || !payment.second_approver_role) throw new Error("This payment record predates state approval policy controls and must be remediated by an authorised administrator before review.");
    const reviewedAt = new Date().toISOString(); const reason = input.reason.trim(); if (reason.length < 3) throw new Error("A concise review reason is required.");
    const requiredRole = payment.status === "awaiting_second_approval" ? payment.second_approver_role : payment.first_approver_role;
    if (input.reviewerRole !== requiredRole) throw new Error(`The ${payment.jurisdiction.toUpperCase()} policy requires ${requiredRole} for this approval stage.`);
    if (input.decision === "approved" && payment.status === "pending_review" && payment.dual_control_required) {
      const staged = await client.query<PaymentRow>("UPDATE offline_payment_records SET status = 'awaiting_second_approval', first_approved_at = $2::timestamptz, first_approved_by = $3, first_approval_reason = $4, version = version + 1, updated_at = now() WHERE id = $1::uuid AND status = 'pending_review' RETURNING *", [input.paymentId, reviewedAt, input.reviewerOpenId, reason]);
      if (!staged.rowCount) throw new Error("The payment record changed before the first approval could be applied. Refresh and try again.");
      await appendEvent(client, { aggregateType: "payment", aggregateId: input.paymentId, eventType: "offline_payment_first_approval", actorOpenId: input.reviewerOpenId, occurredAt: reviewedAt, data: { reason, reviewerRole: input.reviewerRole, dualControlRequired: true } });
      return mapPayment(staged.rows[0]!);
    }
    if (input.decision === "approved" && payment.status === "awaiting_second_approval" && payment.first_approved_by === input.reviewerOpenId) throw new Error("A second administrator who did not provide the first approval must approve this high-value payment.");
    const updated = await client.query<PaymentRow>("UPDATE offline_payment_records SET status = $2, reviewed_at = $3::timestamptz, reviewed_by = $4, review_reason = $5, version = version + 1, updated_at = now() WHERE id = $1::uuid AND status IN ('pending_review', 'awaiting_second_approval') RETURNING *", [input.paymentId, input.decision, reviewedAt, input.reviewerOpenId, reason]);
    if (!updated.rowCount) throw new Error("The payment record changed before this review could be applied. Refresh and try again.");
    await appendEvent(client, { aggregateType: "payment", aggregateId: input.paymentId, eventType: input.decision === "approved" && payment.status === "awaiting_second_approval" ? "offline_payment_second_approval" : `offline_payment_${input.decision}`, actorOpenId: input.reviewerOpenId, occurredAt: reviewedAt, data: { reason, reviewerRole: input.reviewerRole, firstApprovedBy: payment.first_approved_by } });
    await createDecisionAlert(client, payment, input.paymentId, input.decision, input.reviewerOpenId, reason, reviewedAt);
    return mapPayment(updated.rows[0]!);
  });
}

export async function listPaymentAlerts(applicantOpenId: string) { const pool = await readyPool(); const result = await pool.query<AlertRow>("SELECT * FROM payment_alerts WHERE applicant_open_id = $1 ORDER BY created_at DESC", [applicantOpenId]); return result.rows.map(mapAlert); }
export async function markPaymentAlertRead(input: { applicantOpenId: string; alertId: string }) { return transaction(async (client) => { const existing = await client.query<AlertRow>("SELECT * FROM payment_alerts WHERE id = $1::uuid AND applicant_open_id = $2 FOR UPDATE", [input.alertId, input.applicantOpenId]); const alert = existing.rows[0]; if (!alert) throw new Error("The payment alert was not found for this account."); if (alert.read_at) return mapAlert(alert); const readAt = new Date().toISOString(); const updated = await client.query<AlertRow>("UPDATE payment_alerts SET read_at = $2::timestamptz WHERE id = $1::uuid RETURNING *", [input.alertId, readAt]); await appendEvent(client, { aggregateType: "alert", aggregateId: input.alertId, eventType: "payment_alert_read", actorOpenId: input.applicantOpenId, occurredAt: readAt, data: { paymentId: alert.payment_id } }); return mapAlert(updated.rows[0]!); }); }

export async function verifyReceiptAndRecordScan(input: { reference: string; scannedBy: string }) {
  const reference = normaliseReference(input.reference); if (!reference) throw new Error("The receipt QR code did not contain a payment reference.");
  return transaction(async (client) => { const found = await client.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE reference = $1", [reference]); const payment = found.rows[0] ?? null; const outcome: ReceiptScanOutcome = !payment ? "not_found" : payment.status; const scanId = crypto.randomUUID(); const scannedAt = new Date().toISOString(); const scan = await client.query<ScanRow>("INSERT INTO payment_receipt_scans (id, scanned_by, reference, payment_id, outcome, scanned_at) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6::timestamptz) RETURNING *", [scanId, input.scannedBy, reference, payment?.id ?? null, outcome, scannedAt]); await appendEvent(client, { aggregateType: "receipt_scan", aggregateId: scanId, eventType: "receipt_scanned", actorOpenId: input.scannedBy, occurredAt: scannedAt, data: { reference, paymentId: payment?.id ?? null, outcome } }); return { scan: mapScan(scan.rows[0]!), payment: payment ? mapPayment(payment) : null }; });
}
export async function listReceiptScanHistory(scannedBy: string, limit = 25) { const pool = await readyPool(); const safeLimit = Math.max(1, Math.min(limit, 100)); const result = await pool.query<ScanRow>("SELECT * FROM payment_receipt_scans WHERE scanned_by = $1 ORDER BY scanned_at DESC LIMIT $2", [scannedBy, safeLimit]); return result.rows.map(mapScan); }

function gatewaySecret(provider: GatewayProvider) { try { return getGatewayWebhookSecret(provider); } catch (error) { if (error instanceof GatewayProviderUnavailableError) throw new GatewayWebhookUnavailableError(); throw error; } }
function safeSignatureEqual(expected: string, supplied: string) { const expectedBytes = Buffer.from(expected); const suppliedBytes = Buffer.from(supplied); return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes); }
function verifyGatewaySignature(provider: GatewayProvider, rawBody: string, suppliedSignature: string) { const secret = gatewaySecret(provider); const expected = provider === "paystack" ? crypto.createHmac("sha512", secret).update(rawBody).digest("hex") : crypto.createHmac("sha256", secret).update(rawBody).digest("base64"); if (!safeSignatureEqual(expected, suppliedSignature)) throw new GatewayWebhookSignatureError(); }
function getPayloadObject(rawBody: string) { try { const parsed = JSON.parse(rawBody) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid"); return parsed as { id?: unknown; event?: unknown; type?: unknown; timestamp?: unknown; data?: Record<string, unknown> }; } catch { throw new Error("Gateway webhook payload is not valid JSON."); } }
function asText(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberValue(value: unknown) { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }

export async function reconcileGatewayWebhook(input: { provider: GatewayProvider; rawBody: string; signature: string }) {
  verifyGatewaySignature(input.provider, input.rawBody, input.signature); const payload = getPayloadObject(input.rawBody); const data = payload.data ?? {}; const eventType = asText(input.provider === "paystack" ? payload.event : payload.type) ?? "unknown"; const reference = normaliseReference(asText(input.provider === "paystack" ? data.reference : (data.tx_ref ?? data.reference)) ?? "");
  const providerEventId = asText(payload.id) ?? asText(data.id) ?? (reference && eventType !== "unknown" ? `${eventType}:${reference}:${asText(payload.timestamp) ?? asText(data.paid_at) ?? "undated"}` : null); if (!providerEventId) throw new Error("Gateway webhook payload did not include a stable event identifier.");
  const success = input.provider === "paystack" ? eventType === "charge.success" : eventType === "charge.completed" && ["succeeded", "successful"].includes((asText(data.status) ?? "").toLowerCase()); const receivedAt = new Date().toISOString(); const payloadHash = crypto.createHash("sha256").update(input.rawBody).digest("hex");
  const pool = await readyPool(); let candidate: PaymentRow | null = null; let verification: Awaited<ReturnType<typeof reverifyGatewayTransaction>> | null = null; let verificationError: string | null = null;
  if (success && reference) {
    const result = await pool.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE reference = $1", [reference]); candidate = result.rows[0] ?? null;
    if (candidate) {
      try { verification = await reverifyGatewayTransaction({ provider: input.provider, reference, providerTransactionId: asText(data.id), expectedAmountKobo: Number(candidate.amount_kobo), expectedCurrency: candidate.currency }); }
      catch (error) { if (error instanceof GatewayProviderUnavailableError) throw new GatewayWebhookUnavailableError(); verificationError = error instanceof GatewayTransactionVerificationError ? error.message : "Gateway re-verification was unavailable."; }
    }
  }
  return transaction(async (client) => {
    const deliveryId = crypto.randomUUID(); const providerTransactionId = asText(data.id); const delivery = await client.query<{ id: string }>("INSERT INTO payment_gateway_webhook_deliveries (id, provider, gateway_event_id, event_type, reference, payload_sha256, signature_algorithm, reconciliation_state, verification_state, provider_transaction_id, received_at) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,'ignored','unverified',$8,$9::timestamptz) ON CONFLICT (provider, gateway_event_id) DO NOTHING RETURNING id", [deliveryId, input.provider, providerEventId, eventType, reference || null, payloadHash, input.provider === "paystack" ? "HMAC-SHA512" : "HMAC-SHA256", providerTransactionId, receivedAt]);
    if (!delivery.rowCount) return { state: "duplicate", provider: input.provider, eventId: providerEventId, reconciliationState: "ignored", settlementStatus: null, paymentId: null } satisfies GatewayWebhookResult;
    let reconciliationState: GatewayWebhookResult["reconciliationState"] = "ignored"; let settlementStatus: PaymentSettlementStatus | null = null; let paymentId: string | null = null;
    if (success && reference) {
      const paymentResult = await client.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE reference = $1 FOR UPDATE", [reference]); const payment = paymentResult.rows[0] ?? null;
      if (!payment) reconciliationState = "unmatched_reference";
      else if (!verification || verification.reference !== payment.reference || verification.amountKobo !== Number(payment.amount_kobo) || verification.currency !== payment.currency) { reconciliationState = "mismatch"; settlementStatus = "verification_failed"; paymentId = payment.id; await client.query("UPDATE offline_payment_records SET gateway_reconciliation_state = 'mismatch', gateway_provider = $2, gateway_event_id = $3, gateway_reconciled_at = $4::timestamptz, settlement_status = 'verification_failed', updated_at = now() WHERE id = $1::uuid", [payment.id, input.provider, providerEventId, receivedAt]); }
      else { reconciliationState = "matched"; settlementStatus = "verified"; paymentId = payment.id; await client.query("UPDATE offline_payment_records SET gateway_reconciliation_state = 'matched', gateway_provider = $2, gateway_event_id = $3, gateway_reconciled_at = $4::timestamptz, settlement_status = 'verified', settlement_verified_at = $4::timestamptz, gateway_verified_transaction_id = $5, updated_at = now() WHERE id = $1::uuid", [payment.id, input.provider, providerEventId, receivedAt, verification.providerTransactionId]); }
    }
    const exceptionStatus = reconciliationState === "unmatched_reference" || reconciliationState === "mismatch" || Boolean(verificationError) ? "open" : "not_exception"; const retryStatus: ReconciliationRetryStatus = verificationError && isTransientVerificationError(verificationError) ? "scheduled" : "not_scheduled"; const retryAfter = retryStatus === "scheduled" ? retryAfterForAttempt(1) : null;
    await client.query("UPDATE payment_gateway_webhook_deliveries SET reconciliation_state = $2, payment_id = $3::uuid, verification_state = $4, verified_transaction_id = $5, verification_error = $6, exception_status = $7, exception_opened_at = CASE WHEN $7 = 'open' THEN $8::timestamptz ELSE NULL END, retry_status = $9, retry_count = CASE WHEN $9 = 'scheduled' THEN 1 ELSE 0 END, retry_after = $10::timestamptz, retry_last_error = $6 WHERE id = $1::uuid", [deliveryId, reconciliationState, paymentId, settlementStatus === "verified" ? "verified" : verificationError ? "failed" : "unverified", verification?.providerTransactionId ?? null, verificationError, exceptionStatus, receivedAt, retryStatus, retryAfter]);
    await appendEvent(client, { aggregateType: "gateway_webhook", aggregateId: deliveryId, eventType: "gateway_webhook_received", actorOpenId: null, occurredAt: receivedAt, data: { provider: input.provider, providerEventId, eventType, reference: reference || null, payloadSha256: payloadHash, reconciliationState, settlementStatus, providerReverified: settlementStatus === "verified" } });
    if (paymentId) await appendEvent(client, { aggregateType: "payment", aggregateId: paymentId, eventType: settlementStatus === "verified" ? "gateway_settlement_reverified" : "gateway_settlement_verification_failed", actorOpenId: null, occurredAt: receivedAt, data: { provider: input.provider, providerEventId, payloadSha256: payloadHash, reconciliationState, settlementStatus, verificationError } });
    if (retryStatus === "scheduled") await appendEvent(client, { aggregateType: "gateway_webhook", aggregateId: deliveryId, eventType: "gateway_verification_retry_scheduled", actorOpenId: null, occurredAt: receivedAt, data: { attempt: 1, retryAfter, maxAttempts: MAX_RECONCILIATION_RETRIES } });
    if (exceptionStatus === "open" && (reconciliationState === "mismatch" || Boolean(verificationError))) { const roleResult = paymentId ? await client.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE id = $1::uuid", [paymentId]) : { rows: [] as PaymentRow[] }; const paymentForRoles = roleResult.rows[0]; const roles = paymentForRoles ? [paymentForRoles.first_approver_role ?? "planning_supervisor", paymentForRoles.second_approver_role ?? "planning_supervisor"] : ["planning_supervisor"] as PaymentApprovalRole[]; await createHighRiskRoleAlerts(client, { deliveryId, reference: reference || null, reconciliationState, verificationError, occurredAt: receivedAt, roles }); await appendEvent(client, { aggregateType: "gateway_webhook", aggregateId: deliveryId, eventType: "gateway_high_risk_exception_alerted", actorOpenId: null, occurredAt: receivedAt, data: { rolesTargeted: roles, settlementStatusUnchanged: true } }); }
    return { state: "processed", provider: input.provider, eventId: providerEventId, reconciliationState, settlementStatus, paymentId } satisfies GatewayWebhookResult;
  });
}

export async function listPaymentReconciliationExceptions(input: { status?: ReconciliationExceptionStatus | "all"; limit?: number } = {}) {
  const pool = await readyPool(); const status = input.status ?? "open"; const limit = Math.max(1, Math.min(input.limit ?? 100, 500)); const where = status === "all" ? "exception_status IN ('open', 'resolved', 'dismissed')" : "exception_status = $1"; const values: unknown[] = status === "all" ? [limit] : [status, limit]; const limitIndex = values.length;
  const result = await pool.query<DeliveryRow>(`SELECT * FROM payment_gateway_webhook_deliveries WHERE ${where} ORDER BY received_at DESC LIMIT $${limitIndex}`, values); return result.rows.map(mapException);
}

export async function resolvePaymentReconciliationException(input: { deliveryId: string; decision: "resolved" | "dismissed"; note: string; actorOpenId: string }) {
  const note = input.note.trim(); if (note.length < 3) throw new Error("Record a concise exception resolution note.");
  return transaction(async (client) => { const existing = await client.query<DeliveryRow>("SELECT * FROM payment_gateway_webhook_deliveries WHERE id = $1::uuid FOR UPDATE", [input.deliveryId]); const delivery = existing.rows[0]; if (!delivery) throw new Error("The reconciliation exception was not found."); if (delivery.exception_status !== "open") throw new Error("Only open reconciliation exceptions can be resolved or dismissed."); const resolvedAt = new Date().toISOString(); const updated = await client.query<DeliveryRow>("UPDATE payment_gateway_webhook_deliveries SET exception_status = $2, exception_resolved_at = $3::timestamptz, exception_resolved_by = $4, exception_resolution_note = $5 WHERE id = $1::uuid RETURNING *", [input.deliveryId, input.decision, resolvedAt, input.actorOpenId, note]); await appendEvent(client, { aggregateType: "gateway_webhook", aggregateId: input.deliveryId, eventType: input.decision === "resolved" ? "gateway_reconciliation_exception_resolved" : "gateway_reconciliation_exception_dismissed", actorOpenId: input.actorOpenId, occurredAt: resolvedAt, data: { decision: input.decision, note, reconciliationState: delivery.reconciliation_state, verificationState: delivery.verification_state, settlementStatusUnchanged: true } }); return mapException(updated.rows[0]!); });
}

export async function getPaymentGatewayOperationalHealth(): Promise<PaymentGatewayOperationalHealth> {
  const activation = getGatewayActivationStatus(); const pool = await readyPool(); const result = await pool.query<{ last_webhook_at: Date | null; last_verified_at: Date | null; open_exceptions: string }>("SELECT MAX(received_at) AS last_webhook_at, MAX(CASE WHEN verification_state = 'verified' THEN received_at ELSE NULL END) AS last_verified_at, COUNT(*) FILTER (WHERE exception_status = 'open')::text AS open_exceptions FROM payment_gateway_webhook_deliveries"); const row = result.rows[0]!; const lastVerifiedAt = row.last_verified_at?.toISOString() ?? null; const ageMs = row.last_verified_at ? Date.now() - row.last_verified_at.getTime() : null; const connectionHealth = !activation.ready ? "unavailable" : ageMs === null ? "configured_not_yet_verified" : ageMs <= 24 * 60 * 60 * 1000 ? "recent_verification" : "stale_verification"; return { activation, connectionHealth, lastWebhookAt: row.last_webhook_at?.toISOString() ?? null, lastVerifiedAt, openExceptionCount: Number(row.open_exceptions) }; 
}

export async function listHighRiskReconciliationAlerts(role: PaymentApprovalRole, limit = 50) { const pool = await readyPool(); const safeLimit = Math.max(1, Math.min(limit, 100)); const result = await pool.query<RoleAlertRow>("SELECT * FROM payment_reconciliation_role_alerts WHERE target_role = $1 ORDER BY created_at DESC LIMIT $2", [role, safeLimit]); return result.rows.map(mapRoleAlert); }

export async function processDueGatewayVerificationRetries(limit = 10) {
  const pool = await readyPool(); const due = await pool.query<DeliveryRow>("SELECT * FROM payment_gateway_webhook_deliveries WHERE retry_status = 'scheduled' AND retry_after <= now() ORDER BY retry_after ASC LIMIT $1", [Math.max(1, Math.min(limit, 50))]); let retried = 0; let blocked = 0; let exhausted = 0;
  for (const delivery of due.rows) { const claimed = await pool.query<DeliveryRow>("UPDATE payment_gateway_webhook_deliveries SET retry_status = 'in_progress' WHERE id = $1::uuid AND retry_status = 'scheduled' RETURNING *", [delivery.id]); if (!claimed.rowCount) continue; retried += 1; const current = claimed.rows[0]!; const paymentResult = current.payment_id ? await pool.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE id = $1::uuid", [current.payment_id]) : { rows: [] as PaymentRow[] }; const payment = paymentResult.rows[0]; const now = new Date().toISOString(); try { if (!payment || !current.reference) throw new GatewayTransactionVerificationError("A linked payment record and reference are required for retry verification."); const verified = await reverifyGatewayTransaction({ provider: current.provider, reference: current.reference, providerTransactionId: current.provider_transaction_id, expectedAmountKobo: Number(payment.amount_kobo), expectedCurrency: payment.currency }); await transaction(async (client) => { await client.query("UPDATE payment_gateway_webhook_deliveries SET retry_status = 'succeeded', retry_after = NULL, retry_last_error = NULL, verification_state = 'verified', verified_transaction_id = $2 WHERE id = $1::uuid", [current.id, verified.providerTransactionId]); await client.query("UPDATE offline_payment_records SET settlement_status = 'verified', settlement_verified_at = $2::timestamptz, gateway_verified_transaction_id = $3, updated_at = now() WHERE id = $1::uuid", [payment.id, now, verified.providerTransactionId]); await appendEvent(client, { aggregateType: "gateway_webhook", aggregateId: current.id, eventType: "gateway_verification_retry_succeeded", actorOpenId: null, occurredAt: now, data: { attempt: current.retry_count, settlementReverified: true } }); }); } catch (error) { const message = error instanceof Error ? error.message : "Gateway retry failed."; const unavailable = error instanceof GatewayProviderUnavailableError; const nextAttempt = current.retry_count + 1; const nextStatus: ReconciliationRetryStatus = unavailable ? "blocked" : nextAttempt > MAX_RECONCILIATION_RETRIES ? "exhausted" : "scheduled"; const nextAfter = nextStatus === "scheduled" ? retryAfterForAttempt(nextAttempt) : null; if (nextStatus === "blocked") blocked += 1; if (nextStatus === "exhausted") exhausted += 1; await transaction(async (client) => { await client.query("UPDATE payment_gateway_webhook_deliveries SET retry_status = $2, retry_count = $3, retry_after = $4::timestamptz, retry_last_error = $5 WHERE id = $1::uuid", [current.id, nextStatus, nextAttempt, nextAfter, message]); await appendEvent(client, { aggregateType: "gateway_webhook", aggregateId: current.id, eventType: nextStatus === "scheduled" ? "gateway_verification_retry_rescheduled" : `gateway_verification_retry_${nextStatus}`, actorOpenId: null, occurredAt: now, data: { attempt: nextAttempt, retryAfter: nextAfter, error: message, settlementStatusUnchanged: true } }); }); }
  }
  return { dueCount: due.rowCount, retried, blocked, exhausted };
}

export async function listPaymentAuditEvents(filter: PaymentAuditFilter = {}) {
  const pool = await readyPool(); const clauses: string[] = []; const values: unknown[] = [];
  const add = (fragment: string, value: unknown) => { values.push(value); clauses.push(fragment.replace("?", `$${values.length}`)); };
  if (filter.aggregateType) add("aggregate_type = ?", filter.aggregateType); if (filter.eventType) add("event_type = ?", filter.eventType); if (filter.actorOpenId) add("actor_open_id = ?", filter.actorOpenId); if (filter.from) add("occurred_at >= ?::timestamptz", filter.from); if (filter.to) add("occurred_at <= ?::timestamptz", filter.to);
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500)); values.push(limit); const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query<AuditRow>(`SELECT * FROM payment_audit_events ${where} ORDER BY occurred_at DESC, aggregate_type DESC, sequence_number DESC LIMIT $${values.length}`, values); return result.rows.map(mapAudit);
}
export async function recordPaymentAuditExport(input: { actorOpenId: string; filter: PaymentAuditFilter; rowCount: number }) { return transaction(async (client) => { const exportId = crypto.randomUUID(); const occurredAt = new Date().toISOString(); await appendEvent(client, { aggregateType: "payment_audit_export", aggregateId: exportId, eventType: "payment_audit_events_exported", actorOpenId: input.actorOpenId, occurredAt, data: { filter: { aggregateType: input.filter.aggregateType ?? null, eventType: input.filter.eventType ?? null, actorOpenId: input.filter.actorOpenId ?? null, from: input.filter.from ?? null, to: input.filter.to ?? null }, rowCount: input.rowCount } }); return { exportId, occurredAt }; }); }

export async function resetPaymentAuditForTests() { const url = paymentAuditUrl(); if (!url.includes("idlr_payment_test")) throw new Error("Payment audit reset is only permitted for the dedicated test database."); const pool = await readyPool(); await pool.query("TRUNCATE TABLE payment_audit_events, payment_gateway_webhook_deliveries, payment_receipt_scans, payment_alerts, offline_payment_records RESTART IDENTITY CASCADE"); }
