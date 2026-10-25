import { describe, it, expect } from "vitest";
import {
  canTransitionRequest,
  statusTimestampColumn,
  deadlineState,
  formatRequestRef,
  formatInstrumentRef,
} from "../../server/services/icoopLogic";

describe("request lifecycle", () => {
  it("allows draft->sent and sent->acknowledged->fulfilled", () => {
    expect(canTransitionRequest("draft", "sent")).toBe(true);
    expect(canTransitionRequest("sent", "acknowledged")).toBe(true);
    expect(canTransitionRequest("acknowledged", "fulfilled")).toBe(true);
  });
  it("rejects skipping and backward transitions", () => {
    expect(canTransitionRequest("draft", "fulfilled")).toBe(false);
    expect(canTransitionRequest("sent", "draft")).toBe(false);
    expect(canTransitionRequest("fulfilled", "acknowledged")).toBe(false);
  });
  it("terminal states allow nothing", () => {
    for (const s of ["fulfilled", "declined", "withdrawn"] as const) {
      expect(canTransitionRequest(s, "sent")).toBe(false);
    }
  });
  it("maps statuses to timestamp columns", () => {
    expect(statusTimestampColumn("sent")).toBe("sent_at");
    expect(statusTimestampColumn("acknowledged")).toBe("acknowledged_at");
    expect(statusTimestampColumn("fulfilled")).toBe("fulfilled_at");
    expect(statusTimestampColumn("declined")).toBe("declined_at");
    expect(statusTimestampColumn("draft")).toBeNull();
  });
});

describe("deadlineState (inbound statutory deadlines)", () => {
  const today = new Date("2026-06-15T12:00:00Z");
  it("outbound requests have no tracked deadline", () => {
    expect(deadlineState({ direction: "outbound", statutory_deadline: "2026-06-01", status: "sent" }, today)).toBe("no_deadline");
  });
  it("open inbound past deadline is overdue", () => {
    expect(deadlineState({ direction: "inbound", statutory_deadline: "2026-06-10", status: "acknowledged" }, today)).toBe("overdue");
  });
  it("open inbound within 7 days is due_soon", () => {
    expect(deadlineState({ direction: "inbound", statutory_deadline: "2026-06-20", status: "sent" }, today)).toBe("due_soon");
  });
  it("open inbound far out is on_track", () => {
    expect(deadlineState({ direction: "inbound", statutory_deadline: "2026-07-15", status: "sent" }, today)).toBe("on_track");
  });
  it("fulfilled before deadline is met; after is overdue", () => {
    expect(deadlineState({ direction: "inbound", statutory_deadline: "2026-06-10", status: "fulfilled", fulfilled_at: "2026-06-05T00:00:00Z" }, today)).toBe("met");
    expect(deadlineState({ direction: "inbound", statutory_deadline: "2026-06-10", status: "fulfilled", fulfilled_at: "2026-06-12T00:00:00Z" }, today)).toBe("overdue");
  });
});

describe("reference formatting", () => {
  it("formats request and instrument refs", () => {
    expect(formatRequestRef(2026, 3)).toBe("ICMA-2026-00003");
    expect(formatInstrumentRef(2026, 12)).toBe("MOU-2026-012");
  });
});
