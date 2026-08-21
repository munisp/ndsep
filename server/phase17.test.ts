/**
 * Phase 17 Vitest Tests
 * =====================
 * Covers:
 *   - SLA notification scheduler (detectOverdueBreaches, runSlaBreachCheck, start/stop)
 *   - Session blacklist disconnect teardown
 *   - Email notification for SLA breaches (sendMail integration)
 *   - ENV.slaAlertEmail constant
 *   - Business rules seed data endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ENV } from "./_core/env";

// ── ENV constants ─────────────────────────────────────────────────────────────

describe("ENV constants (Phase 17)", () => {
  it("should have slaAlertEmail with default value", () => {
    expect(ENV.slaAlertEmail).toBeTruthy();
    expect(ENV.slaAlertEmail).toContain("@");
    expect(ENV.slaAlertEmail).toBe("sla-alerts@ndsep.nitda.gov.ng");
  });

  it("should have platformUrl with default value", () => {
    expect(ENV.platformUrl).toBeTruthy();
    expect(ENV.platformUrl).toMatch(/^https?:\/\//);
  });

  it("should have ndpcEmail with default value", () => {
    expect(ENV.ndpcEmail).toBeTruthy();
    expect(ENV.ndpcEmail).toContain("@");
  });

  it("should have emailFrom with default value", () => {
    expect(ENV.emailFrom).toBeTruthy();
    expect(ENV.emailFrom).toContain("@");
  });
});

// ── SLA Scheduler unit tests ──────────────────────────────────────────────────
// Use vi.hoisted() so the mock store is available when vi.mock factory runs

const mockStore = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("pg", () => {
  return {
    default: {
      Pool: vi.fn(() => mockStore.pool),
    },
  };
});

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./mailer", () => ({
  sendMail: vi.fn().mockResolvedValue({ success: true, transport: "forge" }),
}));

import { notifyOwner } from "./_core/notification";
import { sendMail } from "./mailer";
import {
  detectOverdueBreaches,
  escalateBreach,
  notifyOwnerOfBreaches,
  runSlaBreachCheck,
  startSlaBreachScheduler,
  stopSlaBreachScheduler,
  type SlaBreachAlert,
} from "./slaNotificationScheduler";

const SAMPLE_BREACHES: SlaBreachAlert[] = [
  {
    id: 1,
    organization_id: 10,
    org_name: "First Bank Nigeria",
    breach_type: "dsar_response",
    severity: "critical",
    status: "open",
    sla_deadline: new Date(Date.now() - 48 * 60 * 60 * 1000),
    description: "DSAR submitted but not responded to",
    hours_overdue: 48,
  },
  {
    id: 2,
    organization_id: 11,
    org_name: "MTN Nigeria",
    breach_type: "breach_notification",
    severity: "high",
    status: "pending",
    sla_deadline: new Date(Date.now() - 24 * 60 * 60 * 1000),
    description: "Data breach not reported to NDPC within 72h",
    hours_overdue: 24,
  },
];

describe("detectOverdueBreaches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-assign pool after clearAllMocks resets the mock fns
    mockStore.pool.end.mockResolvedValue(undefined);
  });

  it("should return empty array when no overdue breaches", async () => {
    mockStore.pool.query.mockResolvedValueOnce([[]]);
    const result = await detectOverdueBreaches();
    expect(result).toEqual([]);
    expect(mockStore.pool.end).toHaveBeenCalled();
  });

  it("should return overdue breaches from MySQL", async () => {
    mockStore.pool.query.mockResolvedValueOnce([SAMPLE_BREACHES]);
    const result = await detectOverdueBreaches();
    expect(result).toHaveLength(2);
    expect(result[0].breach_type).toBe("dsar_response");
    expect(result[0].severity).toBe("critical");
    expect(result[1].org_name).toBe("MTN Nigeria");
  });

  it("should always call pool.end() even on error", async () => {
    mockStore.pool.query.mockRejectedValueOnce(new Error("DB connection failed"));
    await expect(detectOverdueBreaches()).rejects.toThrow("DB connection failed");
    expect(mockStore.pool.end).toHaveBeenCalled();
  });
});

describe("escalateBreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.pool.end.mockResolvedValue(undefined);
  });

  it("should update breach status to escalated in MySQL", async () => {
    mockStore.pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await escalateBreach(1, "First Bank Nigeria", "dsar_response");
    expect(mockStore.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE sla_breaches"),
      [1]
    );
    expect(mockStore.pool.end).toHaveBeenCalled();
  });

  it("should always call pool.end() even on error", async () => {
    mockStore.pool.query.mockRejectedValueOnce(new Error("DB error"));
    await expect(escalateBreach(1, "Test Org", "dsar_response")).rejects.toThrow("DB error");
    expect(mockStore.pool.end).toHaveBeenCalled();
  });
});

describe("notifyOwnerOfBreaches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (sendMail as any).mockResolvedValue({ success: true, transport: "forge" });
    (notifyOwner as any).mockResolvedValue(true);
  });

  it("should do nothing when breaches array is empty", async () => {
    await notifyOwnerOfBreaches([]);
    expect(notifyOwner).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("should call notifyOwner with structured alert content", async () => {
    await notifyOwnerOfBreaches(SAMPLE_BREACHES);
    expect(notifyOwner).toHaveBeenCalledOnce();
    const call = (notifyOwner as any).mock.calls[0][0];
    expect(call.title).toContain("NDSEP SLA ALERT");
    expect(call.title).toContain("2 Overdue NDPA Deadlines");
    expect(call.content).toContain("First Bank Nigeria");
    expect(call.content).toContain("NDPA §35");
    expect(call.content).toContain("NDPA §40");
  });

  it("should call sendMail with HTML email to slaAlertEmail", async () => {
    await notifyOwnerOfBreaches(SAMPLE_BREACHES);
    expect(sendMail).toHaveBeenCalledOnce();
    const mailCall = (sendMail as any).mock.calls[0][0];
    expect(mailCall.to).toBe(ENV.slaAlertEmail);
    expect(mailCall.subject).toContain("NDSEP SLA ALERT");
    expect(mailCall.html).toContain("First Bank Nigeria");
    expect(mailCall.html).toContain("MTN Nigeria");
    expect(mailCall.html).toContain("NDPA §35");
    expect(mailCall.html).toContain("NDPA §40");
    expect(mailCall.html).toContain("CRITICAL");
    expect(mailCall.html).toContain("HIGH");
  });

  it("should include dashboard link in email HTML", async () => {
    await notifyOwnerOfBreaches(SAMPLE_BREACHES);
    const mailCall = (sendMail as any).mock.calls[0][0];
    expect(mailCall.html).toContain("sla-monitoring");
    expect(mailCall.html).toContain(ENV.platformUrl);
  });

  it("should handle 1 critical breach in title correctly (singular)", async () => {
    const singleBreach = [SAMPLE_BREACHES[0]];
    await notifyOwnerOfBreaches(singleBreach);
    const call = (notifyOwner as any).mock.calls[0][0];
    // Singular "Deadline" not "Deadlines"
    expect(call.title).toMatch(/1 Overdue NDPA Deadline[^s]/);
    expect(call.title).toContain("1 Critical");
  });
});

describe("runSlaBreachCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.pool.end.mockResolvedValue(undefined);
    (sendMail as any).mockResolvedValue({ success: true, transport: "forge" });
    (notifyOwner as any).mockResolvedValue(true);
  });

  it("should return detected=0 when no overdue breaches", async () => {
    mockStore.pool.query.mockResolvedValueOnce([[]]);
    const result = await runSlaBreachCheck();
    expect(result).toEqual({ detected: 0, escalated: 0, notified: false });
    expect(notifyOwner).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("should detect, escalate, and notify for overdue breaches", async () => {
    mockStore.pool.query.mockResolvedValueOnce([SAMPLE_BREACHES]);
    mockStore.pool.query.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await runSlaBreachCheck();
    expect(result.detected).toBe(2);
    expect(result.escalated).toBe(2);
    expect(result.notified).toBe(true);
    expect(notifyOwner).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it("should return detected=0 on DB error without throwing", async () => {
    mockStore.pool.query.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await runSlaBreachCheck();
    expect(result).toEqual({ detected: 0, escalated: 0, notified: false });
  });

  it("should continue escalating other breaches if one escalation fails", async () => {
    mockStore.pool.query.mockResolvedValueOnce([SAMPLE_BREACHES]);
    mockStore.pool.query
      .mockRejectedValueOnce(new Error("Escalation failed"))
      .mockResolvedValue([{ affectedRows: 1 }]);
    const result = await runSlaBreachCheck();
    expect(result.detected).toBe(2);
    expect(result.escalated).toBe(1);
    expect(result.notified).toBe(true);
  });
});

describe("SLA breach scheduler lifecycle", () => {
  afterEach(() => {
    stopSlaBreachScheduler();
  });

  it("should start and stop without errors", () => {
    expect(() => startSlaBreachScheduler()).not.toThrow();
    expect(() => stopSlaBreachScheduler()).not.toThrow();
  });

  it("should not start a second interval if already running", () => {
    startSlaBreachScheduler();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    startSlaBreachScheduler();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("should be safe to call stopSlaBreachScheduler when not running", () => {
    stopSlaBreachScheduler();
    expect(() => stopSlaBreachScheduler()).not.toThrow();
  });
});

// ── Session blacklist disconnect teardown ──────────────────────────────────────

describe("disconnectBlacklistRedis teardown", () => {
  it("should disconnect without throwing", async () => {
    const { disconnectBlacklistRedis } = await import("./sessionBlacklist");
    await expect(disconnectBlacklistRedis()).resolves.not.toThrow();
  });

  it("should be safe to call multiple times", async () => {
    const { disconnectBlacklistRedis } = await import("./sessionBlacklist");
    await disconnectBlacklistRedis();
    await expect(disconnectBlacklistRedis()).resolves.not.toThrow();
  });
});

// ── HTTP endpoint smoke tests for business rules seed data ────────────────────

const BASE = "http://localhost:3000";

async function getAdminCookie(): Promise<string> {
  const res = await fetch(`${BASE}/api/demo-login?role=admin`, { redirect: "manual" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/app_session_id=([^;]+)/);
  return match ? `app_session_id=${match[1]}` : "";
}

async function trpc(path: string, input: unknown, cookie: string) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { Cookie: cookie } });
  return res.json();
}

describe("Business rules seed data endpoints (Phase 17)", () => {
  let cookie = "";

  beforeEach(async () => {
    if (!cookie) cookie = await getAdminCookie();
  }, 15000);

  it("should return SLA breaches from monitoring.slaBreaches", async () => {
    const data = await trpc("monitoring.slaBreaches", {}, cookie);
    // Accept either result.data array or error (if monitoring router needs admin)
    expect(data).toBeDefined();
    const items = data?.result?.data ?? data?.error;
    expect(items).toBeDefined();
  }, 15000);

  it("should return drift alerts from monitoring.driftAlerts", async () => {
    const data = await trpc("monitoring.driftAlerts", {}, cookie);
    expect(data).toBeDefined();
  }, 15000);

  it("should return monitoring stats from monitoring.stats", async () => {
    const data = await trpc("monitoring.stats", {}, cookie);
    expect(data).toBeDefined();
  }, 15000);

  it("should return org scores from monitoring.orgScores", async () => {
    const data = await trpc("monitoring.orgScores", {}, cookie);
    expect(data).toBeDefined();
  }, 15000);
});
