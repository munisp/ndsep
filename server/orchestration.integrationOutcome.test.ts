import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("./temporal", () => ({
  startWorkflow: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./resilience", () => ({
  withResilience: async <T>(
    _name: string,
    operation: () => Promise<T>
  ): Promise<T> => operation(),
}));

vi.stubGlobal("fetch", fetchMock);

const { j01_orgRegistered, j03_violationDetected } = await import(
  "./orchestration"
);

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("orchestration journey integration outcomes", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports a non-2xx required event publication as degraded instead of fulfilled", async () => {
    fetchMock.mockImplementation((input: string | URL) => {
      if (String(input).includes(":8160/events/publish")) {
        return Promise.resolve(
          jsonResponse(503, { error: "event bus unavailable" })
        );
      }
      return Promise.resolve(jsonResponse(201));
    });

    const result = await j01_orgRegistered({
      orgId: "org-1",
      orgName: "Example Organisation",
      sector: "finance",
      contactEmail: "contact@ndsep.test",
      submissionId: "submission-1",
    });

    expect(result).toEqual({
      journey: "J01",
      eventBus: "degraded",
      lakehouse: "ingested",
    });
  });

  it("reports a network-rejected required event publication as degraded", async () => {
    fetchMock.mockImplementation((input: string | URL) => {
      if (String(input).includes(":8160/events/publish")) {
        return Promise.reject(new Error("connect ECONNREFUSED"));
      }
      return Promise.resolve(jsonResponse(201));
    });

    const result = await j01_orgRegistered({
      orgId: "org-2",
      orgName: "Example Organisation",
      sector: "finance",
      contactEmail: "contact@ndsep.test",
      submissionId: "submission-2",
    });

    expect(result).toEqual({
      journey: "J01",
      eventBus: "degraded",
      lakehouse: "ingested",
    });
  });

  it("reports each J03 dependency independently using verified operation outcomes", async () => {
    fetchMock.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes(":8160/events/publish")) {
        return Promise.resolve(
          jsonResponse(503, { error: "event bus unavailable" })
        );
      }
      if (url.includes(":8170/workflows/start")) {
        return Promise.resolve(jsonResponse(202, { id: "workflow-1" }));
      }
      return Promise.resolve(jsonResponse(201));
    });

    const result = await j03_violationDetected({
      violationId: "violation-1",
      orgId: "org-3",
      violationType: "residency",
      severity: "high",
      description: "A verified regression test event",
    });

    expect(result).toEqual({
      journey: "J03",
      eventBus: "degraded",
      workflow: "started",
      lakehouse: "ingested",
    });
  });
});
