/**
 * Payment Domain Types
 *
 * IMPORTANT: This module defines the data contracts for payment UI and gateway integration.
 * No actual payment processing occurs until a real gateway (Paystack/Flutterwave) is configured.
 * All payment actions are explicitly labelled "pending_gateway" until connected.
 */

export type PaymentStatus = "pending_gateway" | "initiated" | "processing" | "completed" | "failed" | "refunded";
export type PaymentMethod = "card" | "bank_transfer" | "ussd" | "mobile_money";
export type FeeCategory = "c_of_o_application" | "c_of_o_renewal" | "permit_mining" | "permit_oil_gas" | "survey_fee" | "stamp_duty" | "development_levy" | "consent_fee";

export interface PaymentRecord {
  id: string;
  referenceNumber: string;
  amount: number;
  currency: "NGN";
  feeCategory: FeeCategory;
  description: string;
  status: PaymentStatus;
  method: PaymentMethod | null;
  parcelId: string | null;
  permitId: string | null;
  applicantId: string;
  createdAt: string;
  updatedAt: string;
  gatewayReference: string | null;
  gatewayProvider: "paystack" | "flutterwave" | null;
  receiptUrl: string | null;
  /** Explicitly indicates whether a real gateway processed this */
  gatewayVerified: boolean;
  /** If not verified, explains why */
  verificationNote: string;
}

export interface FeeScheduleItem {
  category: FeeCategory;
  label: string;
  baseAmount: number;
  currency: "NGN";
  description: string;
  requiredFor: string;
}

/** Nigeria land administration fee schedule (illustrative — real amounts require gazette publication) */
export const NIGERIA_FEE_SCHEDULE: FeeScheduleItem[] = [
  { category: "c_of_o_application", label: "C of O Application Fee", baseAmount: 50000, currency: "NGN", description: "Initial application processing fee for Certificate of Occupancy", requiredFor: "New C of O applications" },
  { category: "c_of_o_renewal", label: "C of O Renewal Fee", baseAmount: 35000, currency: "NGN", description: "Renewal processing fee for existing Certificate of Occupancy", requiredFor: "C of O renewal applications" },
  { category: "permit_mining", label: "Mining Permit Fee", baseAmount: 250000, currency: "NGN", description: "Application fee for mining exploration or extraction permit", requiredFor: "Mining permit applications" },
  { category: "permit_oil_gas", label: "Oil & Gas License Fee", baseAmount: 500000, currency: "NGN", description: "Application fee for oil and gas exploration or production license", requiredFor: "Oil & gas permit applications" },
  { category: "survey_fee", label: "Survey Fee", baseAmount: 75000, currency: "NGN", description: "Professional land survey and demarcation fee", requiredFor: "All new parcel registrations" },
  { category: "stamp_duty", label: "Stamp Duty", baseAmount: 15000, currency: "NGN", description: "Government stamp duty on land transaction instruments", requiredFor: "All title transfers" },
  { category: "development_levy", label: "Development Levy", baseAmount: 100000, currency: "NGN", description: "State development contribution for approved building plans", requiredFor: "Building permit approvals" },
  { category: "consent_fee", label: "Governor's Consent Fee", baseAmount: 200000, currency: "NGN", description: "Fee for obtaining Governor's consent on land transactions", requiredFor: "Land transfers requiring consent" },
];

export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG")}`;
}

export function generatePaymentReference(): string {
  return `IDLR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
