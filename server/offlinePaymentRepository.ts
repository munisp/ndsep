import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

type OfflinePaymentStore = {
  version: 1;
  payments: OfflinePaymentRecord[];
  alerts: PaymentAlert[];
  scanHistory: ReceiptScanRecord[];
};

const STORE_VERSION = 1 as const;

function getStorePath() {
  return process.env.PAYMENT_OPERATIONS_STORE_PATH?.trim() || path.join(process.cwd(), "server", "data", "offline-payment-store.json");
}

function defaultStore(): OfflinePaymentStore {
  return { version: STORE_VERSION, payments: [], alerts: [], scanHistory: [] };
}

function ensureStoreDirectory() {
  fs.mkdirSync(path.dirname(getStorePath()), { recursive: true });
}

function isStore(value: unknown): value is OfflinePaymentStore {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OfflinePaymentStore>;
  return candidate.version === STORE_VERSION && Array.isArray(candidate.payments) && Array.isArray(candidate.alerts) && Array.isArray(candidate.scanHistory);
}

function readStore(): OfflinePaymentStore {
  const storePath = getStorePath();
  ensureStoreDirectory();

  if (!fs.existsSync(storePath)) {
    const store = defaultStore();
    writeStore(store);
    return store;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
    if (!isStore(parsed)) {
      throw new Error("Offline payment store schema is invalid");
    }
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown storage error";
    throw new Error(`Offline payment operations are unavailable because their audit store cannot be read safely: ${reason}`);
  }
}

function writeStore(store: OfflinePaymentStore) {
  const storePath = getStorePath();
  ensureStoreDirectory();
  const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, storePath);
}

function mutateStore<T>(mutator: (store: OfflinePaymentStore) => T): T {
  const store = readStore();
  const result = mutator(store);
  writeStore(store);
  return result;
}

function makeReference(input: string) {
  return input.trim().toUpperCase();
}

export function submitOfflinePayment(input: {
  applicantOpenId: string;
  applicantName: string | null;
  reference: string;
  amountKobo: number;
  service: string;
  evidenceDescription: string;
}) {
  const reference = makeReference(input.reference);
  if (!reference) throw new Error("A bank-transfer or cash-deposit reference is required.");

  return mutateStore((store) => {
    if (store.payments.some((payment) => payment.reference === reference)) {
      throw new Error("That payment reference has already been submitted for review.");
    }

    const record: OfflinePaymentRecord = {
      id: `offline-payment-${crypto.randomUUID()}`,
      applicantOpenId: input.applicantOpenId,
      applicantName: input.applicantName,
      reference,
      amountKobo: input.amountKobo,
      currency: "NGN",
      service: input.service.trim(),
      evidenceDescription: input.evidenceDescription.trim(),
      status: "pending_review",
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      reviewReason: null,
    };
    store.payments.push(record);
    return record;
  });
}

export function listPendingOfflinePayments() {
  return readStore().payments.filter((payment) => payment.status === "pending_review").sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

export function getOfflinePaymentSummary() {
  const payments = readStore().payments;
  return {
    pendingCount: payments.filter((payment) => payment.status === "pending_review").length,
    approvedCount: payments.filter((payment) => payment.status === "approved").length,
    rejectedCount: payments.filter((payment) => payment.status === "rejected").length,
    totalCount: payments.length,
  };
}

export function reviewOfflinePayment(input: {
  paymentId: string;
  decision: "approved" | "rejected";
  reviewerOpenId: string;
  reason: string;
}) {
  return mutateStore((store) => {
    const payment = store.payments.find((item) => item.id === input.paymentId);
    if (!payment) throw new Error("The offline payment record no longer exists.");
    if (payment.status !== "pending_review") throw new Error("Only payment records awaiting review can be decided.");

    payment.status = input.decision;
    payment.reviewedAt = new Date().toISOString();
    payment.reviewedBy = input.reviewerOpenId;
    payment.reviewReason = input.reason.trim();

    const approved = input.decision === "approved";
    store.alerts.push({
      id: `payment-alert-${crypto.randomUUID()}`,
      applicantOpenId: payment.applicantOpenId,
      paymentId: payment.id,
      type: approved ? "offline_payment_approved" : "offline_payment_rejected",
      title: approved ? "Offline payment approved" : "Offline payment requires attention",
      body: approved
        ? `Your ${payment.service} payment declaration (${payment.reference}) was approved after administrator review.`
        : `Your ${payment.service} payment declaration (${payment.reference}) was rejected: ${payment.reviewReason}`,
      createdAt: payment.reviewedAt,
      readAt: null,
    });

    return payment;
  });
}

export function listPaymentAlerts(applicantOpenId: string) {
  return readStore().alerts.filter((alert) => alert.applicantOpenId === applicantOpenId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function markPaymentAlertRead(input: { applicantOpenId: string; alertId: string }) {
  return mutateStore((store) => {
    const alert = store.alerts.find((item) => item.id === input.alertId && item.applicantOpenId === input.applicantOpenId);
    if (!alert) throw new Error("The payment alert was not found for this account.");
    if (!alert.readAt) alert.readAt = new Date().toISOString();
    return alert;
  });
}

export function verifyReceiptAndRecordScan(input: { reference: string; scannedBy: string }) {
  const reference = makeReference(input.reference);
  if (!reference) throw new Error("The receipt QR code did not contain a payment reference.");

  return mutateStore((store) => {
    const payment = store.payments.find((item) => item.reference === reference);
    const outcome: ReceiptScanOutcome = !payment
      ? "not_found"
      : payment.status === "approved"
        ? "approved"
        : payment.status;
    const scan: ReceiptScanRecord = {
      id: `receipt-scan-${crypto.randomUUID()}`,
      scannedBy: input.scannedBy,
      reference,
      paymentId: payment?.id ?? null,
      outcome,
      scannedAt: new Date().toISOString(),
    };
    store.scanHistory.push(scan);
    return {
      scan,
      payment: payment
        ? {
            id: payment.id,
            reference: payment.reference,
            service: payment.service,
            amountKobo: payment.amountKobo,
            currency: payment.currency,
            status: payment.status,
            submittedAt: payment.submittedAt,
            reviewedAt: payment.reviewedAt,
          }
        : null,
    };
  });
}

export function listReceiptScanHistory(scannedBy: string, limit = 25) {
  return readStore().scanHistory.filter((scan) => scan.scannedBy === scannedBy).sort((left, right) => right.scannedAt.localeCompare(left.scannedAt)).slice(0, Math.max(1, Math.min(limit, 100)));
}
