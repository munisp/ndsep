import { describe, it, expect } from "vitest";
import {
  responseDueAt,
  incidentSlaState,
  isAuditOverdue,
  materialChangeTrigger,
  formatIncidentRef,
  formatSystemRef,
} from "../../server/services/aiOversightLogic";

describe("responseDueAt (72h clock)", () => {
  it("class_1_serious gets +72h", () => {
    const t0 = new Date("2026-03-01T10:00:00Z");
    expect(responseDueAt("class_1_serious", t0)?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
  });
  it("lower classes get no clock", () => {
    expect(responseDueAt("class_2_significant", new Date())).toBeNull();
    expect(responseDueAt("class_3_minor", new Date())).toBeNull();
  });
});

describe("incidentSlaState", () => {
  const due = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  it("no_clock without response_due_at", () => {
    expect(incidentSlaState({ severity_class: "class_3_minor", response_due_at: null, responded_at: null, status: "reported" })).toBe("no_clock");
  });
  it("within_clock when open and >12h remain", () => {
    expect(incidentSlaState({ severity_class: "class_1_serious", response_due_at: due, responded_at: null, status: "investigating" })).toBe("within_clock");
  });
  it("due_soon within final 12h", () => {
    const soon = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    expect(incidentSlaState({ severity_class: "class_1_serious", response_due_at: soon, responded_at: null, status: "reported" })).toBe("due_soon");
  });
  it("breached when overdue and unanswered", () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(incidentSlaState({ severity_class: "class_1_serious", response_due_at: past, responded_at: null, status: "reported" })).toBe("breached");
  });
  it("responded in time => within_clock even after due", () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    const answered = new Date(Date.now() - 7200 * 1000).toISOString();
    expect(incidentSlaState({ severity_class: "class_1_serious", response_due_at: past, responded_at: answered, status: "contained" })).toBe("within_clock");
  });
});

describe("isAuditOverdue", () => {
  const today = new Date("2026-06-15T12:00:00Z");
  it("due audit with past due_date is overdue", () => {
    expect(isAuditOverdue({ due_date: "2026-06-14", status: "due" }, today)).toBe(true);
  });
  it("due audit today is not overdue", () => {
    expect(isAuditOverdue({ due_date: "2026-06-15", status: "due" }, today)).toBe(false);
  });
  it("accepted audits are never overdue", () => {
    expect(isAuditOverdue({ due_date: "2026-01-01", status: "accepted" }, today)).toBe(false);
  });
});

describe("materialChangeTrigger", () => {
  it("hash change dominates", () => {
    expect(materialChangeTrigger({ model_version: "1.0", model_hash: "a" }, { model_version: "2.0", model_hash: "b" }))
      .toEqual({ trigger: true, trigger_type: "model_hash_change" });
  });
  it("version-only change triggers model_version_change", () => {
    expect(materialChangeTrigger({ model_version: "1.0", model_hash: "a" }, { model_version: "1.1" }))
      .toEqual({ trigger: true, trigger_type: "model_version_change" });
  });
  it("no change => no trigger", () => {
    expect(materialChangeTrigger({ model_version: "1.0", model_hash: "a" }, { model_version: "1.0", model_hash: "a" }))
      .toEqual({ trigger: false, trigger_type: null });
  });
});

describe("reference formatting", () => {
  it("formats incident and system refs", () => {
    expect(formatIncidentRef(2026, 7)).toBe("AIRT-RT-2026-00007");
    expect(formatSystemRef(2026, 12)).toBe("AIRS-2026-00012");
  });
});
