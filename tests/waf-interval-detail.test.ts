import { describe, expect, it } from "vitest";
import { filterWafIntervalDetail } from "../lib/waf-interval-detail";

describe("WAF interval detail filtering", () => {
  it("filters only verified categories and already redacted addresses", () => {
    const result = filterWafIntervalDetail({ timestamp: "2026-08-20T00:00:00.000Z", blockedRequests: 8, threatTypes: ["sqli", "xss"], sourceAddresses: ["198.51.100.*", "2001:db8:1234:…"] }, "sql");
    expect(result.threatTypes).toEqual(["sqli"]); expect(result.sourceAddresses).toEqual([]);
  });
});
