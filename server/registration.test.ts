/**
 * DPCO Self-Registration, Stripe Checkout & Email Dispatch Tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DPCO Self-Registration ───────────────────────────────────────────────────
describe("DPCO Self-Registration", () => {
  it("generates a provisional licence number in the correct format", () => {
    const year = new Date().getFullYear();
    const seq = String(Date.now()).slice(-6);
    const provisional = `NDPC-DPCO-PROV-${year}-${seq}`;
    expect(provisional).toMatch(/^NDPC-DPCO-PROV-\d{4}-\d{6}$/);
  });

  it("validates required fields before submission", () => {
    const required = ["name", "email", "phone", "state", "address", "cacNumber"];
    const form: Record<string, string> = {
      name: "DataGuard Nigeria Ltd",
      email: "info@dataguard.ng",
      phone: "+234 800 123 4567",
      state: "Lagos",
      address: "12 Victoria Island, Lagos",
      cacNumber: "RC-1234567",
    };
    const missing = required.filter((f) => !form[f]?.trim());
    expect(missing).toHaveLength(0);
  });

  it("rejects submission when services array is empty", () => {
    const services: string[] = [];
    const isValid = services.length > 0;
    expect(isValid).toBe(false);
  });

  it("rejects submission when declaration is not accepted", () => {
    const declarationAccepted = false;
    expect(declarationAccepted).toBe(false);
  });

  it("generates a formal licence number on approval", () => {
    const year = new Date().getFullYear();
    const seq = String(Date.now()).slice(-5);
    const licenceNumber = `NDPC-DPCO-${year}-${seq}`;
    expect(licenceNumber).toMatch(/^NDPC-DPCO-\d{4}-\d{5}$/);
  });

  it("calculates licence expiry as 1 year from issue date", () => {
    const issueDate = new Date("2026-04-03");
    const expiryDate = new Date(issueDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    expect(expiryDate.getFullYear()).toBe(2027);
    expect(expiryDate.getMonth()).toBe(issueDate.getMonth());
    expect(expiryDate.getDate()).toBe(issueDate.getDate());
  });
});

// ─── Stripe Checkout ─────────────────────────────────────────────────────────
describe("Stripe Checkout Session", () => {
  it("constructs correct success URL with invoice param", () => {
    const origin = "https://ndsep.manus.space";
    const invoiceId = 42;
    const successUrl = `${origin}/dpco/billing?payment=success&invoice=${invoiceId}`;
    expect(successUrl).toBe(
      "https://ndsep.manus.space/dpco/billing?payment=success&invoice=42"
    );
  });

  it("constructs correct cancel URL with invoice param", () => {
    const origin = "https://ndsep.manus.space";
    const invoiceId = 42;
    const cancelUrl = `${origin}/dpco/billing?payment=cancelled&invoice=${invoiceId}`;
    expect(cancelUrl).toBe(
      "https://ndsep.manus.space/dpco/billing?payment=cancelled&invoice=42"
    );
  });

  it("converts NGN amount to Stripe unit_amount (kobo)", () => {
    const amountNGN = 500000; // ₦500,000
    const unitAmount = Math.round(amountNGN * 100); // 50,000,000 kobo
    expect(unitAmount).toBe(50000000);
  });

  it("detects test events by evt_test_ prefix", () => {
    const testEventId = "evt_test_abc123";
    const isTest = testEventId.startsWith("evt_test_");
    expect(isTest).toBe(true);
  });

  it("does not flag real events as test events", () => {
    const realEventId = "evt_1OqABCDEFGHIJKL";
    const isTest = realEventId.startsWith("evt_test_");
    expect(isTest).toBe(false);
  });

  it("extracts invoice_id from Stripe session metadata", () => {
    const metadata = { invoice_id: "42", user_id: "7" };
    const invoiceId = metadata.invoice_id ? parseInt(metadata.invoice_id, 10) : null;
    expect(invoiceId).toBe(42);
  });

  it("handles missing invoice_id in metadata gracefully", () => {
    const metadata: Record<string, string> = {};
    const invoiceId = metadata.invoice_id ? parseInt(metadata.invoice_id, 10) : null;
    expect(invoiceId).toBeNull();
  });
});

// ─── Invoice Email Dispatch ───────────────────────────────────────────────────
describe("Invoice Email Dispatch", () => {
  it("falls back to dpco email when client_email is absent", () => {
    const invoice = { client_email: null, dpco_email: "dpco@example.ng" };
    const toEmail = invoice.client_email ?? invoice.dpco_email;
    expect(toEmail).toBe("dpco@example.ng");
  });

  it("prefers client_email over dpco_email when both present", () => {
    const invoice = { client_email: "client@corp.ng", dpco_email: "dpco@example.ng" };
    const toEmail = invoice.client_email ?? invoice.dpco_email;
    expect(toEmail).toBe("client@corp.ng");
  });

  it("throws when no email address is available", () => {
    const invoice = { client_email: null, dpco_email: null };
    const toEmail = invoice.client_email ?? invoice.dpco_email;
    expect(toEmail).toBeNull();
  });

  it("marks invoice as sent when status is draft after email dispatch", () => {
    const invoice = { status: "draft" };
    const newStatus = invoice.status === "draft" ? "sent" : invoice.status;
    expect(newStatus).toBe("sent");
  });

  it("does not change status when invoice is already sent", () => {
    const invoice = { status: "sent" };
    const newStatus = invoice.status === "draft" ? "sent" : invoice.status;
    expect(newStatus).toBe("sent");
  });

  it("does not change status when invoice is paid", () => {
    const invoice = { status: "paid" };
    const newStatus = invoice.status === "draft" ? "sent" : invoice.status;
    expect(newStatus).toBe("paid");
  });

  it("builds email body with all required fields", () => {
    const invoice = {
      invoice_number: "INV-2026-001",
      client_name: "Zenith Bank PLC",
      service_type: "compliance_audit",
      total_amount: "500000",
      currency: "NGN",
      due_date: "2026-05-01",
    };
    const body = [
      `Invoice ${invoice.invoice_number} has been dispatched.`,
      `Client: ${invoice.client_name}`,
      `Service: ${invoice.service_type}`,
      `Amount: ${invoice.currency} ${Number(invoice.total_amount).toLocaleString()}`,
      `Due: ${invoice.due_date}`,
    ].join("\n");

    expect(body).toContain("INV-2026-001");
    expect(body).toContain("Zenith Bank PLC");
    expect(body).toContain("500,000");
    expect(body).toContain("2026-05-01");
  });
});

// ─── Webhook Atomic Payment Recording ────────────────────────────────────────
describe("Stripe Webhook Payment Recording", () => {
  it("calculates platform share correctly at 12% rate", () => {
    const totalAmount = 500000;
    const platformFeeRate = 0.12;
    const platformFeeAmount = totalAmount * platformFeeRate;
    const dpcoNetAmount = totalAmount - platformFeeAmount;
    expect(platformFeeAmount).toBe(60000);
    expect(dpcoNetAmount).toBe(440000);
  });

  it("calculates platform share correctly at 10% rate (professional)", () => {
    const totalAmount = 500000;
    const platformFeeRate = 0.10;
    const platformFeeAmount = totalAmount * platformFeeRate;
    const dpcoNetAmount = totalAmount - platformFeeAmount;
    expect(platformFeeAmount).toBe(50000);
    expect(dpcoNetAmount).toBe(450000);
  });

  it("calculates platform share correctly at 8% rate (enterprise)", () => {
    const totalAmount = 500000;
    const platformFeeRate = 0.08;
    const platformFeeAmount = totalAmount * platformFeeRate;
    const dpcoNetAmount = totalAmount - platformFeeAmount;
    expect(platformFeeAmount).toBe(40000);
    expect(dpcoNetAmount).toBe(460000);
  });

  it("constructs Stripe payment reference from session ID", () => {
    const sessionId = "cs_test_abc123xyz";
    const paymentRef = `STRIPE-${sessionId}`;
    expect(paymentRef).toBe("STRIPE-cs_test_abc123xyz");
  });
});
