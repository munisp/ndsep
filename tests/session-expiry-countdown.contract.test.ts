import { describe, expect, it } from "vitest";
import { secondsUntilSessionExpiry } from "../lib/session-countdown";

describe("session expiry countdown contract", () => {
  it("rounds partial seconds up so the user never sees an early expiry", () => {
    expect(secondsUntilSessionExpiry(10_001, 1_000)).toBe(10);
    expect(secondsUntilSessionExpiry(10_000, 1_000)).toBe(9);
  });
  it("never reports a negative countdown", () => expect(secondsUntilSessionExpiry(1_000, 2_000)).toBe(0));
});
