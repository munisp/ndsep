import { afterEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;
const originalAppEnv = process.env.APP_ENV;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalAppEnv;
});

describe("required middleware integration hardening", () => {
  it("uses the Fluvio relay payload contract instead of silently dropping the event body", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fluvioPublish } = await import("./middlewareExtensions");

    const event = { event_id: "evt-1", severity: "high" };
    await fluvioPublish("compliance-event", event);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody).toEqual({ topic: "compliance-event", payload: event });
    expect(firstBody).not.toHaveProperty("event");
  });

  it("rejects a plaintext required integration endpoint before any production network call", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("DAPR_BRIDGE_URL", "http://dapr.internal:8150");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { daprPublish } = await import("./middlewareExtensions");

    await expect(daprPublish("compliance-events", { event_id: "evt-2" }))
      .rejects.toThrow("must use HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when Keycloak returns a non-success or malformed identity response", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("denied", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, roles: "admin" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { keycloakValidate } = await import("./middlewareExtensions");

    await expect(keycloakValidate("test-token")).resolves.toEqual({ valid: false, roles: [] });
    await expect(keycloakValidate("test-token")).resolves.toEqual({ valid: false, roles: [] });
  });
});
