/**
 * Payment Gateway API Contract
 *
 * Defines the exact request/response shapes for Paystack and Flutterwave integration.
 * These contracts must be implemented by a server-side gateway adapter.
 *
 * STATUS: CONTRACT ONLY — No gateway is connected.
 * REQUIREMENT: Paystack or Flutterwave merchant account + API keys + webhook endpoint
 */

// ─── Paystack Initialize Transaction ───────────────────────────────────────────

export interface PaystackInitializeRequest {
  email: string;
  amount: number; // in kobo (NGN * 100)
  reference: string; // unique idempotency key
  callback_url: string;
  metadata: {
    custom_fields: Array<{ display_name: string; variable_name: string; value: string }>;
    fee_category: string;
    parcel_id?: string;
    permit_id?: string;
    application_id?: string;
  };
  channels?: ("card" | "bank" | "ussd" | "mobile_money")[];
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string; // redirect user here
    access_code: string;
    reference: string;
  };
}

// ─── Paystack Verify Transaction ───────────────────────────────────────────────

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: "success" | "failed" | "abandoned";
    reference: string;
    amount: number; // kobo
    currency: "NGN";
    paid_at: string | null;
    channel: string;
    gateway_response: string;
    customer: { email: string; id: number };
    authorization: { bin: string; last4: string; brand: string; bank: string };
  };
}

// ─── Paystack Webhook Event ────────────────────────────────────────────────────

export interface PaystackWebhookEvent {
  event: "charge.success" | "charge.failed" | "transfer.success" | "transfer.failed";
  data: {
    id: number;
    reference: string;
    amount: number;
    currency: "NGN";
    status: string;
    paid_at: string | null;
    metadata: Record<string, any>;
  };
}

// ─── Flutterwave Initialize Payment ───────────────────────────────────────────

export interface FlutterwaveInitializeRequest {
  tx_ref: string; // unique reference
  amount: number; // in NGN (not kobo)
  currency: "NGN";
  redirect_url: string;
  customer: { email: string; name: string; phonenumber?: string };
  payment_options: string; // "card,banktransfer,ussd,mobilemoney"
  meta: {
    fee_category: string;
    parcel_id?: string;
    permit_id?: string;
    application_id?: string;
  };
}

export interface FlutterwaveInitializeResponse {
  status: "success" | "error";
  message: string;
  data: { link: string }; // redirect user here
}

// ─── Flutterwave Verify Transaction ───────────────────────────────────────────

export interface FlutterwaveVerifyResponse {
  status: "success" | "error";
  message: string;
  data: {
    id: number;
    tx_ref: string;
    amount: number;
    currency: "NGN";
    status: "successful" | "failed" | "pending";
    payment_type: string;
    created_at: string;
    customer: { email: string; name: string };
  };
}

// ─── Flutterwave Webhook Event ────────────────────────────────────────────────

export interface FlutterwaveWebhookEvent {
  event: "charge.completed";
  data: {
    id: number;
    tx_ref: string;
    amount: number;
    currency: "NGN";
    status: "successful" | "failed";
    payment_type: string;
    created_at: string;
  };
}

// ─── Server-Side Gateway Adapter Interface ─────────────────────────────────────

/**
 * This interface must be implemented by the server to abstract gateway differences.
 * The mobile app calls the server; the server calls the gateway.
 */
export interface PaymentGatewayAdapter {
  /** Initialize a payment and return a redirect URL or authorization code */
  initialize(params: {
    reference: string;
    amount: number;
    currency: "NGN";
    email: string;
    feeCategory: string;
    parcelId?: string;
    permitId?: string;
    channels?: string[];
    callbackUrl: string;
  }): Promise<{ authorizationUrl: string; reference: string }>;

  /** Verify a payment by reference after webhook or callback */
  verify(reference: string): Promise<{
    verified: boolean;
    amount: number;
    currency: "NGN";
    paidAt: string | null;
    channel: string;
    gatewayReference: string;
  }>;

  /** Initiate a refund for a verified payment */
  refund(gatewayReference: string, amount: number, reason: string): Promise<{
    refunded: boolean;
    refundReference: string | null;
    failureReason: string | null;
  }>;

  /** Validate a webhook signature to prevent spoofing */
  validateWebhookSignature(payload: string, signature: string): boolean;
}

// ─── TigerBeetle Ledger Interface ──────────────────────────────────────────────

/**
 * TigerBeetle account and transfer operations required for financial integrity.
 * Each fee payment creates a transfer between two accounts in the ledger.
 */
export interface TigerBeetleLedgerAdapter {
  /** Create an account for an applicant, agency, or treasury */
  createAccount(params: {
    id: bigint;
    ledger: number; // 1 = NGN
    code: number; // account type code
    flags?: number;
  }): Promise<void>;

  /** Create a pending transfer (two-phase commit) */
  createPendingTransfer(params: {
    id: bigint;
    debitAccountId: bigint;
    creditAccountId: bigint;
    amount: bigint; // in kobo
    ledger: number;
    code: number; // transfer type code
    pendingId?: bigint;
  }): Promise<void>;

  /** Commit a pending transfer (finalize) */
  commitTransfer(pendingId: bigint): Promise<void>;

  /** Void a pending transfer (cancel) */
  voidTransfer(pendingId: bigint): Promise<void>;

  /** Look up account balance */
  lookupAccount(accountId: bigint): Promise<{
    debitsPosted: bigint;
    creditsPosted: bigint;
    debitsPending: bigint;
    creditsPending: bigint;
  }>;
}

