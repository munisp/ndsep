import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GatewayWebhookUnavailableError, listPaymentAuditEvents, reconcileGatewayWebhook, recordPaymentAuditExport, resetPaymentAuditForTests, reviewOfflinePayment, submitOfflinePayment, updatePaymentStateApprovalPolicy } from "../server/offlinePaymentRepository";
import { getGatewayActivationStatus } from "../server/paymentGatewayConfig";

process.env.PAYMENT_AUDIT_POSTGRES_URL = "postgresql://ubuntu@/idlr_payment_test?host=/var/run/postgresql";
const webhookSecret = "test-paystack-webhook-secret";

function signedPaystackWebhook(payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload);
  return { rawBody, signature: crypto.createHmac("sha512", webhookSecret).update(rawBody).digest("hex") };
}

beforeEach(async () => {
  process.env.PAYMENT_DUAL_CONTROL_THRESHOLD_KOBO = "1000000";
  await resetPaymentAuditForTests();
  await updatePaymentStateApprovalPolicy({ jurisdiction: "fct", highValueThresholdKobo: 1000000, firstApproverRole: "planning_supervisor", secondApproverRole: "environment_reviewer", updatedBy: "policy-admin" });
});
afterEach(async () => {
  delete process.env.PAYMENT_DUAL_CONTROL_THRESHOLD_KOBO;
  delete process.env.PAYMENT_GATEWAY_ACTIVE_PROVIDER;
  delete process.env.PAYMENT_GATEWAY_PUBLIC_BASE_URL;
  delete process.env.PAYSTACK_SECRET_KEY;
  await resetPaymentAuditForTests();
});

describe("payment gateway and dual-control controls", () => {
  it("fails closed until an HTTPS callback origin and server credential are configured", async () => {
    const payload = { id: "evt_paystack_1001", event: "charge.success", data: { id: "txn_1001", reference: "LAG-GATEWAY-1001", amount: 350000 } };
    const signed = signedPaystackWebhook(payload);
    process.env.PAYMENT_GATEWAY_ACTIVE_PROVIDER = "paystack";
    process.env.PAYMENT_GATEWAY_PUBLIC_BASE_URL = "http://localhost:3000";
    expect(getGatewayActivationStatus()).toMatchObject({ provider: "paystack", ready: false });
    await expect(reconcileGatewayWebhook({ provider: "paystack", ...signed })).rejects.toBeInstanceOf(GatewayWebhookUnavailableError);
    process.env.PAYMENT_GATEWAY_PUBLIC_BASE_URL = "https://land.example.gov.ng";
    process.env.PAYSTACK_SECRET_KEY = webhookSecret;
    expect(getGatewayActivationStatus()).toMatchObject({ provider: "paystack", callbackUrl: "https://land.example.gov.ng/api/gateway-webhooks/paystack", ready: true });
    await expect(reconcileGatewayWebhook({ provider: "paystack", rawBody: signed.rawBody, signature: "invalid" })).rejects.toThrow(/signature/i);
  });

  it("requires two distinct administrator approvals for a high-value payment and records audit exports", async () => {
    const payment = await submitOfflinePayment({ applicantOpenId: "applicant-dual", applicantName: "Chidi Okafor", jurisdiction: "fct", reference: "FCT-DUAL-1001", amountKobo: 1500000, service: "Land premium", evidenceDescription: "High-value bank transfer advice." });
    expect(payment.dualControlRequired).toBe(true);
    const first = await reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-first", reviewerRole: "planning_supervisor", reason: "First review confirms the declared evidence." });
    expect(first.status).toBe("awaiting_second_approval");
    await expect(reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-first", reviewerRole: "environment_reviewer", reason: "Attempted self second approval." })).rejects.toThrow(/second administrator/i);
    const final = await reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-second", reviewerRole: "environment_reviewer", reason: "Independent second review confirms the evidence." });
    expect(final.status).toBe("approved");

    const events = await listPaymentAuditEvents({ aggregateType: "payment", limit: 20 });
    expect(events.map((event) => event.eventType)).toContain("offline_payment_first_approval");
    expect(events.map((event) => event.eventType)).toContain("offline_payment_second_approval");
    const exported = await recordPaymentAuditExport({ actorOpenId: "admin-second", filter: { aggregateType: "payment" }, rowCount: events.length });
    expect(exported.exportId).toBeTruthy();
    await expect(listPaymentAuditEvents({ aggregateType: "payment_audit_export", limit: 10 })).resolves.toHaveLength(1);
  });

  it("uses the selected state policy rather than a global threshold or unqualified administrator role", async () => {
    await updatePaymentStateApprovalPolicy({ jurisdiction: "kano", highValueThresholdKobo: 2000000, firstApproverRole: "mining_reviewer", secondApproverRole: "petroleum_reviewer", updatedBy: "policy-admin" });
    const payment = await submitOfflinePayment({ applicantOpenId: "applicant-kano", applicantName: "Sani Bello", jurisdiction: "kano", reference: "KAN-POLICY-1001", amountKobo: 1500000, service: "Governor's consent fee", evidenceDescription: "Bank transfer advice for Kano policy review." });
    expect(payment.dualControlRequired).toBe(false);
    expect(payment.firstApproverRole).toBe("mining_reviewer");
    await expect(reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-planning", reviewerRole: "planning_supervisor", reason: "Attempted approval without the configured state role." })).rejects.toThrow(/mining_reviewer/i);
    await expect(reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-mining", reviewerRole: "mining_reviewer", reason: "Configured Kano first-stage review completed." })).resolves.toMatchObject({ status: "approved" });
  });
});
