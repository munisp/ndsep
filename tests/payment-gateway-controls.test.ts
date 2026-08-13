import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GatewayWebhookUnavailableError, listPaymentAuditEvents, reconcileGatewayWebhook, recordPaymentAuditExport, resetPaymentAuditForTests, reviewOfflinePayment, submitOfflinePayment } from "../server/offlinePaymentRepository";

process.env.PAYMENT_AUDIT_POSTGRES_URL = "postgresql://ubuntu@/idlr_payment_test?host=/var/run/postgresql";
const webhookSecret = "test-paystack-webhook-secret";

function signedPaystackWebhook(payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload);
  return { rawBody, signature: crypto.createHmac("sha512", webhookSecret).update(rawBody).digest("hex") };
}

beforeEach(async () => {
  process.env.PAYSTACK_WEBHOOK_SECRET = webhookSecret;
  process.env.PAYMENT_DUAL_CONTROL_THRESHOLD_KOBO = "1000000";
  await resetPaymentAuditForTests();
});
afterEach(async () => {
  delete process.env.PAYSTACK_WEBHOOK_SECRET;
  delete process.env.PAYMENT_DUAL_CONTROL_THRESHOLD_KOBO;
  await resetPaymentAuditForTests();
});

describe("payment gateway and dual-control controls", () => {
  it("fails closed without a gateway secret and only reconciles a valid signed, matching webhook once", async () => {
    const payment = await submitOfflinePayment({ applicantOpenId: "applicant-gateway", applicantName: "Amina Musa", reference: "LAG-GATEWAY-1001", amountKobo: 350000, service: "C of O statutory fee", evidenceDescription: "Bank transfer advice." });
    const payload = { id: "evt_paystack_1001", event: "charge.success", data: { id: "txn_1001", reference: "LAG-GATEWAY-1001", amount: 350000 } };
    const signed = signedPaystackWebhook(payload);

    delete process.env.PAYSTACK_WEBHOOK_SECRET;
    await expect(reconcileGatewayWebhook({ provider: "paystack", ...signed })).rejects.toBeInstanceOf(GatewayWebhookUnavailableError);
    process.env.PAYSTACK_WEBHOOK_SECRET = webhookSecret;
    await expect(reconcileGatewayWebhook({ provider: "paystack", ...signed })).resolves.toMatchObject({ state: "processed", reconciliationState: "matched", paymentId: payment.id });
    await expect(reconcileGatewayWebhook({ provider: "paystack", ...signed })).resolves.toMatchObject({ state: "duplicate" });
    await expect(reconcileGatewayWebhook({ provider: "paystack", rawBody: signed.rawBody, signature: "invalid" })).rejects.toThrow(/signature/i);
  });

  it("requires two distinct administrator approvals for a high-value payment and records audit exports", async () => {
    const payment = await submitOfflinePayment({ applicantOpenId: "applicant-dual", applicantName: "Chidi Okafor", reference: "FCT-DUAL-1001", amountKobo: 1500000, service: "Land premium", evidenceDescription: "High-value bank transfer advice." });
    expect(payment.dualControlRequired).toBe(true);
    const first = await reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-first", reason: "First review confirms the declared evidence." });
    expect(first.status).toBe("awaiting_second_approval");
    await expect(reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-first", reason: "Attempted self second approval." })).rejects.toThrow(/second administrator/i);
    const final = await reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-second", reason: "Independent second review confirms the evidence." });
    expect(final.status).toBe("approved");

    const events = await listPaymentAuditEvents({ aggregateType: "payment", limit: 20 });
    expect(events.map((event) => event.eventType)).toContain("offline_payment_first_approval");
    expect(events.map((event) => event.eventType)).toContain("offline_payment_second_approval");
    const exported = await recordPaymentAuditExport({ actorOpenId: "admin-second", filter: { aggregateType: "payment" }, rowCount: events.length });
    expect(exported.exportId).toBeTruthy();
    await expect(listPaymentAuditEvents({ aggregateType: "payment_audit_export", limit: 10 })).resolves.toHaveLength(1);
  });
});
