import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

type LegacyPayment = {
  id: string;
  applicantOpenId: string;
  applicantName: string | null;
  reference: string;
  amountKobo: number;
  currency: "NGN";
  service: string;
  evidenceDescription: string;
  status: "pending_review" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewReason: string | null;
};

type LegacyAlert = {
  id: string;
  applicantOpenId: string;
  paymentId: string;
  type: "offline_payment_approved" | "offline_payment_rejected";
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

type LegacyScan = {
  id: string;
  scannedBy: string;
  reference: string;
  paymentId: string | null;
  outcome: "approved" | "pending_review" | "rejected" | "not_found";
  scannedAt: string;
};

type LegacyStore = { version: 1; payments: LegacyPayment[]; alerts: LegacyAlert[]; scanHistory: LegacyScan[] };

function hashEvent(input: { aggregateType: string; aggregateId: string; sequence: number; eventType: string; occurredAt: string; previousHash: string | null; data: Record<string, unknown> }) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function legacyStorePath() {
  return process.env.PAYMENT_OPERATIONS_STORE_PATH?.trim() || path.join(process.cwd(), "server", "data", "offline-payment-store.json");
}

function readLegacyStore(): LegacyStore | null {
  const storePath = legacyStorePath();
  if (!fs.existsSync(storePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as Partial<LegacyStore>;
  if (parsed.version !== 1 || !Array.isArray(parsed.payments) || !Array.isArray(parsed.alerts) || !Array.isArray(parsed.scanHistory)) {
    throw new Error("The legacy payment audit file is invalid and was not imported into PostgreSQL.");
  }
  return parsed as LegacyStore;
}

const PAYMENT_AUDIT_DDL = [
  `CREATE TABLE IF NOT EXISTS offline_payment_records (
    id uuid PRIMARY KEY,
    applicant_open_id text NOT NULL,
    applicant_name text NULL,
    reference text NOT NULL UNIQUE,
    amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
    currency char(3) NOT NULL CHECK (currency = 'NGN'),
    service text NOT NULL,
    evidence_description text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected')),
    submitted_at timestamptz NOT NULL,
    reviewed_at timestamptz NULL,
    reviewed_by text NULL,
    review_reason text NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'pending_review' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_reason IS NULL) OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_reason IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS offline_payment_records_pending_idx ON offline_payment_records (submitted_at DESC) WHERE status = 'pending_review'`,
  `CREATE TABLE IF NOT EXISTS payment_alerts (
    id uuid PRIMARY KEY,
    applicant_open_id text NOT NULL,
    payment_id uuid NOT NULL REFERENCES offline_payment_records(id),
    type text NOT NULL CHECK (type IN ('offline_payment_approved', 'offline_payment_rejected')),
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL,
    read_at timestamptz NULL
  )`,
  `CREATE INDEX IF NOT EXISTS payment_alerts_applicant_idx ON payment_alerts (applicant_open_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS payment_receipt_scans (
    id uuid PRIMARY KEY,
    scanned_by text NOT NULL,
    reference text NOT NULL,
    payment_id uuid NULL REFERENCES offline_payment_records(id),
    outcome text NOT NULL CHECK (outcome IN ('approved', 'pending_review', 'rejected', 'not_found')),
    scanned_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS payment_receipt_scans_staff_idx ON payment_receipt_scans (scanned_by, scanned_at DESC)`,
  `CREATE TABLE IF NOT EXISTS payment_audit_events (
    event_id uuid PRIMARY KEY,
    aggregate_type text NOT NULL CHECK (aggregate_type IN ('payment', 'alert', 'receipt_scan', 'migration')),
    aggregate_id text NOT NULL,
    sequence_number bigint NOT NULL,
    event_type text NOT NULL,
    actor_open_id text NULL,
    payload jsonb NOT NULL,
    occurred_at timestamptz NOT NULL,
    previous_event_hash char(64) NULL,
    event_hash char(64) NOT NULL UNIQUE,
    CONSTRAINT payment_audit_events_sequence_unique UNIQUE (aggregate_type, aggregate_id, sequence_number)
  )`,
  `CREATE INDEX IF NOT EXISTS payment_audit_events_aggregate_idx ON payment_audit_events (aggregate_type, aggregate_id, sequence_number)`,
  `CREATE OR REPLACE FUNCTION reject_payment_audit_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'payment_audit_events are append-only' USING ERRCODE = '55000'; END; $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_audit_events_immutable') THEN
       CREATE TRIGGER payment_audit_events_immutable BEFORE UPDATE OR DELETE ON payment_audit_events FOR EACH ROW EXECUTE FUNCTION reject_payment_audit_event_mutation();
     END IF;
   END $$`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS dual_control_required boolean NOT NULL DEFAULT true`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS first_approved_at timestamptz NULL`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS first_approved_by text NULL`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS first_approval_reason text NULL`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS gateway_reconciliation_state text NOT NULL DEFAULT 'unavailable'`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS gateway_provider text NULL`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS gateway_event_id text NULL`,
  `ALTER TABLE offline_payment_records ADD COLUMN IF NOT EXISTS gateway_reconciled_at timestamptz NULL`,
  `ALTER TABLE offline_payment_records DROP CONSTRAINT IF EXISTS offline_payment_records_status_check`,
  `ALTER TABLE offline_payment_records DROP CONSTRAINT IF EXISTS offline_payment_records_check`,
  `ALTER TABLE offline_payment_records ADD CONSTRAINT offline_payment_records_status_check CHECK (
      status IN ('pending_review', 'awaiting_second_approval', 'approved', 'rejected') AND
      gateway_reconciliation_state IN ('unavailable', 'unmatched', 'matched', 'mismatch') AND
      ((status = 'pending_review' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_reason IS NULL AND first_approved_at IS NULL AND first_approved_by IS NULL AND first_approval_reason IS NULL) OR
       (status = 'awaiting_second_approval' AND dual_control_required = true AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_reason IS NULL AND first_approved_at IS NOT NULL AND first_approved_by IS NOT NULL AND first_approval_reason IS NOT NULL) OR
       (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_reason IS NOT NULL))
    )`,
  `CREATE INDEX IF NOT EXISTS offline_payment_records_dual_control_idx ON offline_payment_records (submitted_at DESC) WHERE status = 'awaiting_second_approval'`,
  `CREATE TABLE IF NOT EXISTS payment_gateway_webhook_deliveries (
      id uuid PRIMARY KEY,
      provider text NOT NULL CHECK (provider IN ('paystack', 'flutterwave')),
      gateway_event_id text NOT NULL,
      event_type text NOT NULL,
      reference text NULL,
      payload_sha256 char(64) NOT NULL,
      signature_algorithm text NOT NULL,
      reconciliation_state text NOT NULL CHECK (reconciliation_state IN ('ignored', 'unmatched_reference', 'matched', 'mismatch')),
      payment_id uuid NULL REFERENCES offline_payment_records(id),
      received_at timestamptz NOT NULL,
      CONSTRAINT payment_gateway_webhook_deliveries_provider_event_unique UNIQUE (provider, gateway_event_id)
    )`,
  `CREATE INDEX IF NOT EXISTS payment_gateway_webhook_deliveries_received_idx ON payment_gateway_webhook_deliveries (received_at DESC)`,
  `ALTER TABLE payment_audit_events DROP CONSTRAINT IF EXISTS payment_audit_events_aggregate_type_check`,
  `ALTER TABLE payment_audit_events ADD CONSTRAINT payment_audit_events_aggregate_type_check CHECK (aggregate_type IN ('payment', 'alert', 'receipt_scan', 'migration', 'gateway_webhook', 'payment_audit_export'))`,
];

async function appendLegacyEvent(client: PoolClient, input: { aggregateType: "payment" | "alert" | "receipt_scan" | "migration"; aggregateId: string; eventType: string; actorOpenId: string | null; occurredAt: string; payload: Record<string, unknown> }) {
  const prior = await client.query<{ sequence_number: string; event_hash: string }>("SELECT sequence_number, event_hash FROM payment_audit_events WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE", [input.aggregateType, input.aggregateId]);
  const sequence = prior.rowCount ? Number(prior.rows[0]!.sequence_number) + 1 : 1;
  const previousHash = prior.rowCount ? prior.rows[0]!.event_hash : null;
  const eventId = crypto.randomUUID();
  const eventHash = hashEvent({ ...input, sequence, previousHash, data: input.payload });
  await client.query(
    "INSERT INTO payment_audit_events (event_id, aggregate_type, aggregate_id, sequence_number, event_type, actor_open_id, payload, occurred_at, previous_event_hash, event_hash) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)",
    [eventId, input.aggregateType, input.aggregateId, sequence, input.eventType, input.actorOpenId, JSON.stringify(input.payload), input.occurredAt, previousHash, eventHash],
  );
}

async function importLegacyJsonStore(client: PoolClient) {
  const alreadyImported = await client.query("SELECT 1 FROM payment_audit_events WHERE aggregate_type = 'migration' AND aggregate_id = 'legacy_json_payment_store_v1' LIMIT 1");
  if (alreadyImported.rowCount) return;

  const legacy = readLegacyStore();
  if (legacy) {
    for (const payment of legacy.payments) {
      await client.query(
        `INSERT INTO offline_payment_records (id, applicant_open_id, applicant_name, reference, amount_kobo, currency, service, evidence_description, status, submitted_at, reviewed_at, reviewed_by, review_reason, version)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [payment.id.replace("offline-payment-", ""), payment.applicantOpenId, payment.applicantName, payment.reference, payment.amountKobo, payment.currency, payment.service, payment.evidenceDescription, payment.status, payment.submittedAt, payment.reviewedAt, payment.reviewedBy, payment.reviewReason, payment.status === "pending_review" ? 1 : 2],
      );
      const aggregateId = payment.id.replace("offline-payment-", "");
      await appendLegacyEvent(client, { aggregateType: "payment", aggregateId, eventType: "offline_payment_submitted", actorOpenId: payment.applicantOpenId, occurredAt: payment.submittedAt, payload: { reference: payment.reference, amountKobo: payment.amountKobo, currency: payment.currency, service: payment.service, importedFrom: "legacy_json" } });
      if (payment.status !== "pending_review" && payment.reviewedAt && payment.reviewedBy && payment.reviewReason) {
        await appendLegacyEvent(client, { aggregateType: "payment", aggregateId, eventType: `offline_payment_${payment.status}`, actorOpenId: payment.reviewedBy, occurredAt: payment.reviewedAt, payload: { reason: payment.reviewReason, importedFrom: "legacy_json" } });
      }
    }
    for (const alert of legacy.alerts) {
      const alertId = alert.id.replace("payment-alert-", "");
      await client.query("INSERT INTO payment_alerts (id, applicant_open_id, payment_id, type, title, body, created_at, read_at) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::timestamptz,$8::timestamptz) ON CONFLICT (id) DO NOTHING", [alertId, alert.applicantOpenId, alert.paymentId.replace("offline-payment-", ""), alert.type, alert.title, alert.body, alert.createdAt, alert.readAt]);
      await appendLegacyEvent(client, { aggregateType: "alert", aggregateId: alertId, eventType: "payment_alert_imported", actorOpenId: alert.applicantOpenId, occurredAt: alert.createdAt, payload: { paymentId: alert.paymentId, type: alert.type, importedFrom: "legacy_json" } });
    }
    for (const scan of legacy.scanHistory) {
      const scanId = scan.id.replace("receipt-scan-", "");
      await client.query("INSERT INTO payment_receipt_scans (id, scanned_by, reference, payment_id, outcome, scanned_at) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6::timestamptz) ON CONFLICT (id) DO NOTHING", [scanId, scan.scannedBy, scan.reference, scan.paymentId?.replace("offline-payment-", "") ?? null, scan.outcome, scan.scannedAt]);
      await appendLegacyEvent(client, { aggregateType: "receipt_scan", aggregateId: scanId, eventType: "receipt_scanned", actorOpenId: scan.scannedBy, occurredAt: scan.scannedAt, payload: { reference: scan.reference, outcome: scan.outcome, importedFrom: "legacy_json" } });
    }
  }

  await appendLegacyEvent(client, { aggregateType: "migration", aggregateId: "legacy_json_payment_store_v1", eventType: "legacy_json_import_completed", actorOpenId: null, occurredAt: new Date().toISOString(), payload: { sourcePresent: Boolean(legacy), sourcePath: legacyStorePath() } });
}

export async function runPaymentAuditMigrations(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(734209113)");
    for (const statement of PAYMENT_AUDIT_DDL) await client.query(statement);
    await client.query("BEGIN");
    await importLegacyJsonStore(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(734209113)").catch(() => undefined);
    client.release();
  }
}
