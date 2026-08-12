/**
 * Temporal Workflow Definitions for IDLR-PTS Financial Operations
 *
 * These are the EXACT workflow definitions that must be implemented in a Temporal worker
 * to provide saga-orchestrated, compensating-transaction-safe financial operations.
 *
 * STATUS: DEFINITION ONLY — No Temporal server or worker is deployed.
 * REQUIREMENT: Temporal server + TypeScript SDK worker + TigerBeetle ledger
 */

// ─── C of O Application Payment Workflow ───────────────────────────────────────

export interface CofOPaymentWorkflowInput {
  applicationId: string;
  applicantId: string;
  parcelId: string;
  feeCategory: "c_of_o_application" | "c_of_o_renewal";
  amount: number;
  currency: "NGN";
  paymentMethod: "card" | "bank_transfer" | "ussd" | "mobile_money";
}

export interface CofOPaymentWorkflowOutput {
  success: boolean;
  ledgerTransferId: string | null;
  gatewayTransactionId: string | null;
  receiptUrl: string | null;
  failureReason: string | null;
  compensationApplied: boolean;
}

/**
 * Workflow: cofOPaymentWorkflow
 *
 * Steps:
 * 1. Validate application exists and is in "awaiting_payment" state
 * 2. Create a PENDING transfer in TigerBeetle (debit applicant, credit state treasury)
 * 3. Initialize payment with gateway (Paystack/Flutterwave)
 * 4. Wait for gateway webhook confirmation (with 30-minute timeout)
 * 5. On success: commit TigerBeetle transfer, advance application to "payment_confirmed"
 * 6. On failure/timeout: void TigerBeetle transfer, mark application "payment_failed"
 * 7. On gateway timeout: schedule retry signal, keep transfer pending
 *
 * Compensating transactions:
 * - If step 5 fails after gateway confirms: initiate refund via gateway, void transfer
 * - If step 2 fails: return error immediately, no gateway call made
 * - Idempotency: workflow ID = applicationId + attempt number
 */
export type CofOPaymentWorkflow = (input: CofOPaymentWorkflowInput) => Promise<CofOPaymentWorkflowOutput>;

// ─── Permit Fee Payment Workflow ───────────────────────────────────────────────

export interface PermitFeeWorkflowInput {
  permitId: string;
  applicantId: string;
  feeCategory: "permit_mining" | "permit_oil_gas" | "survey_fee" | "development_levy";
  amount: number;
  currency: "NGN";
  paymentMethod: "card" | "bank_transfer" | "ussd" | "mobile_money";
  agencyId: string;
}

export interface PermitFeeWorkflowOutput {
  success: boolean;
  ledgerTransferId: string | null;
  gatewayTransactionId: string | null;
  receiptUrl: string | null;
  failureReason: string | null;
  compensationApplied: boolean;
  agencyNotified: boolean;
}

/**
 * Workflow: permitFeePaymentWorkflow
 *
 * Steps:
 * 1. Validate permit exists and fee is outstanding
 * 2. Create PENDING transfer in TigerBeetle (debit applicant, credit agency account)
 * 3. Initialize payment with gateway
 * 4. Wait for gateway webhook (30-minute timeout)
 * 5. On success: commit transfer, notify agency, advance permit to "fee_paid"
 * 6. On failure: void transfer, mark permit "fee_payment_failed"
 *
 * Multi-agency split:
 * - If fee requires split (e.g., 60% state, 40% federal), create multiple transfers
 * - All transfers commit atomically or all void
 */
export type PermitFeePaymentWorkflow = (input: PermitFeeWorkflowInput) => Promise<PermitFeeWorkflowOutput>;

// ─── Land Transfer Escrow Workflow ─────────────────────────────────────────────

export interface LandTransferEscrowInput {
  transferId: string;
  buyerId: string;
  sellerId: string;
  parcelId: string;
  purchaseAmount: number;
  stampDuty: number;
  consentFee: number;
  currency: "NGN";
}

export interface LandTransferEscrowOutput {
  success: boolean;
  escrowTransferId: string | null;
  stampDutyTransferId: string | null;
  consentFeeTransferId: string | null;
  titleTransferred: boolean;
  failureReason: string | null;
  compensationApplied: boolean;
}

/**
 * Workflow: landTransferEscrowWorkflow
 *
 * Steps:
 * 1. Validate parcel ownership, buyer identity, seller consent
 * 2. Create escrow transfer: debit buyer → credit escrow account (TigerBeetle)
 * 3. Create stamp duty transfer: debit buyer → credit state treasury
 * 4. Create consent fee transfer: debit buyer → credit state treasury
 * 5. Wait for Governor's consent signal (may take days/weeks — Temporal handles this)
 * 6. On consent granted: release escrow → credit seller, transfer title in registry
 * 7. On consent denied: void all transfers, refund buyer via gateway
 * 8. On timeout (90 days): escalate to supervisor, keep escrow held
 *
 * Atomicity guarantee:
 * - Steps 2-4 are a single TigerBeetle batch (all succeed or all fail)
 * - Step 6 is a separate batch (escrow release + title update)
 * - If title update fails after escrow release: alert supervisor, do NOT auto-refund
 */
export type LandTransferEscrowWorkflow = (input: LandTransferEscrowInput) => Promise<LandTransferEscrowOutput>;

// ─── Daily Reconciliation Workflow ─────────────────────────────────────────────

export interface ReconciliationWorkflowInput {
  date: string; // YYYY-MM-DD
  gatewayProvider: "paystack" | "flutterwave";
}

export interface ReconciliationWorkflowOutput {
  matched: number;
  unmatched: number;
  discrepancies: Array<{ gatewayRef: string; ledgerRef: string | null; amount: number; issue: string }>;
  reportUrl: string | null;
}

/**
 * Workflow: dailyReconciliationWorkflow (scheduled — runs every day at 02:00 WAT)
 *
 * Steps:
 * 1. Fetch all gateway settlements for the date
 * 2. Fetch all TigerBeetle transfers for the date
 * 3. Match by gateway reference
 * 4. Flag unmatched gateway settlements (money received but not recorded)
 * 5. Flag unmatched ledger transfers (recorded but not settled)
 * 6. Generate discrepancy report
 * 7. If discrepancies > 0: notify finance supervisor
 */
export type DailyReconciliationWorkflow = (input: ReconciliationWorkflowInput) => Promise<ReconciliationWorkflowOutput>;
