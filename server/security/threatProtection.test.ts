import { describe, expect, it } from "vitest";
import { shouldSkipDdosSlowDown } from "./threatProtection";

function request(path: string, ip = "127.0.0.1") {
  return { path, ip } as Parameters<typeof shouldSkipDdosSlowDown>[0];
}

describe("DDoS slow-down scope", () => {
  it("does not charge static PWA assets or browser routes against API throttling", () => {
    expect(shouldSkipDdosSlowDown(request("/assets/index.js"))).toBe(true);
    expect(shouldSkipDdosSlowDown(request("/sw.js"))).toBe(true);
    expect(shouldSkipDdosSlowDown(request("/registerSW.js"))).toBe(true);
    expect(shouldSkipDdosSlowDown(request("/organizations"))).toBe(true);
  });

  it("continues to protect dynamic API and OAuth endpoints", () => {
    expect(shouldSkipDdosSlowDown(request("/api/trpc/auth.me"))).toBe(false);
    expect(shouldSkipDdosSlowDown(request("/api/health"))).toBe(false);
    expect(shouldSkipDdosSlowDown(request("/api/oauth/callback"))).toBe(false);
    expect(shouldSkipDdosSlowDown(request("/oauth/authorize"))).toBe(false);
    expect(shouldSkipDdosSlowDown(request("/login"))).toBe(false);
  });
});
