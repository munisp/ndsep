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
  verifyReceiptAndRecordScan,
} from "../server/offlinePaymentRepository";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "idlr-payment-"));
const storePath = path.join(temporaryDirectory, "offline-payments.json");
process.env.PAYMENT_OPERATIONS_STORE_PATH = storePath;

beforeEach(() => fs.rmSync(storePath, { force: true }));
afterEach(() => fs.rmSync(storePath, { force: true }));

describe("offline payment operations", () => {
  it("counts pending records, records receipt checks, and notifies the owner only after an authorised decision", () => {
    const payment = submitOfflinePayment({
      applicantOpenId: "applicant-1",
      applicantName: "Amina Musa",
      reference: "ng-2026-001",
      amountKobo: 2500000,
      service: "Certificate of Occupancy statutory fee",
      evidenceDescription: "Bank transfer advice submitted for administrator review.",
    });

    expect(getOfflinePaymentSummary()).toMatchObject({ pendingCount: 1, approvedCount: 0, rejectedCount: 0, totalCount: 1 });
    expect(verifyReceiptAndRecordScan({ reference: "NG-2026-001", scannedBy: "admin-1" }).scan.outcome).toBe("pending_review");
    expect(listPaymentAlerts("applicant-1")).toHaveLength(0);

    reviewOfflinePayment({ paymentId: payment.id, decision: "approved", reviewerOpenId: "admin-1", reason: "Transfer evidence reconciled against the review record." });

    expect(getOfflinePaymentSummary()).toMatchObject({ pendingCount: 0, approvedCount: 1, rejectedCount: 0, totalCount: 1 });
    expect(verifyReceiptAndRecordScan({ reference: "ng-2026-001", scannedBy: "admin-1" }).scan.outcome).toBe("approved");
    expect(listPaymentAlerts("applicant-1")).toHaveLength(1);
    expect(listReceiptScanHistory("admin-1")).toHaveLength(2);
  });
});
