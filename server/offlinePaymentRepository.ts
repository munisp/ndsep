/**
 * Offline Payment Repository
 * Persists manually marked offline payments for administrator review.
 * All records are explicitly UNVERIFIED until an administrator approves them.
 */
import * as fs from "fs";
import * as path from "path";

export interface OfflinePaymentRecord {
  id: string;
  referenceNumber: string;
  amount: number;
  currency: string;
  feeCategory: string;
  description: string;
  method: "cash" | "bank_transfer" | "other";
  applicantId: string;
  markedAt: string;
  markedBy: string;
  status: "pending_review" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  verified: false; // Always false — cannot be verified without gateway
}

const STORE_PATH = path.join(__dirname, "data", "offline-payments.json");

function loadStore(): OfflinePaymentRecord[] {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function saveStore(records: OfflinePaymentRecord[]) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2));
}

export function markPaymentOffline(input: {
  referenceNumber: string;
  amount: number;
  currency: string;
  feeCategory: string;
  description: string;
  method: "cash" | "bank_transfer" | "other";
  applicantId: string;
}): OfflinePaymentRecord {
  const records = loadStore();
  const record: OfflinePaymentRecord = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
    markedAt: new Date().toISOString(),
    markedBy: input.applicantId,
    status: "pending_review",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    verified: false,
  };
  records.push(record);
  saveStore(records);
  return record;
}

export function listOfflinePayments(filter?: "pending_review" | "approved" | "rejected"): OfflinePaymentRecord[] {
  const records = loadStore();
  return filter ? records.filter((r) => r.status === filter) : records;
}

export function reviewOfflinePayment(id: string, decision: "approved" | "rejected", reviewedBy: string, note: string): OfflinePaymentRecord | null {
  const records = loadStore();
  const record = records.find((r) => r.id === id);
  if (!record || record.status !== "pending_review") return null;
  record.status = decision;
  record.reviewedBy = reviewedBy;
  record.reviewedAt = new Date().toISOString();
  record.reviewNote = note;
  // verified remains false — only a connected gateway can verify
  saveStore(records);
  return record;
}
