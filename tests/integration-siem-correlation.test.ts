import { afterEach, describe, expect, it } from "vitest";
import { getAllowlistedSiemCorrelationUrl } from "../server/integrationSettingsRepository";

const template = process.env.SIEM_CORRELATION_URL_TEMPLATE;
const allowlist = process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS;

afterEach(() => { if (template === undefined) delete process.env.SIEM_CORRELATION_URL_TEMPLATE; else process.env.SIEM_CORRELATION_URL_TEMPLATE = template; if (allowlist === undefined) delete process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS; else process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS = allowlist; });

describe("SIEM correlation links", () => {
  it("builds only HTTPS allowlisted event pivots", () => {
    process.env.SIEM_CORRELATION_URL_TEMPLATE = "https://siem.example.test/search?event={eventId}";
    process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS = "siem.example.test";
    expect(getAllowlistedSiemCorrelationUrl("event/a")).toBe("https://siem.example.test/search?event=event%2Fa");
  });
  it("rejects unallowlisted or non-HTTPS pivots", () => {
    process.env.SIEM_CORRELATION_URL_TEMPLATE = "http://siem.example.test/{eventId}";
    process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS = "siem.example.test";
    expect(getAllowlistedSiemCorrelationUrl("event-a")).toBeNull();
  });
});
