/**
 * Pure-logic tests for the public complaint portal (no DB).
 * Covers: status machine, reference codes, SLA clock, IP-hash rate limiting,
 * public tracking view redaction and duplicate-merge guards.
 */
import { describe, it, expect } from "vitest";
import {
  STATUS_TRANSITIONS,
  canTransition,
  statusTimestampColumn,
  formatReferenceCode,
  isValidReferenceCode,
  computeAckSlaDueAt,
  ackSlaState,
  slaHoursRemaining,
  hashIp,
  isRateLimited,
  toPublicTrackingView,
  canMergeInto,
  canBeMerged,
  ACK_SLA_HOURS,
} from "../../server/services/complaintLogic";

describe("status machine", () => {
  it("walks the full lifecycle received → closed", () => {
    const path = ["received", "acknowledged", "under_review", "linked_to_case", "resolved", "closed"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("allows under_review → resolved without a case link", () => {
    expect(canTransition("under_review", "resolved")).toBe(true);
  });

  it("rejects backward and skipping transitions", () => {
    expect(canTransition("acknowledged", "received")).toBe(false);
    expect(canTransition("received", "under_review")).toBe(false);
    expect(canTransition("received", "resolved")).toBe(false);
    expect(canTransition("under_review", "closed")).toBe(false);
    expect(canTransition("closed", "received")).toBe(false);
  });

  it("closed is terminal", () => {
    expect(STATUS_TRANSITIONS.closed).toEqual([]);
  });

  it("maps each status to its timestamp column", () => {
    expect(statusTimestampColumn("acknowledged")).toBe("acknowledged_at");
    expect(statusTimestampColumn("linked_to_case")).toBe("linked_at");
    expect(statusTimestampColumn("closed")).toBe("closed_at");
  });
});

describe("reference codes", () => {
  it("formats NDPC-CMP-YYYY-NNNNNN with zero padding", () => {
    const code = formatReferenceCode(42, new Date(Date.UTC(2026, 0, 15)));
    expect(code).toBe("NDPC-CMP-2026-000042");
  });

  it("pads large sequence values to at least 6 digits", () => {
    expect(formatReferenceCode(1234567, new Date(Date.UTC(2026, 5, 1)))).toBe("NDPC-CMP-2026-1234567");
  });

  it("validates the reference format case-insensitively with whitespace tolerance", () => {
    expect(isValidReferenceCode("NDPC-CMP-2026-000042")).toBe(true);
    expect(isValidReferenceCode(" ndpc-cmp-2026-000042 ")).toBe(true);
    expect(isValidReferenceCode("NDPC-CMP-2026-42")).toBe(false);
    expect(isValidReferenceCode("FOIA-2026-00042")).toBe(false);
  });
});

describe("acknowledgement SLA clock (72h)", () => {
  const received = new Date("2026-03-01T09:00:00Z");

  it("due time is exactly 72 hours after receipt", () => {
    const due = computeAckSlaDueAt(received);
    expect(due.getTime() - received.getTime()).toBe(ACK_SLA_HOURS * 3600 * 1000);
  });

  it("unacknowledged complaint is within_sla before the due time", () => {
    const row = { status: "received", acknowledged_at: null, ack_sla_due_at: computeAckSlaDueAt(received) };
    expect(ackSlaState(row, new Date("2026-03-03T09:00:00Z"))).toBe("within_sla");
  });

  it("unacknowledged complaint breaches after the due time", () => {
    const row = { status: "received", acknowledged_at: null, ack_sla_due_at: computeAckSlaDueAt(received) };
    expect(ackSlaState(row, new Date("2026-03-05T09:00:00Z"))).toBe("breached");
  });

  it("acknowledged before due time is met; after is breached", () => {
    const due = computeAckSlaDueAt(received);
    expect(ackSlaState({ status: "acknowledged", acknowledged_at: new Date("2026-03-02T09:00:00Z"), ack_sla_due_at: due })).toBe("met");
    expect(ackSlaState({ status: "acknowledged", acknowledged_at: new Date("2026-03-06T09:00:00Z"), ack_sla_due_at: due })).toBe("breached");
  });

  it("reports hours remaining (negative when breached)", () => {
    const due = computeAckSlaDueAt(received);
    expect(slaHoursRemaining({ ack_sla_due_at: due }, new Date("2026-03-02T09:00:00Z"))).toBeCloseTo(48, 1);
    expect(slaHoursRemaining({ ack_sla_due_at: due }, new Date("2026-03-05T09:00:00Z"))).toBeLessThan(0);
  });
});

describe("IP-hash rate limiting", () => {
  it("hash is stable per (ip, salt) and 64 hex chars", () => {
    const h1 = hashIp("203.0.113.7", "s");
    const h2 = hashIp("203.0.113.7", "s");
    const h3 = hashIp("203.0.113.8", "s");
    const h4 = hashIp("203.0.113.7", "other-salt");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h3);
    expect(h1).not.toBe(h4);
  });

  it("limit is hit at the cap, not before", () => {
    expect(isRateLimited(4, 5)).toBe(false);
    expect(isRateLimited(5, 5)).toBe(true);
    expect(isRateLimited(9, 5)).toBe(true);
  });
});

describe("public tracking view redaction", () => {
  it("exposes lifecycle fields but never identity/case internals", () => {
    const row = {
      reference_code: "NDPC-CMP-2026-000007",
      category: "breach",
      subject: "My data was leaked",
      status: "under_review",
      state: "Lagos",
      lga: "Ikeja",
      received_at: "2026-03-01T00:00:00Z",
      acknowledged_at: "2026-03-02T00:00:00Z",
      under_review_at: "2026-03-03T00:00:00Z",
      resolved_at: null,
      closed_at: null,
      ack_sla_due_at: "2026-03-04T00:00:00Z",
      is_anonymous: false,
      // sensitive fields that must not leak:
      complainant_name: "enc:v1:secret",
      complainant_email: "enc:v1:secret",
      complainant_phone: "enc:v1:secret",
      submitter_ip_hash: "abc123",
      description: "long narrative possibly containing PII",
      assigned_officer_id: 12,
      enforcement_case_id: 34,
      merged_into_id: null,
      resolution_notes: "internal",
    };
    const view = toPublicTrackingView(row);
    expect(view.reference_code).toBe("NDPC-CMP-2026-000007");
    expect(view.status).toBe("under_review");
    for (const k of Object.keys(view)) {
      expect([
        "reference_code", "category", "subject", "status", "state", "lga",
        "received_at", "acknowledged_at", "under_review_at", "resolved_at",
        "closed_at", "ack_sla_due_at", "is_anonymous",
      ]).toContain(k);
    }
  });
});

describe("duplicate merge guards", () => {
  it("a closed or already-merged complaint cannot absorb merges", () => {
    expect(canMergeInto({ status: "closed", merged_into_id: null })).toBe(false);
    expect(canMergeInto({ status: "under_review", merged_into_id: 5 })).toBe(false);
    expect(canMergeInto({ status: "under_review", merged_into_id: null })).toBe(true);
  });

  it("an already-merged complaint cannot be merged again", () => {
    expect(canBeMerged({ status: "closed", merged_into_id: 5 })).toBe(false);
    expect(canBeMerged({ status: "received", merged_into_id: null })).toBe(true);
  });
});
