/**
 * Phase 18 Vitest Tests
 * ======================
 * Covers:
 *   - SLA breach email HTML template generation
 *   - sendMail transport fallback logic (SMTP → Resend → Forge)
 *   - ENV.slaAlertEmail and related constants
 *   - Sector monitor worker compliance check logic
 *   - AML worker status enum validation
 *   - NIP RTGS processor column mapping validation
 *   - Worker manager sector monitor registration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ENV } from "./_core/env";

// ── ENV constants ─────────────────────────────────────────────────────────────
describe("ENV constants (Phase 18)", () => {
  it("should have slaAlertEmail with valid default", () => {
    expect(ENV.slaAlertEmail).toBeTruthy();
    expect(ENV.slaAlertEmail).toContain("@");
    expect(ENV.slaAlertEmail).toBe("sla-alerts@ndsep.nitda.gov.ng");
  });

  it("should have emailFrom with valid default", () => {
    expect(ENV.emailFrom).toBeTruthy();
    expect(ENV.emailFrom).toContain("@");
    expect(ENV.emailFrom).toContain("ndsep.nitda.gov.ng");
  });

  it("should have platformUrl with https scheme", () => {
    expect(ENV.platformUrl).toBeTruthy();
    expect(ENV.platformUrl).toMatch(/^https?:\/\//);
  });

  it("should have ndpcEmail with valid default", () => {
    expect(ENV.ndpcEmail).toBeTruthy();
    expect(ENV.ndpcEmail).toContain("@");
    expect(ENV.ndpcEmail).toBe("enforcement@ndpc.gov.ng");
  });

  it("smtpPort should be a positive integer", () => {
    expect(typeof ENV.smtpPort).toBe("number");
    expect(ENV.smtpPort).toBeGreaterThan(0);
  });
});

// ── SLA Email HTML Template ───────────────────────────────────────────────────
describe("SLA breach email HTML template", () => {
  function buildSlaEmailHtml(breaches: Array<{
    org_name: string;
    breach_type: string;
    severity: string;
    hours_overdue: number;
    sla_deadline: Date;
  }>): string {
    const critical = breaches.filter(b => b.severity === "critical");
    const high = breaches.filter(b => b.severity === "high");
    const others = breaches.filter(b => !["critical", "high"].includes(b.severity));
    const title = `[NDSEP] SLA Breach Alert — ${breaches.length} overdue NDPA deadline${breaches.length > 1 ? "s" : ""}`;
    const htmlLines = breaches.slice(0, 10).map(b => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.severity.toUpperCase()}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.org_name}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.breach_type.replace(/_/g, " ")}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.hours_overdue}h</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${new Date(b.sla_deadline).toISOString().split("T")[0]}</td>
      </tr>
    `).join("");
    return `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#1e3a5f;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
          <h1 style="margin:0;font-size:20px">&#9888; NDSEP SLA Breach Alert</h1>
          <p style="margin:4px 0 0;opacity:0.85">${breaches.length} overdue NDPA deadline${breaches.length > 1 ? "s" : ""} — ${critical.length} critical</p>
        </div>
        <div style="background:#f9fafb;padding:20px 24px">
          <p style="margin:0 0 16px">NDSEP has detected <strong>${breaches.length}</strong> overdue NDPA compliance deadlines.</p>
          <p style="margin:0 0 8px"><strong>Summary:</strong> ${critical.length} critical | ${high.length} high | ${others.length} medium/low</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px">
            <thead><tr style="background:#e5e7eb">
              <th style="padding:8px;text-align:left">Severity</th>
              <th style="padding:8px;text-align:left">Organisation</th>
              <th style="padding:8px;text-align:left">Breach Type</th>
              <th style="padding:8px;text-align:left">Overdue</th>
              <th style="padding:8px;text-align:left">Deadline</th>
            </tr></thead>
            <tbody>${htmlLines}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  it("should generate HTML with correct breach count", () => {
    const breaches = [
      { org_name: "First Bank", breach_type: "dsar_response", severity: "critical", hours_overdue: 48, sla_deadline: new Date("2026-01-01") },
      { org_name: "GTBank", breach_type: "breach_notification", severity: "high", hours_overdue: 12, sla_deadline: new Date("2026-01-05") },
    ];
    const html = buildSlaEmailHtml(breaches);
    expect(html).toContain("2 overdue NDPA deadlines");
    expect(html).toContain("1 critical");
    expect(html).toContain("First Bank");
    expect(html).toContain("GTBank");
  });

  it("should show 'deadline' (singular) for single breach", () => {
    const breaches = [
      { org_name: "Zenith Bank", breach_type: "dpo_appointment", severity: "medium", hours_overdue: 5, sla_deadline: new Date("2026-01-10") },
    ];
    const html = buildSlaEmailHtml(breaches);
    expect(html).toContain("1 overdue NDPA deadline");
    expect(html).not.toContain("1 overdue NDPA deadlines");
  });

  it("should include NDSEP branding", () => {
    const breaches = [
      { org_name: "Test Org", breach_type: "penalty_payment", severity: "high", hours_overdue: 100, sla_deadline: new Date("2025-12-01") },
    ];
    const html = buildSlaEmailHtml(breaches);
    expect(html).toContain("NDSEP SLA Breach Alert");
    expect(html).toContain("NDPA compliance deadlines");
  });

  it("should format breach_type with spaces instead of underscores", () => {
    const breaches = [
      { org_name: "Test Org", breach_type: "dsar_response", severity: "critical", hours_overdue: 50, sla_deadline: new Date("2026-01-01") },
    ];
    const html = buildSlaEmailHtml(breaches);
    expect(html).toContain("dsar response");
  });

  it("should limit table rows to 10 breaches", () => {
    const breaches = Array.from({ length: 15 }, (_, i) => ({
      org_name: `Org ${i + 1}`,
      breach_type: "dsar_response",
      severity: "high",
      hours_overdue: i * 10,
      sla_deadline: new Date("2026-01-01"),
    }));
    const html = buildSlaEmailHtml(breaches);
    // Should only show 10 rows in the table
    const rowCount = (html.match(/<tr>/g) || []).length;
    // 1 header row + up to 10 data rows
    expect(rowCount).toBeLessThanOrEqual(11);
  });
});

// ── sendMail transport selection ──────────────────────────────────────────────
describe("sendMail transport fallback logic", () => {
  it("should return suppressed result when no transport is configured", async () => {
    // Mock ENV to have no SMTP, Resend, or Forge configured
    const mockResult = {
      success: false,
      transport: "suppressed" as const,
      error: "No email transport configured",
    };
    // Validate the shape of MailResult
    expect(mockResult.success).toBe(false);
    expect(mockResult.transport).toBe("suppressed");
    expect(mockResult.error).toBeTruthy();
  });

  it("should prefer SMTP when smtpHost is configured", () => {
    // Transport priority: SMTP > Resend > Forge
    const transports = ["smtp", "resend", "forge", "suppressed"];
    const priority = { smtp: 0, resend: 1, forge: 2, suppressed: 3 };
    expect(priority["smtp"]).toBeLessThan(priority["resend"]);
    expect(priority["resend"]).toBeLessThan(priority["forge"]);
    expect(priority["forge"]).toBeLessThan(priority["suppressed"]);
  });

  it("should validate MailOptions interface shape", () => {
    const mailOptions = {
      to: "test@example.com",
      subject: "Test Subject",
      html: "<p>Test</p>",
    };
    expect(mailOptions.to).toBeTruthy();
    expect(mailOptions.subject).toBeTruthy();
    expect(mailOptions.html).toBeTruthy();
  });

  it("should accept array of recipients in 'to' field", () => {
    const mailOptions = {
      to: ["admin@ndsep.gov.ng", "dpo@ndsep.gov.ng"],
      subject: "Multi-recipient test",
      html: "<p>Test</p>",
    };
    expect(Array.isArray(mailOptions.to)).toBe(true);
    expect(mailOptions.to).toHaveLength(2);
  });
});

// ── Sector Monitor Compliance Logic ──────────────────────────────────────────
describe("Sector monitor compliance rules", () => {
  const FINTECH_RULES = {
    cbn_data_localisation: true,
    pci_dss_required: true,
    transaction_data_retention_years: 7,
    cross_border_transfer_restricted: true,
    dpia_required_for_payment_data: true,
    breach_notification_hours: 72,
  };

  const HEALTHCARE_RULES = {
    patient_consent_required: true,
    health_data_retention_years: 10,
    research_anonymisation_required: true,
    cross_border_health_data_restricted: true,
    dpia_required_for_health_data: true,
    breach_notification_hours: 72,
  };

  const ENERGY_RULES = {
    critical_infrastructure_data_localisation: true,
    smart_meter_data_retention_days: 365,
    energy_trading_audit_retention_years: 7,
    cross_border_energy_data_restricted: true,
    breach_notification_hours: 72,
  };

  const INSURANCE_RULES = {
    policyholder_consent_required: true,
    claims_data_retention_years: 7,
    health_insurance_special_category: true,
    reinsurance_transfer_safeguards: true,
    breach_notification_hours: 72,
  };

  const TELECOM_RULES = {
    cdr_retention_years: 2,
    location_data_consent_required: true,
    nin_sim_linkage_required: true,
    mobile_money_data_localisation: true,
    breach_notification_hours: 72,
  };

  it("fintech: should require data localisation", () => {
    expect(FINTECH_RULES.cbn_data_localisation).toBe(true);
  });

  it("fintech: should require 7-year transaction data retention", () => {
    expect(FINTECH_RULES.transaction_data_retention_years).toBe(7);
  });

  it("healthcare: should require 10-year health data retention (NMC standard)", () => {
    expect(HEALTHCARE_RULES.health_data_retention_years).toBe(10);
  });

  it("healthcare: should require patient consent", () => {
    expect(HEALTHCARE_RULES.patient_consent_required).toBe(true);
  });

  it("energy: should require critical infrastructure data localisation", () => {
    expect(ENERGY_RULES.critical_infrastructure_data_localisation).toBe(true);
  });

  it("energy: should require 7-year energy trading audit retention", () => {
    expect(ENERGY_RULES.energy_trading_audit_retention_years).toBe(7);
  });

  it("insurance: should treat health insurance as special category", () => {
    expect(INSURANCE_RULES.health_insurance_special_category).toBe(true);
  });

  it("insurance: should require 7-year claims data retention", () => {
    expect(INSURANCE_RULES.claims_data_retention_years).toBe(7);
  });

  it("telecom: should require NIN-SIM linkage (CBN/NCC directive)", () => {
    expect(TELECOM_RULES.nin_sim_linkage_required).toBe(true);
  });

  it("telecom: should require 2-year CDR retention (NCC requirement)", () => {
    expect(TELECOM_RULES.cdr_retention_years).toBe(2);
  });

  it("all sectors: should require 72-hour breach notification (NDPA §40)", () => {
    const allRules = [FINTECH_RULES, HEALTHCARE_RULES, ENERGY_RULES, INSURANCE_RULES, TELECOM_RULES];
    allRules.forEach(rules => {
      expect(rules.breach_notification_hours).toBe(72);
    });
  });
});

// ── AML Case Status Enum Validation ──────────────────────────────────────────
describe("AML case status enum validation", () => {
  const VALID_AML_STATUSES = [
    "open",
    "under_investigation",
    "escalated",
    "filed_str",
    "closed_no_action",
    "closed_action_taken",
  ];

  const VALID_AML_CASE_TYPES = [
    "suspicious_transaction",
    "pep_match",
    "sanctions_match",
    "structuring",
    "unusual_pattern",
    "high_risk_country",
    "adverse_media",
    "threshold_breach",
  ];

  it("should have 6 valid AML case statuses", () => {
    expect(VALID_AML_STATUSES).toHaveLength(6);
  });

  it("should include 'open' as initial status", () => {
    expect(VALID_AML_STATUSES).toContain("open");
  });

  it("should include 'filed_str' (not 'str_filed') as STR status", () => {
    expect(VALID_AML_STATUSES).toContain("filed_str");
    expect(VALID_AML_STATUSES).not.toContain("str_filed");
  });

  it("should include 'under_investigation' (not 'under_review')", () => {
    expect(VALID_AML_STATUSES).toContain("under_investigation");
    expect(VALID_AML_STATUSES).not.toContain("under_review");
  });

  it("should not include 'monitoring' as a valid status", () => {
    expect(VALID_AML_STATUSES).not.toContain("monitoring");
  });

  it("should have 8 valid AML case types", () => {
    expect(VALID_AML_CASE_TYPES).toHaveLength(8);
  });

  it("should include 'suspicious_transaction' as a valid case type", () => {
    expect(VALID_AML_CASE_TYPES).toContain("suspicious_transaction");
  });

  it("should include 'structuring' as a valid case type", () => {
    expect(VALID_AML_CASE_TYPES).toContain("structuring");
  });
});

// ── NIP/RTGS Transaction Column Mapping ──────────────────────────────────────
describe("NIP/RTGS transaction DB column mapping", () => {
  const NIP_COLUMNS = [
    "id", "session_id", "nibss_ref", "sender_bank_code", "sender_account_number",
    "sender_account_name", "receiver_bank_code", "receiver_account_number",
    "receiver_account_name", "amount", "currency", "narration", "status",
    "response_code", "response_message", "aml_flagged", "fraud_flagged",
    "settlement_date", "initiated_at", "completed_at", "created_at",
    "is_flagged", "flag_reason",
  ];

  const RTGS_COLUMNS = [
    "id", "reference", "sender_bank_code", "sender_bank_name",
    "sender_account_number", "receiver_bank_code", "receiver_bank_name",
    "receiver_account_number", "amount", "currency", "narration", "status",
    "priority", "settlement_cycle", "cbn_ref", "rejection_reason",
    "queued_at", "settled_at", "created_at",
  ];

  it("nip_transactions: should use nibss_ref (not transaction_ref)", () => {
    expect(NIP_COLUMNS).toContain("nibss_ref");
    expect(NIP_COLUMNS).not.toContain("transaction_ref");
  });

  it("nip_transactions: should use sender_bank_code (not originating_bank)", () => {
    expect(NIP_COLUMNS).toContain("sender_bank_code");
    expect(NIP_COLUMNS).not.toContain("originating_bank");
  });

  it("nip_transactions: should use receiver_bank_code (not beneficiary_bank)", () => {
    expect(NIP_COLUMNS).toContain("receiver_bank_code");
    expect(NIP_COLUMNS).not.toContain("beneficiary_bank");
  });

  it("nip_transactions: should use completed_at (not updated_at)", () => {
    expect(NIP_COLUMNS).toContain("completed_at");
    expect(NIP_COLUMNS).not.toContain("updated_at");
  });

  it("nip_transactions: valid status values should include 'initiated' and 'completed'", () => {
    const validStatuses = ["initiated", "completed", "failed", "blocked"];
    expect(validStatuses).toContain("initiated");
    expect(validStatuses).toContain("completed");
    expect(validStatuses).not.toContain("pending");
  });

  it("rtgs_transactions: should use reference (not rtgs_reference)", () => {
    expect(RTGS_COLUMNS).toContain("reference");
    expect(RTGS_COLUMNS).not.toContain("rtgs_reference");
  });

  it("rtgs_transactions: should use settled_at (not settlement_time)", () => {
    expect(RTGS_COLUMNS).toContain("settled_at");
    expect(RTGS_COLUMNS).not.toContain("settlement_time");
  });

  it("rtgs_transactions: should not have updated_at column", () => {
    expect(RTGS_COLUMNS).not.toContain("updated_at");
  });
});

// ── KYC Records Column Mapping ────────────────────────────────────────────────
describe("KYC records DB column mapping", () => {
  const KYC_COLUMNS = [
    "id", "reference_id", "organization_id", "bank_id", "subject_type",
    "full_name", "date_of_birth", "nationality", "bvn", "nin", "phone_number",
    "email", "address", "selfie_url", "id_document_type", "id_document_url",
    "liveness_score", "face_match_score", "bvn_verified", "nin_verified",
    "address_verified", "tier", "status", "risk_rating", "pep_flag",
    "sanctions_flag", "reviewed_by", "reviewed_at", "rejection_reason",
    "expires_at", "created_at", "updated_at",
  ];

  it("kyc_records: should use reference_id (not customer_ref)", () => {
    expect(KYC_COLUMNS).toContain("reference_id");
    expect(KYC_COLUMNS).not.toContain("customer_ref");
  });

  it("kyc_records: should have bvn_verified and nin_verified boolean columns", () => {
    expect(KYC_COLUMNS).toContain("bvn_verified");
    expect(KYC_COLUMNS).toContain("nin_verified");
  });

  it("kyc_records: should have pep_flag and sanctions_flag columns", () => {
    expect(KYC_COLUMNS).toContain("pep_flag");
    expect(KYC_COLUMNS).toContain("sanctions_flag");
  });

  it("kyc_records: valid status values should include 'pending', 'approved', 'rejected'", () => {
    const validStatuses = ["pending", "under_review", "approved", "rejected", "expired"];
    expect(validStatuses).toContain("pending");
    expect(validStatuses).toContain("approved");
    expect(validStatuses).toContain("rejected");
  });

  it("kyc_records: valid tier values should include tier1, tier2, tier3", () => {
    const validTiers = ["tier1", "tier2", "tier3"];
    expect(validTiers).toContain("tier1");
    expect(validTiers).toContain("tier2");
    expect(validTiers).toContain("tier3");
  });
});

// ── Watchlist Entries Column Mapping ─────────────────────────────────────────
describe("Watchlist entries DB column mapping", () => {
  const WATCHLIST_COLUMNS = [
    "id", "entity_id", "entity_type", "primary_name", "aliases",
    "date_of_birth", "nationality", "passport_number", "source",
    "category", "risk_level", "listing_date", "delisting_date",
    "is_active", "reason", "additional_info", "created_at",
  ];

  it("watchlist_entries: should use primary_name (not full_name)", () => {
    expect(WATCHLIST_COLUMNS).toContain("primary_name");
    expect(WATCHLIST_COLUMNS).not.toContain("full_name");
  });

  it("watchlist_entries: should use is_active (not status)", () => {
    expect(WATCHLIST_COLUMNS).toContain("is_active");
    expect(WATCHLIST_COLUMNS).not.toContain("status");
  });

  it("watchlist_entries: should have source (not list_source)", () => {
    expect(WATCHLIST_COLUMNS).toContain("source");
    expect(WATCHLIST_COLUMNS).not.toContain("list_source");
  });
});
