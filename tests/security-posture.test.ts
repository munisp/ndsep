import { afterEach, describe, expect, it } from "vitest";
import { fallbackApiRateLimit, fallbackRateLimitTelemetry } from "../server/httpSecurity";
import { getSecurityPosture } from "../server/securityPosture";

const originalEndpoint = process.env.WAF_TELEMETRY_URL;
const originalToken = process.env.WAF_TELEMETRY_BEARER_TOKEN;

afterEach(() => {
  if (originalEndpoint === undefined) delete process.env.WAF_TELEMETRY_URL; else process.env.WAF_TELEMETRY_URL = originalEndpoint;
  if (originalToken === undefined) delete process.env.WAF_TELEMETRY_BEARER_TOKEN; else process.env.WAF_TELEMETRY_BEARER_TOKEN = originalToken;
});

describe("security posture telemetry", () => {
  it("counts only process-local fallback rejections", () => {
    const before = fallbackRateLimitTelemetry().rejectedRequests;
    fallbackApiRateLimit({ remoteAddress: "security-posture-test", limit: 1, now: 1 });
    fallbackApiRateLimit({ remoteAddress: "security-posture-test", limit: 1, now: 2 });
    expect(fallbackRateLimitTelemetry()).toMatchObject({ source: "application_local_fallback", rejectedRequests: before + 1, distributedGatewayTelemetry: "not_available_from_application_process" });
  });
  it("does not fabricate WAF statistics when authenticated telemetry is unconfigured", async () => {
    delete process.env.WAF_TELEMETRY_URL; delete process.env.WAF_TELEMETRY_BEARER_TOKEN;
    await expect(getSecurityPosture()).resolves.toMatchObject({ waf: { state: "unavailable", blockedRequestsLast5m: null } });
  });
});
