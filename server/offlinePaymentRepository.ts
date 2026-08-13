import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { runPaymentAuditMigrations } from "./paymentAuditMigrations";

export type OfflinePaymentStatus = "pending_review" | "approved" | "rejected";
export type ReceiptScanOutcome = "approved" | "pending_review" | "rejected" | "not_found";

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
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewReason: string | null;
};

export type PaymentAlert = {
  id: string;
  applicantOpenId: string;
  paymentId: string;
  type: "offline_payment_approved" | "offline_payment_rejected";
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type ReceiptScanRecord = {
  id: string;
  scannedBy: string;
  reference: string;
  paymentId: string | null;
  outcome: ReceiptScanOutcome;
  scannedAt: string;
};

type PaymentRow = {
  id: string; applicant_open_id: string; applicant_name: string | null; reference: string; amount_kobo: string | number; currency: "NGN"; service: string; evidence_description: string; status: OfflinePaymentStatus; submitted_at: Date; reviewed_at: Date | null; reviewed_by: string | null; review_reason: string | null;
};
type AlertRow = { id: string; applicant_open_id: string; payment_id: string; type: PaymentAlert["type"]; title: string; body: string; created_at: Date; read_at: Date | null };
type ScanRow = { id: string; scanned_by: string; reference: string; payment_id: string | null; outcome: ReceiptScanOutcome; scanned_at: Date };

const pools = new Map<string, Pool>();
const migrations = new Map<string, Promise<void>>();

function paymentAuditUrl() {
  const configured = process.env.PAYMENT_AUDIT_POSTGRES_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("Payment operations are unavailable: PAYMENT_AUDIT_POSTGRES_URL is required in production.");
  return "postgresql://ubuntu@/idlr_payment?host=/var/run/postgresql";
}

function poolFor(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000, application_name: "idlr-pts-payment-audit" });
    pools.set(url, pool);
  }
  return pool;
}

async function readyPool() {
  const url = paymentAuditUrl();
  const pool = poolFor(url);
  let migration = migrations.get(url);
  if (!migration) {
    migration = runPaymentAuditMigrations(pool);
    migrations.set(url, migration);
  }
  try {
    await migration;
    return pool;
  } catch (error) {
    migrations.delete(url);
    const message = error instanceof Error ? error.message : "unknown PostgreSQL error";
    throw new Error(`Payment operations are unavailable because the PostgreSQL audit store could not be initialized: ${message}`);
  }
}

function mapPayment(row: PaymentRow): OfflinePaymentRecord {
  return { id: row.id, applicantOpenId: row.applicant_open_id, applicantName: row.applicant_name, reference: row.reference, amountKobo: Number(row.amount_kobo), currency: row.currency, service: row.service, evidenceDescription: row.evidence_description, status: row.status, submittedAt: row.submitted_at.toISOString(), reviewedAt: row.reviewed_at?.toISOString() ?? null, reviewedBy: row.reviewed_by, reviewReason: row.review_reason };
}
function mapAlert(row: AlertRow): PaymentAlert { return { id: row.id, applicantOpenId: row.applicant_open_id, paymentId: row.payment_id, type: row.type, title: row.title, body: row.body, createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }; }
function mapScan(row: ScanRow): ReceiptScanRecord { return { id: row.id, scannedBy: row.scanned_by, reference: row.reference, paymentId: row.payment_id, outcome: row.outcome, scannedAt: row.scanned_at.toISOString() }; }
function normaliseReference(value: string) { return value.trim().toUpperCase(); }
function hashEvent(input: { aggregateType: string; aggregateId: string; sequence: number; eventType: string; occurredAt: string; previousHash: string | null; data: Record<string, unknown> }) { return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex"); }

async function appendEvent(client: PoolClient, input: { aggregateType: "payment" | "alert" | "receipt_scan"; aggregateId: string; eventType: string; actorOpenId: string | null; occurredAt: string; data: Record<string, unknown> }) {
  const prior = await client.query<{ sequence_number: string; event_hash: string }>("SELECT sequence_number, event_hash FROM payment_audit_events WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE", [input.aggregateType, input.aggregateId]);
  const sequence = prior.rowCount ? Number(prior.rows[0]!.sequence_number) + 1 : 1;
  const previousHash = prior.rowCount ? prior.rows[0]!.event_hash : null;
  const eventId = crypto.randomUUID();
  const eventHash = hashEvent({ aggregateType: input.aggregateType, aggregateId: input.aggregateId, sequence, eventType: input.eventType, occurredAt: input.occurredAt, previousHash, data: input.data });
  await client.query("INSERT INTO payment_audit_events (event_id, aggregate_type, aggregate_id, sequence_number, event_type, actor_open_id, payload, occurred_at, previous_event_hash, event_hash) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9,$10)", [eventId, input.aggregateType, input.aggregateId, sequence, input.eventType, input.actorOpenId, JSON.stringify(input.data), input.occurredAt, previousHash, eventHash]);
}

async function transaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const pool = await readyPool();
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function submitOfflinePayment(input: { applicantOpenId: string; applicantName: string | null; reference: string; amountKobo: number; service: string; evidenceDescription: string }) {
  const reference = normaliseReference(input.reference);
  if (!reference) throw new Error("A bank-transfer or cash-deposit reference is required.");
  const paymentId = crypto.randomUUID();
  const submittedAt = new Date().toISOString();
  return transaction(async (client) => {
    const duplicate = await client.query("SELECT 1 FROM offline_payment_records WHERE reference = $1", [reference]);
    if (duplicate.rowCount) throw new Error("That payment reference has already been submitted for review.");
    const inserted = await client.query<PaymentRow>("INSERT INTO offline_payment_records (id, applicant_open_id, applicant_name, reference, amount_kobo, currency, service, evidence_description, status, submitted_at) VALUES ($1::uuid,$2,$3,$4,$5,'NGN',$6,$7,'pending_review',$8::timestamptz) RETURNING *", [paymentId, input.applicantOpenId, input.applicantName, reference, input.amountKobo, input.service.trim(), input.evidenceDescription.trim(), submittedAt]);
    await appendEvent(client, { aggregateType: "payment", aggregateId: paymentId, eventType: "offline_payment_submitted", actorOpenId: input.applicantOpenId, occurredAt: submittedAt, data: { reference, amountKobo: input.amountKobo, currency: "NGN", service: input.service.trim() } });
    return mapPayment(inserted.rows[0]!);
  });
}

export async function listPendingOfflinePayments() {
  const pool = await readyPool();
  const result = await pool.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE status = 'pending_review' ORDER BY submitted_at DESC");
  return result.rows.map(mapPayment);
}

export async function getOfflinePaymentSummary() {
  const pool = await readyPool();
  const result = await pool.query<{ status: OfflinePaymentStatus; count: string }>("SELECT status, COUNT(*)::text AS count FROM offline_payment_records GROUP BY status");
  const counts = new Map(result.rows.map((row) => [row.status, Number(row.count)]));
  const pendingCount = counts.get("pending_review") ?? 0;
  const approvedCount = counts.get("approved") ?? 0;
  const rejectedCount = counts.get("rejected") ?? 0;
  return { pendingCount, approvedCount, rejectedCount, totalCount: pendingCount + approvedCount + rejectedCount };
}

export async function reviewOfflinePayment(input: { paymentId: string; decision: "approved" | "rejected"; reviewerOpenId: string; reason: string }) {
  return transaction(async (client) => {
    const existing = await client.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE id = $1::uuid FOR UPDATE", [input.paymentId]);
    const payment = existing.rows[0];
    if (!payment) throw new Error("The offline payment record no longer exists.");
    if (payment.status !== "pending_review") throw new Error("Only payment records awaiting review can be decided.");
    const reviewedAt = new Date().toISOString();
    const reason = input.reason.trim();
    const updated = await client.query<PaymentRow>("UPDATE offline_payment_records SET status = $2, reviewed_at = $3::timestamptz, reviewed_by = $4, review_reason = $5, version = version + 1, updated_at = now() WHERE id = $1::uuid AND status = 'pending_review' RETURNING *", [input.paymentId, input.decision, reviewedAt, input.reviewerOpenId, reason]);
    if (!updated.rowCount) throw new Error("The payment record changed before this review could be applied. Refresh and try again.");
    await appendEvent(client, { aggregateType: "payment", aggregateId: input.paymentId, eventType: `offline_payment_${input.decision}`, actorOpenId: input.reviewerOpenId, occurredAt: reviewedAt, data: { reason } });
    const alertId = crypto.randomUUID();
    const approved = input.decision === "approved";
    const title = approved ? "Offline payment approved" : "Offline payment requires attention";
    const body = approved ? `Your ${payment.service} payment declaration (${payment.reference}) was approved after administrator review.` : `Your ${payment.service} payment declaration (${payment.reference}) was rejected: ${reason}`;
    await client.query("INSERT INTO payment_alerts (id, applicant_open_id, payment_id, type, title, body, created_at) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::timestamptz)", [alertId, payment.applicant_open_id, input.paymentId, approved ? "offline_payment_approved" : "offline_payment_rejected", title, body, reviewedAt]);
    await appendEvent(client, { aggregateType: "alert", aggregateId: alertId, eventType: "payment_alert_created", actorOpenId: input.reviewerOpenId, occurredAt: reviewedAt, data: { paymentId: input.paymentId, type: approved ? "offline_payment_approved" : "offline_payment_rejected" } });
    return mapPayment(updated.rows[0]!);
  });
}

export async function listPaymentAlerts(applicantOpenId: string) {
  const pool = await readyPool();
  const result = await pool.query<AlertRow>("SELECT * FROM payment_alerts WHERE applicant_open_id = $1 ORDER BY created_at DESC", [applicantOpenId]);
  return result.rows.map(mapAlert);
}

export async function markPaymentAlertRead(input: { applicantOpenId: string; alertId: string }) {
  return transaction(async (client) => {
    const existing = await client.query<AlertRow>("SELECT * FROM payment_alerts WHERE id = $1::uuid AND applicant_open_id = $2 FOR UPDATE", [input.alertId, input.applicantOpenId]);
    const alert = existing.rows[0];
    if (!alert) throw new Error("The payment alert was not found for this account.");
    if (alert.read_at) return mapAlert(alert);
    const readAt = new Date().toISOString();
    const updated = await client.query<AlertRow>("UPDATE payment_alerts SET read_at = $2::timestamptz WHERE id = $1::uuid RETURNING *", [input.alertId, readAt]);
    await appendEvent(client, { aggregateType: "alert", aggregateId: input.alertId, eventType: "payment_alert_read", actorOpenId: input.applicantOpenId, occurredAt: readAt, data: { paymentId: alert.payment_id } });
    return mapAlert(updated.rows[0]!);
  });
}

export async function verifyReceiptAndRecordScan(input: { reference: string; scannedBy: string }) {
  const reference = normaliseReference(input.reference);
  if (!reference) throw new Error("The receipt QR code did not contain a payment reference.");
  return transaction(async (client) => {
    const found = await client.query<PaymentRow>("SELECT * FROM offline_payment_records WHERE reference = $1", [reference]);
    const payment = found.rows[0] ?? null;
    const outcome: ReceiptScanOutcome = !payment ? "not_found" : payment.status;
    const scanId = crypto.randomUUID();
    const scannedAt = new Date().toISOString();
    const scan = await client.query<ScanRow>("INSERT INTO payment_receipt_scans (id, scanned_by, reference, payment_id, outcome, scanned_at) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6::timestamptz) RETURNING *", [scanId, input.scannedBy, reference, payment?.id ?? null, outcome, scannedAt]);
    await appendEvent(client, { aggregateType: "receipt_scan", aggregateId: scanId, eventType: "receipt_scanned", actorOpenId: input.scannedBy, occurredAt: scannedAt, data: { reference, paymentId: payment?.id ?? null, outcome } });
    return { scan: mapScan(scan.rows[0]!), payment: payment ? { id: payment.id, reference: payment.reference, service: payment.service, amountKobo: Number(payment.amount_kobo), currency: payment.currency, status: payment.status, submittedAt: payment.submitted_at.toISOString(), reviewedAt: payment.reviewed_at?.toISOString() ?? null } : null };
  });
}

export async function listReceiptScanHistory(scannedBy: string, limit = 25) {
  const pool = await readyPool();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const result = await pool.query<ScanRow>("SELECT * FROM payment_receipt_scans WHERE scanned_by = $1 ORDER BY scanned_at DESC LIMIT $2", [scannedBy, safeLimit]);
  return result.rows.map(mapScan);
}

export async function resetPaymentAuditForTests() {
  const url = paymentAuditUrl();
  if (!url.includes("idlr_payment_test")) throw new Error("Payment audit reset is only permitted for the dedicated test database.");
  const pool = await readyPool();
  await pool.query("TRUNCATE TABLE payment_audit_events, payment_receipt_scans, payment_alerts, offline_payment_records RESTART IDENTITY CASCADE");
}
