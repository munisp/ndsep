/**
 * Round-9 tests: SSRF-safe outbound URL validation (FIX 4 markNotified).
 *
 * ack_endpoint_url must be https with a public hostname: no credentials, no
 * IP-literal private hosts, no localhost names; and DNS resolution must not
 * yield any private address (fail closed on DNS errors).
 */
import { describe, it, expect } from "vitest";
import {
  validateOutboundUrl,
  assertPublicHostname,
  isPrivateIpAddress,
} from "../../server/services/complaintLogic";

describe("isPrivateIpAddress", () => {
  it("flags RFC1918 / loopback / link-local / CGNAT / unspecified", () => {
    for (const ip of [
      "10.0.0.1", "10.255.255.254",
      "172.16.0.1", "172.31.255.1",
      "192.168.0.1", "192.168.100.200",
      "127.0.0.1", "127.1.2.3",
      "169.254.1.1", // link-local (cloud metadata!)
      "100.64.0.1", "100.127.0.1", // CGNAT
      "0.0.0.0", "0.1.2.3",
      "224.0.0.1", // multicast/reserved
      "::1", "::", "fe80::1", "fc00::1", "fd12::1",
      "::ffff:127.0.0.1", "::ffff:10.1.2.3", // v4-mapped
    ]) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });

  it("passes public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "203.0.113.10", "100.63.255.255", "172.32.0.1", "11.0.0.1"]) {
      expect(isPrivateIpAddress(ip), ip).toBe(false);
    }
  });

  it("does not misclassify hostnames", () => {
    expect(isPrivateIpAddress("example.com")).toBe(false);
  });
});

describe("validateOutboundUrl (synchronous rules)", () => {
  it("accepts https public hostnames", () => {
    const r = validateOutboundUrl("https://processor.example.com/ack");
    expect(r.ok).toBe(true);
    expect(r.hostname).toBe("processor.example.com");
  });

  it("rejects non-https schemes", () => {
    expect(validateOutboundUrl("http://processor.example.com/ack").ok).toBe(false);
    expect(validateOutboundUrl("ftp://example.com/x").ok).toBe(false);
    expect(validateOutboundUrl("gopher://127.0.0.1/").ok).toBe(false);
  });

  it("rejects credentials in the URL", () => {
    expect(validateOutboundUrl("https://user:pass@example.com/ack").ok).toBe(false);
  });

  it("rejects private IP literals", () => {
    expect(validateOutboundUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false); // cloud metadata
    expect(validateOutboundUrl("https://127.0.0.1:8080/ack").ok).toBe(false);
    expect(validateOutboundUrl("https://192.168.1.1/ack").ok).toBe(false);
    expect(validateOutboundUrl("https://[::1]/ack").ok).toBe(false);
    expect(validateOutboundUrl("https://[fe80::1]/ack").ok).toBe(false);
  });

  it("rejects localhost-style names", () => {
    expect(validateOutboundUrl("https://localhost/ack").ok).toBe(false);
    expect(validateOutboundUrl("https://app.localhost/ack").ok).toBe(false);
    expect(validateOutboundUrl("https://printer.local/ack").ok).toBe(false);
    expect(validateOutboundUrl("https://svc.internal/ack").ok).toBe(false);
  });

  it("rejects unparseable URLs", () => {
    expect(validateOutboundUrl("not a url").ok).toBe(false);
    expect(validateOutboundUrl("").ok).toBe(false);
  });
});

describe("assertPublicHostname (DNS-resolution half)", () => {
  const okLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  it("passes when all resolved addresses are public", async () => {
    const r = await assertPublicHostname("example.com", okLookup);
    expect(r.ok).toBe(true);
  });

  it("rejects when ANY resolved address is private", async () => {
    const mixed = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 }, // DNS rebinding attempt
    ];
    const r = await assertPublicHostname("evil.example.com", mixed);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private/i);
  });

  it("fails CLOSED on DNS errors", async () => {
    const failing = async () => { throw new Error("ENOTFOUND"); };
    const r = await assertPublicHostname("nonexistent.example.com", failing);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/DNS/);
  });

  it("fails closed on empty DNS results", async () => {
    const r = await assertPublicHostname("empty.example.com", async () => []);
    expect(r.ok).toBe(false);
  });

  it("short-circuits IP literals without DNS", async () => {
    expect((await assertPublicHostname("8.8.8.8", okLookup)).ok).toBe(true);
    expect((await assertPublicHostname("127.0.0.1", okLookup)).ok).toBe(false);
  });
});
