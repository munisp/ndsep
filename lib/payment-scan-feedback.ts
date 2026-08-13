import type { ReceiptScanOutcome } from "@/server/offlinePaymentRepository";

export function paymentScanFeedback(outcome: ReceiptScanOutcome) {
  return outcome === "approved" ? "success" : "error";
}
