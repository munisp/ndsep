import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { getPaymentGatewayOperationalHealth, listHighRiskReconciliationAlerts, listPaymentAuditEvents, listPaymentReconciliationExceptions, processDueGatewayVerificationRetries, resetPaymentAuditForTests, resolvePaymentReconciliationException } from "../server/offlinePaymentRepository";

const testUrl = "postgresql://ubuntu@/idlr_payment_test?host=/var/run/postgresql";
process.env.PAYMENT_AUDIT_POSTGRES_URL = testUrl;
const pool = new Pool({ connectionString: testUrl });

beforeEach(async () => resetPaymentAuditForTests());
afterEach(async () => resetPaymentAuditForTests());
afterAll(async () => pool.end());

describe("payment reconciliation exceptions", () => {
  it("lists an unresolved verification exception, records a resolution, and leaves settlement evidence unchanged", async () => {
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO payment_gateway_webhook_deliveries (id, provider, gateway_event_id, event_type, reference, payload_sha256, signature_algorithm, reconciliation_state, verification_state, verification_error, exception_status, exception_opened_at, received_at) VALUES ($1::uuid,'paystack','evt-exception-1001','charge.success','LAG-EXCEPTION-1001',$2,'HMAC-SHA512','mismatch','failed','Provider verification timed out.','open',now(),now())", [id, "a".repeat(64)]);

    const open = await listPaymentReconciliationExceptions();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id, status: "open", reconciliationState: "mismatch", verificationState: "failed" });
    expect((await getPaymentGatewayOperationalHealth()).openExceptionCount).toBe(1);

    const resolved = await resolvePaymentReconciliationException({ deliveryId: id, decision: "resolved", note: "Bank operations confirmed that the provider retry was logged; no settlement status was changed.", actorOpenId: "admin-reconciliation" });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe("admin-reconciliation");
    expect((await listPaymentReconciliationExceptions()).length).toBe(0);
    expect((await listPaymentReconciliationExceptions({ status: "resolved" }))[0]).toMatchObject({ id, status: "resolved" });
    expect((await getPaymentGatewayOperationalHealth()).openExceptionCount).toBe(0);
    await expect(listPaymentAuditEvents({ aggregateType: "gateway_webhook", eventType: "gateway_reconciliation_exception_resolved" })).resolves.toHaveLength(1);
  });

  it("bounds transient retry scheduling and returns role-targeted high-risk alerts", async () => {
    const retryId = crypto.randomUUID(); const alertId = crypto.randomUUID();
    await pool.query("INSERT INTO payment_gateway_webhook_deliveries (id, provider, gateway_event_id, event_type, reference, payload_sha256, signature_algorithm, reconciliation_state, verification_state, exception_status, retry_status, retry_count, retry_after, received_at) VALUES ($1::uuid,'paystack','evt-retry-1001','charge.success','LAG-RETRY-1001',$2,'HMAC-SHA512','mismatch','failed','open','scheduled',1,now() - interval '1 minute',now())", [retryId, "b".repeat(64)]);
    await pool.query("INSERT INTO payment_reconciliation_role_alerts (id, delivery_id, target_role, severity, title, body, created_at) VALUES ($1::uuid,$2::uuid,'planning_supervisor','high','High-risk payment reconciliation exception','A mismatch requires review.',now())", [alertId, retryId]);
    const result = await processDueGatewayVerificationRetries();
    expect(result).toMatchObject({ dueCount: 1, retried: 1 });
    const retry = await pool.query<{ retry_status: string; retry_count: number; retry_after: Date | null }>("SELECT retry_status, retry_count, retry_after FROM payment_gateway_webhook_deliveries WHERE id = $1::uuid", [retryId]);
    expect(retry.rows[0]).toMatchObject({ retry_status: "scheduled", retry_count: 2 }); expect(retry.rows[0]?.retry_after).not.toBeNull();
    await expect(listHighRiskReconciliationAlerts("planning_supervisor")).resolves.toMatchObject([{ id: alertId, severity: "high", targetRole: "planning_supervisor" }]);
  });
});
