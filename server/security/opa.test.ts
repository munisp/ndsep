import { afterEach, describe, expect, it, vi } from "vitest";

const adminInput = {
  subject: { id: 1, role: "admin", authenticated: true },
  action: "admin" as const,
  resource: "platform.admin",
  context: { environment: "production", mfaVerified: true },
};

async function loadOpa(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./opa");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("OPA privileged authorization", () => {
  it("denies privileged production actions when OPA is not configured", async () => {
    const { opaAllows } = await loadOpa({ NODE_ENV: "production", OPA_ENABLED: "false", OPA_URL: "" });
    await expect(opaAllows(adminInput)).resolves.toBe(false);
  });

  it("denies an unavailable OPA decision endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    const { opaAllows } = await loadOpa({ NODE_ENV: "production", OPA_ENABLED: "true", OPA_URL: "http://opa:8181" });
    await expect(opaAllows(adminInput)).resolves.toBe(false);
  });

  it("accepts only an explicit boolean allow and carries verified MFA assurance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const { opaAllows } = await loadOpa({ NODE_ENV: "production", OPA_ENABLED: "true", OPA_URL: "http://opa:8181" });

    await expect(opaAllows(adminInput)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({ input: { context: { mfaVerified: true } } });
  });

  it("denies a malformed OPA response instead of treating it as an allow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: "allow" }) }));
    const { opaAllows } = await loadOpa({ NODE_ENV: "production", OPA_ENABLED: "true", OPA_URL: "http://opa:8181" });
    await expect(opaAllows(adminInput)).resolves.toBe(false);
  });
});
