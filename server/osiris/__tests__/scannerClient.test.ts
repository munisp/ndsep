/**
 * scannerClient unit tests (round 13, W3).
 *
 * Network is stubbed via vi.stubGlobal('fetch'). Covers the fail-closed
 * contract: without OSIRIS_SCANNER_KEY the scanner would 503, so scanHost
 * short-circuits to 'unavailable' WITHOUT calling fetch; a real 503 and an
 * unreachable host degrade identically. Also covers defensive payload
 * parsing for scanHost / cveForProduct and the KEV feed pass-through.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  scanHost,
  cveForProduct,
  kevFeed,
  scannerKeyPresent,
  __clearScannerCache,
} from "../scannerClient";

const mockFetch = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  __clearScannerCache();
  delete process.env.OSIRIS_SCANNER_KEY;
  process.env.OSIRIS_URL = "https://osiris.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanHost — fail-closed without scanner key", () => {
  it("returns unavailable and NEVER calls the scanner when the key is unset", async () => {
    const out = await scanHost("controller.example.ng");
    expect(out.status).toBe("unavailable");
    expect(out.scannerKeyPresent).toBe(false);
    expect(out.reason).toMatch(/scanner key/i);
    expect(out.ports).toEqual([]);
    expect(out.ssl).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled(); // short-circuit: no 503 dance
  });

  it("scannerKeyPresent() reflects env at call time", () => {
    expect(scannerKeyPresent()).toBe(false);
    process.env.OSIRIS_SCANNER_KEY = "k-123";
    expect(scannerKeyPresent()).toBe(true);
  });

  it("maps a real 503 to unavailable (never fabricates ports)", async () => {
    process.env.OSIRIS_SCANNER_KEY = "k-123";
    mockFetch.mockResolvedValue(jsonResponse(503, { error: "scanner offline" }));
    const out = await scanHost("controller.example.ng");
    expect(out.status).toBe("unavailable");
    expect(out.reason).toMatch(/503/);
    expect(out.ports).toEqual([]);
  });

  it("maps unreachable endpoints to unavailable", async () => {
    process.env.OSIRIS_SCANNER_KEY = "k-123";
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await scanHost("controller.example.ng");
    expect(out.status).toBe("unavailable");
    expect(out.ports).toEqual([]);
  });
});

describe("scanHost — defensive parsing", () => {
  it("parses ports and ssl from a 200 payload and sends the scanner key", async () => {
    process.env.OSIRIS_SCANNER_KEY = "k-123";
    mockFetch.mockResolvedValue(jsonResponse(200, {
      ports: [
        { port: 443, protocol: "tcp", state: "open", service: "https" },
        { port: "22", state: "open", service: "ssh", product: "OpenSSH", version: "8.9" },
        { port: 99999, state: "open" }, // out of range → dropped
        { port: "abc" }, // unparseable → dropped
      ],
      ssl: { valid: false, expired: true, not_after: "2026-01-01T00:00:00Z", issuer_org: "Expired CA" },
      scanned_at: "2026-05-01T00:00:00Z",
    }));
    const out = await scanHost("Controller.Example.ng");
    expect(out.status).toBe("ok");
    expect(out.host).toBe("controller.example.ng");
    expect(out.scannerKeyPresent).toBe(true);
    expect(out.ports).toHaveLength(2);
    expect(out.ports[1].port).toBe(22);
    expect(out.ports[1].product).toBe("OpenSSH");
    expect(out.ssl?.expired).toBe(true);
    expect(out.ssl?.issuer).toBe("Expired CA");

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/api/scanner");
    expect(String(url)).toContain("host=controller.example.ng");
    expect((init as { headers: Record<string, string> }).headers["X-Scanner-Key"]).toBe("k-123");
  });

  it("falls back to the legacy /api/osint/scan alias when the primary errors", async () => {
    process.env.OSIRIS_SCANNER_KEY = "k-123";
    mockFetch
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { open_ports: [{ port: 443, state: "open" }] }));
    const out = await scanHost("controller.example.ng");
    expect(out.status).toBe("ok");
    expect(out.ports.map((p) => p.port)).toEqual([443]);
    expect(String(mockFetch.mock.calls[1][0])).toContain("/api/osint/scan");
  });
});

describe("cveForProduct", () => {
  it("parses a list payload", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {
      results: [
        { cve_id: "CVE-2024-3094", cvss_score: 10, severity: "CRITICAL", description: "xz backdoor" },
        { id: "CVE-2023-44487", cvss: 7.5 },
      ],
    }));
    const out = await cveForProduct("OpenSSH");
    expect(out).toHaveLength(2);
    expect(out[0].cveId).toBe("CVE-2024-3094");
    expect(out[0].cvssScore).toBe(10);
    expect(out[1].cveId).toBe("CVE-2023-44487");
    expect(out[1].cvssScore).toBe(7.5);
  });

  it("returns [] when the feed is unreachable (no fabrication)", async () => {
    mockFetch.mockRejectedValue(new Error("timeout"));
    expect(await cveForProduct("OpenSSH")).toEqual([]);
  });

  it("returns [] for an empty query without calling the API", async () => {
    expect(await cveForProduct("  ")).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("kevFeed", () => {
  it("maps the cyber-threats feed into KEV entries", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {
      threats: [{ id: "CVE-2024-3094", name: "xz utils", vendor: "Tukaani", product: "xz", severity: "CRITICAL", date: "2024-03-29", source: "CISA" }],
      stats: {},
    }));
    const out = await kevFeed();
    expect(out).toEqual([{ id: "CVE-2024-3094", name: "xz utils", vendor: "Tukaani", product: "xz" }]);
  });
});
