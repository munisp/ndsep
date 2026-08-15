import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getOfflinePaymentSummary,
  listPaymentAlerts,
  listReceiptScanHistory,
  reviewOfflinePayment,
  submitOfflinePayment,
  updatePaymentStateApprovalPolicy,
  verifyReceiptAndRecordScan,
} from "../server/offlinePaymentRepository";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "idlr-payment-"));
const storePath = path.join(temporaryDirectory, "offline-payments.json");
process.env.PAYMENT_OPERATIONS_STORE_PATH = storePath;
process.env.PAYMENT_AUDIT_POSTGRES_URL = "postgresql://ubuntu@/idlr_payment_test?host=/var/run/postgresql";

beforeEach(async () => {
  const { resetPaymentAuditForTests } = await import("../server/offlinePaymentRepository");
  await resetPaymentAuditForTests();
  await updatePaymentStateApprovalPolicy({ jurisdiction: "lagos", highValueThresholdKobo: 5000000, firstApproverRole: "planning_supervisor", secondApproverRole: "environment_reviewer", updatedBy: "policy-admin" });
});
afterEach(async () => {
  const { resetPaymentAuditForTests } = await import("../server/offlinePaymentRepository");
  await resetPaymentAuditForTests();
});

describe("offline payment operations", () => {
  it("counts pending records, records receipt checks, and notifies the owner only after an authorised decision", async () => {
    const payment = await submitOfflinePayment({
      applicantOpenId: "applicant-1",
      applicantName: "Amina Musa",
      jurisdiction: "lagos",
      reference: "ng-2026-001",
      amountKobo: 2500000,
      service: "Certificate of Occupancy statutory fee",
      evidenceDescription: "Bank transfer advice submitted for administrator review.",
    });

    await expect(getOfflinePaymentSummary()).resolves.toMatchObject({ pendingCount: 1, approvedCount: 0, rejectedCount: 0, totalCount: 1 });
    await expect(verifyReceiptAndRecordScan({ reference: "NG-2026-001", scannedBy: "admin-1" })).resolves.toMatchObject({ scan: { outcome: "pending_review" } });
    await expect(listPaymentAlerts("applicant-1")).resolves.toHaveLength(0);

    await reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-1", reviewerRole: "planning_supervisor", reason: "Transfer evidence reconciled against the review record." });

    await expect(getOfflinePaymentSummary()).resolves.toMatchObject({ pendingCount: 0, approvedCount: 1, rejectedCount: 0, totalCount: 1 });
    await expect(verifyReceiptAndRecordScan({ reference: "ng-2026-001", scannedBy: "admin-1" })).resolves.toMatchObject({ scan: { outcome: "approved" } });
    await expect(listPaymentAlerts("applicant-1")).resolves.toHaveLength(1);
    await expect(listReceiptScanHistory("admin-1")).resolves.toHaveLength(2);
  });
});
