/**
 * Round-9 tests: non-TOCTOU rate-limit primitives + trusted-proxy-aware
 * client IP extraction (FIX 6, 8, 9, 10).
 */
import { describe, it, expect } from "vitest";
import {
  fixedWindowStart,
  counterExceedsLimit,
  extractClientIp,
  hashIp,
} from "../../server/services/complaintLogic";

const HOUR = 3_600_000;

describe("fixedWindowStart", () => {
  it("buckets timestamps into fixed windows", () => {
    expect(fixedWindowStart(0, HOUR).getTime()).toBe(0);
    expect(fixedWindowStart(HOUR - 1, HOUR).getTime()).toBe(0);
    expect(fixedWindowStart(HOUR, HOUR).getTime()).toBe(HOUR);
    expect(fixedWindowStart(HOUR + 12345, HOUR).getTime()).toBe(HOUR);
    expect(fixedWindowStart(2 * HOUR + 999, HOUR).getTime()).toBe(2 * HOUR);
  });

  it("adjacent instants can straddle a boundary (window roll)", () => {
    expect(fixedWindowStart(HOUR - 1, HOUR).getTime()).not.toBe(fixedWindowStart(HOUR, HOUR).getTime());
  });
});

describe("counterExceedsLimit (post-upsert check)", () => {
  it("allows up to the max, blocks above", () => {
    expect(counterExceedsLimit(1, 5)).toBe(false);
    expect(counterExceedsLimit(5, 5)).toBe(false);
    expect(counterExceedsLimit(6, 5)).toBe(true);
  });
});

describe("extractClientIp (trusted proxy awareness)", () => {
  it("trusts only the socket address with trustedProxyCount = 0", () => {
    expect(extractClientIp({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.9", 0)).toBe("10.0.0.9");
  });

  it("takes the rightmost untrusted XFF entry with one trusted proxy", () => {
    // client 1.2.3.4 → proxy A appends → XFF "1.2.3.4"; socket is proxy A.
    expect(extractClientIp({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.1", 1)).toBe("1.2.3.4");
  });

  it("is spoof-resistant: attacker-prepended entries are ignored", () => {
    // Attacker sends XFF "9.9.9.9"; the trusted proxy appends the real client.
    // With 1 trusted proxy, the client IP is the LAST entry, not the first.
    expect(extractClientIp({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }, "10.0.0.1", 1)).toBe("1.2.3.4");
  });

  it("handles two trusted proxies", () => {
    expect(extractClientIp({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.2" }, "10.0.0.3", 2)).toBe("1.2.3.4");
  });

  it("distrusts the header when the chain is shorter than the trusted count", () => {
    // Claims 3 trusted proxies but only 1 XFF entry → header unreliable.
    expect(extractClientIp({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.9", 3)).toBe("10.0.0.9");
  });

  it("falls back to the socket IP when no XFF header", () => {
    expect(extractClientIp({}, "10.0.0.9", 1)).toBe("10.0.0.9");
    expect(extractClientIp(undefined, "10.0.0.9", 1)).toBe("10.0.0.9");
  });

  it("never returns empty", () => {
    expect(extractClientIp({}, null, 0)).toBe("unknown");
    expect(extractClientIp({ "x-forwarded-for": "" }, "", 1)).toBe("unknown");
  });
});

describe("hashIp rate-limit keys", () => {
  it("action-scoped keys isolate limiters from each other", () => {
    const salt = "test-salt";
    expect(hashIp("complaints.submit|1.2.3.4", salt)).not.toBe(hashIp("complaints.track|1.2.3.4", salt));
    expect(hashIp("complaints.submit|1.2.3.4", salt)).toBe(hashIp("complaints.submit|1.2.3.4", salt));
    expect(hashIp("complaints.submit|1.2.3.4", salt)).not.toBe(hashIp("complaints.submit|1.2.3.4", "other-salt"));
  });
});
