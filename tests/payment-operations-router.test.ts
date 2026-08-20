import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "../server/_core/context";
import { appRouter } from "../server/routers";
import { resetPaymentAuditForTests, updatePaymentStateApprovalPolicy } from "../server/offlinePaymentRepository";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "idlr-payment-router-"));
const storePath = path.join(temporaryDirectory, "offline-payments.json");
process.env.PAYMENT_OPERATIONS_STORE_PATH = storePath;
process.env.PAYMENT_AUDIT_POSTGRES_URL = "postgresql://ubuntu@/idlr_payment_test?host=/var/run/postgresql";

function contextFor(openId: string, role: "user" | "admin", enterprise = false): TrpcContext {
  return {
    user: {
      id: role === "admin" ? 2 : 1,
      openId,
      email: `${openId}@example.test`,
      name: role === "admin" ? "Payment Administrator" : "Amina Musa",
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
    enterprise: enterprise ? { subject: openId, issuer: "https://issuer.example.test", agencyId: "lagos-land", agencyRoles: ["planning_supervisor"], authMethod: "local_development", mfaAuthenticated: true } : undefined,
  };
}

beforeEach(async () => {
  fs.rmSync(storePath, { force: true });
  await resetPaymentAuditForTests();
  await updatePaymentStateApprovalPolicy({ jurisdiction: "lagos", highValueThresholdKobo: 5000000, firstApproverRole: "planning_supervisor", secondApproverRole: "environment_reviewer", updatedBy: "policy-admin" });
});
afterEach(async () => {
  fs.rmSync(storePath, { force: true });
  await resetPaymentAuditForTests();
});

describe("payment operation routes", () => {
  it("keeps applicant alerts account-scoped while allowing only an administrator to review and scan a receipt", async () => {
    const applicant = appRouter.createCaller(contextFor("applicant-1", "user"));
    const administrator = appRouter.createCaller(contextFor("admin-1", "admin", true));

    const submitted = await applicant.paymentOperations.submitOfflinePayment({
      jurisdiction: "lagos",
      reference: "LAG-COO-2026-001",
      amountKobo: 2500000,
      service: "Certificate of Occupancy statutory fee",
      evidenceDescription: "Bank transfer advice submitted for independent administrator review.",
    });

    expect(await applicant.paymentOperations.myAlerts()).toEqual([]);
    expect((await administrator.paymentOperations.pendingSummary()).pendingCount).toBe(1);
    await expect(applicant.paymentOperations.gatewayHealth()).rejects.toThrow();
    await expect(applicant.paymentOperations.reconciliationExceptions({ status: "open", limit: 10 })).rejects.toThrow();

    await administrator.paymentOperations.review({ paymentId: submitted.id, decision: "approved", reviewerRole: "planning_supervisor", reason: "Transfer advice reconciled with the administrative review record." });
    const alerts = await applicant.paymentOperations.myAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.readAt).toBeNull();

    const scan = await administrator.paymentOperations.verifyReceiptAndLog({ reference: "lag-coo-2026-001" });
    expect(scan.scan.outcome).toBe("approved");
    expect((await administrator.paymentOperations.scanHistory({ limit: 25 }))[0]?.reference).toBe("LAG-COO-2026-001");
    await expect(applicant.paymentOperations.auditEvents({ limit: 25 })).rejects.toThrow();
    const auditEvents = await administrator.paymentOperations.auditEvents({ aggregateType: "payment", limit: 25 });
    expect(auditEvents.some((event) => event.eventType === "offline_payment_approved")).toBe(true);
    const exported = await administrator.paymentOperations.exportAuditEvents({ aggregateType: "payment" });
    expect(exported.csv).toContain("offline_payment_approved");
    expect(exported.rowCount).toBeGreaterThan(0);
  });
});
