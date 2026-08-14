import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { resetPaymentAuditForTests, reviewOfflinePayment, submitOfflinePayment, updatePaymentStateApprovalPolicy } from "../server/offlinePaymentRepository";

const testUrl = "postgresql://ubuntu@/idlr_payment_test?host=/var/run/postgresql";
process.env.PAYMENT_AUDIT_POSTGRES_URL = testUrl;
const pool = new Pool({ connectionString: testUrl });

beforeEach(async () => { await resetPaymentAuditForTests(); await updatePaymentStateApprovalPolicy({ jurisdiction: "fct", highValueThresholdKobo: 5000000, firstApproverRole: "planning_supervisor", secondApproverRole: "environment_reviewer", updatedBy: "policy-admin" }); });
afterEach(async () => resetPaymentAuditForTests());
afterAll(async () => pool.end());

describe("PostgreSQL payment audit integrity", () => {
  it("writes an ordered submission, decision, and alert trail that cannot be edited or deleted", async () => {
    const payment = await submitOfflinePayment({ applicantOpenId: "applicant-a", applicantName: "Amina Musa", jurisdiction: "fct", reference: "FCT-COO-1001", amountKobo: 1250000, service: "Certificate of Occupancy statutory fee", evidenceDescription: "Transfer advice supplied for review." });
    await reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-a", reviewerRole: "planning_supervisor", reason: "Evidence reconciled against the administrative review record." });

    const events = await pool.query<{ aggregate_type: string; event_type: string; sequence_number: string; event_hash: string }>("SELECT aggregate_type, event_type, sequence_number, event_hash FROM payment_audit_events ORDER BY aggregate_type, sequence_number");
    expect(events.rows.map((event) => event.event_type).sort()).toEqual(["offline_payment_approved", "offline_payment_submitted", "payment_alert_created", "payment_state_policy_updated"].sort());
    const paymentEvents = events.rows.filter((event) => event.aggregate_type === "payment");
    expect(paymentEvents.map((event) => event.event_type)).toEqual(["offline_payment_submitted", "offline_payment_approved"]);
    expect(paymentEvents.map((event) => event.sequence_number)).toEqual(["1", "2"]);
    expect(events.rows.every((event) => /^[a-f0-9]{64}$/.test(event.event_hash))).toBe(true);

    const paymentEventId = await pool.query<{ event_id: string }>("SELECT event_id FROM payment_audit_events WHERE aggregate_type = 'payment' ORDER BY sequence_number LIMIT 1");
    await expect(pool.query("UPDATE payment_audit_events SET event_type = 'altered' WHERE event_id = $1::uuid", [paymentEventId.rows[0]?.event_id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM payment_audit_events WHERE event_id = $1::uuid", [paymentEventId.rows[0]?.event_id])).rejects.toThrow(/append-only/);
  });
});
