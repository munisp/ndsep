/**
 * Phase 44 — ROPA Export, Automated Decision Review, Privacy Notices,
 *            Accreditation Renewal, Home Live Stats, ropaPdf Module
 *
 * Covers:
 * - ropa.export procedure (PBAC exportProcedure, rejects unauthenticated)
 * - automatedDecisions.requestReview (rejects missing id, rejects unauthenticated)
 * - automatedDecisions.completeReview (rejects missing outcome, rejects unauthenticated)
 * - privacyNotices.update (rejects unauthenticated)
 * - accreditation.submitRenewal (rejects unauthenticated)
 * - publicRegistry.sectorStats (public, returns array)
 * - ropaPdf.ts module exports generateRopaPdf function
 * - ropa_generator.py uses correct column names (purpose, ropa_lawful_basis, etc.)
 * - RopaRecords.tsx has export mutation wired
 * - AutomatedDecisions.tsx has requestReview + completeReview mutations
 * - PrivacyNotices.tsx has update mutation for publish workflow
 * - AccreditationStatus.tsx has submitRenewal mutation
 * - DpoDashboard.tsx has requestReview mutation inline
 * - Home.tsx uses publicRegistry.sectorStats live query
 */
import { describe, it, expect } from "vitest";
import http from "http";
import fs from "fs";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// ── Helpers ───────────────────────────────────────────────────────────────────
function get(
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 3000,
        path: url.pathname + url.search,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers as Record<string, string> })
        );
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 3000,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(data);
    req.end();
  });
}

function trpcPost(
  procedure: string,
  input: unknown
): Promise<{ status: number; parsed: any }> {
  return post(`/api/trpc/${procedure}`, input).then(({ status, body }) => {
    try {
      return { status, parsed: JSON.parse(body) };
    } catch {
      return { status, parsed: { raw: body } };
    }
  });
}

function trpcGet(
  procedure: string,
  input?: unknown
): Promise<{ status: number; parsed: any }> {
  const query = input
    ? `?input=${encodeURIComponent(JSON.stringify(input))}`
    : "";
  return get(`/api/trpc/${procedure}${query}`).then(({ status, body }) => {
    try {
      return { status, parsed: JSON.parse(body) };
    } catch {
      return { status, parsed: { raw: body } };
    }
  });
}

function getErrorCode(parsed: any): string | undefined {
  return (
    parsed?.error?.json?.data?.code ??
    parsed?.error?.data?.code ??
    parsed?.result?.data?.error?.code
  );
}

// ── 1. Server Health ──────────────────────────────────────────────────────────
describe("Phase 44 — Server Health", () => {
  it("server responds to tRPC health check", async () => {
    const { status } = await get("/api/trpc/auth.me");
    expect([200, 401]).toContain(status);
  });
});

// ── 2. ropa.export PBAC enforcement ──────────────────────────────────────────
describe("Phase 44 — ropa.export PBAC", () => {
  it("ropa.export rejects unauthenticated request", async () => {
    const { parsed } = await trpcPost("ropa.export", { format: "json" });
    const code = getErrorCode(parsed);
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("ropa.export rejects invalid format", async () => {
    const { parsed } = await trpcPost("ropa.export", { format: "xlsx" });
    const code = getErrorCode(parsed);
    expect(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("ropa.export accepts pdf format input (auth check)", async () => {
    const { parsed } = await trpcPost("ropa.export", { format: "pdf" });
    const code = getErrorCode(parsed);
    // Must fail with auth error, not a 500 or parse error
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });
});

// ── 3. automatedDecisions.requestReview ──────────────────────────────────────
describe("Phase 44 — automatedDecisions.requestReview", () => {
  it("requestReview rejects unauthenticated request", async () => {
    const { parsed } = await trpcPost("automatedDecisions.requestReview", {
      id: 1,
    });
    const code = getErrorCode(parsed);
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("requestReview rejects missing id", async () => {
    const { parsed } = await trpcPost("automatedDecisions.requestReview", {});
    const code = getErrorCode(parsed);
    expect(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("requestReview rejects negative id", async () => {
    const { parsed } = await trpcPost("automatedDecisions.requestReview", {
      id: -1,
    });
    const code = getErrorCode(parsed);
    expect(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });
});

// ── 4. automatedDecisions.completeReview ─────────────────────────────────────
describe("Phase 44 — automatedDecisions.completeReview", () => {
  it("completeReview rejects unauthenticated request", async () => {
    const { parsed } = await trpcPost("automatedDecisions.completeReview", {
      id: 1,
      outcome: "Approved after manual review",
    });
    const code = getErrorCode(parsed);
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("completeReview rejects missing outcome", async () => {
    const { parsed } = await trpcPost("automatedDecisions.completeReview", {
      id: 1,
    });
    const code = getErrorCode(parsed);
    expect(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("completeReview rejects empty outcome string", async () => {
    const { parsed } = await trpcPost("automatedDecisions.completeReview", {
      id: 1,
      outcome: "",
    });
    const code = getErrorCode(parsed);
    expect(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });
});

// ── 5. privacyNotices.update PBAC ────────────────────────────────────────────
describe("Phase 44 — privacyNotices.update PBAC", () => {
  it("privacyNotices.update rejects unauthenticated request", async () => {
    const { parsed } = await trpcPost("privacyNotices.update", {
      id: 1,
      status: "published",
    });
    const code = getErrorCode(parsed);
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("privacyNotices.update rejects invalid status enum", async () => {
    const { parsed } = await trpcPost("privacyNotices.update", {
      id: 1,
      status: "invalid_status",
    });
    const code = getErrorCode(parsed);
    expect(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("privacyNotices.delete uses deleteProcedure", () => {
    const content = fs.readFileSync(
      "./server/routers.ts",
      "utf-8"
    );
    // privacyNotices.delete should use deleteProcedure
    expect(content).toContain("delete: deleteProcedure");
  });
});

// ── 6. accreditation.submitRenewal PBAC ──────────────────────────────────────
describe("Phase 44 — accreditation.submitRenewal PBAC", () => {
  it("submitRenewal rejects unauthenticated request", async () => {
    const { parsed } = await trpcPost("accreditation.submitRenewal", {});
    const code = getErrorCode(parsed);
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(code);
  });

  it("submitRenewal is defined in accreditation router", () => {
    const content = fs.readFileSync(
      "./server/routers/accreditation.ts",
      "utf-8"
    );
    expect(content).toContain("submitRenewal");
    expect(content).toContain("protectedProcedure");
  });
});

// ── 7. publicRegistry.sectorStats (public endpoint) ─────────────────────────
describe("Phase 44 — publicRegistry.sectorStats", () => {
  it("sectorStats is accessible without auth", async () => {
    const { status, parsed } = await trpcGet("publicRegistry.sectorStats");
    // Should return 200 with result data (or at least not UNAUTHORIZED)
    expect(status).toBe(200);
    expect(parsed?.result?.data).toBeDefined();
  });

  it("sectorStats returns an array", async () => {
    const { parsed } = await trpcGet("publicRegistry.sectorStats");
    const raw = parsed?.result?.data;
    // superjson wraps the result as {json: [...]} — unwrap if needed
    const data = Array.isArray(raw) ? raw : (raw?.json ?? raw);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── 8. ropaPdf.ts module ─────────────────────────────────────────────────────
describe("Phase 44 — ropaPdf.ts Module", () => {
  it("ropaPdf.ts file exists", () => {
    const exists = fs.existsSync("./server/ropaPdf.ts");
    expect(exists).toBe(true);
  });

  it("ropaPdf.ts exports generateRopaPdf function", () => {
    const content = fs.readFileSync(
      "./server/ropaPdf.ts",
      "utf-8"
    );
    expect(content).toContain("export function generateRopaPdf");
  });

  it("ropaPdf.ts uses PDFDocument from pdfkit", () => {
    const content = fs.readFileSync(
      "./server/ropaPdf.ts",
      "utf-8"
    );
    expect(content).toContain("PDFDocument");
  });

  it("routers.ts imports generateRopaPdf from ropaPdf", () => {
    const content = fs.readFileSync(
      "./server/routers.ts",
      "utf-8"
    );
    expect(content).toContain("generateRopaPdf");
    expect(content).toContain("./ropaPdf");
  });
});

// ── 9. ropa_generator.py column name fixes ───────────────────────────────────
describe("Phase 44 — ropa_generator.py Column Fixes", () => {
  it("ropa_generator.py uses 'purpose' not 'processing_purpose'", () => {
    const content = fs.readFileSync(
      "./workers/python/ropa_generator.py",
      "utf-8"
    );
    expect(content).toContain('"purpose"');
    expect(content).not.toContain('"processing_purpose"');
  });

  it("ropa_generator.py uses 'ropa_lawful_basis' not 'lawful_basis'", () => {
    const content = fs.readFileSync(
      "./workers/python/ropa_generator.py",
      "utf-8"
    );
    expect(content).toContain("ropa_lawful_basis");
    expect(content).not.toContain('"lawful_basis"');
  });

  it("ropa_generator.py uses 'cross_border_transfers' not 'cross_border_transfer'", () => {
    const content = fs.readFileSync(
      "./workers/python/ropa_generator.py",
      "utf-8"
    );
    expect(content).toContain("cross_border_transfers");
    expect(content).not.toContain('"cross_border_transfer"');
  });

  it("ropa_generator.py uses 'is_active' not 'ropa_status'", () => {
    const content = fs.readFileSync(
      "./workers/python/ropa_generator.py",
      "utf-8"
    );
    expect(content).toContain("is_active");
    expect(content).not.toContain('"ropa_status"');
  });
});

// ── 10. RopaRecords.tsx frontend wiring ──────────────────────────────────────
describe("Phase 44 — RopaRecords.tsx Frontend Wiring", () => {
  it("RopaRecords.tsx has export mutation wired to ropa.export", () => {
    const content = fs.readFileSync(
      "./client/src/pages/RopaRecords.tsx",
      "utf-8"
    );
    expect(content).toContain("ropa.export");
    expect(content).toContain("useMutation");
    expect(content).toContain("exportMutation");
  });

  it("RopaRecords.tsx has create, update, delete mutations", () => {
    const content = fs.readFileSync(
      "./client/src/pages/RopaRecords.tsx",
      "utf-8"
    );
    expect(content).toContain("ropa.create");
    expect(content).toContain("ropa.update");
    expect(content).toContain("ropa.delete");
  });

  it("RopaRecords.tsx has Export PDF button", () => {
    const content = fs.readFileSync(
      "./client/src/pages/RopaRecords.tsx",
      "utf-8"
    );
    expect(content).toContain("Export PDF");
  });
});

// ── 11. AutomatedDecisions.tsx frontend wiring ───────────────────────────────
describe("Phase 44 — AutomatedDecisions.tsx Frontend Wiring", () => {
  it("AutomatedDecisions.tsx has requestReview mutation", () => {
    const content = fs.readFileSync(
      "./client/src/pages/AutomatedDecisions.tsx",
      "utf-8"
    );
    expect(content).toContain("automatedDecisions.requestReview");
    expect(content).toContain("requestReviewMutation");
  });

  it("AutomatedDecisions.tsx has completeReview mutation", () => {
    const content = fs.readFileSync(
      "./client/src/pages/AutomatedDecisions.tsx",
      "utf-8"
    );
    expect(content).toContain("automatedDecisions.completeReview");
    expect(content).toContain("completeReviewMutation");
  });

  it("AutomatedDecisions.tsx has Request Review button", () => {
    const content = fs.readFileSync(
      "./client/src/pages/AutomatedDecisions.tsx",
      "utf-8"
    );
    expect(content).toContain("Request Review");
  });

  it("AutomatedDecisions.tsx has Complete Review button", () => {
    const content = fs.readFileSync(
      "./client/src/pages/AutomatedDecisions.tsx",
      "utf-8"
    );
    expect(content).toContain("Complete Review");
  });
});

// ── 12. PrivacyNotices.tsx frontend wiring ───────────────────────────────────
describe("Phase 44 — PrivacyNotices.tsx Frontend Wiring", () => {
  it("PrivacyNotices.tsx has update mutation for publish workflow", () => {
    const content = fs.readFileSync(
      "./client/src/pages/PrivacyNotices.tsx",
      "utf-8"
    );
    expect(content).toContain("privacyNotices.update");
    expect(content).toContain("updateMutation");
  });

  it("PrivacyNotices.tsx has Publish button", () => {
    const content = fs.readFileSync(
      "./client/src/pages/PrivacyNotices.tsx",
      "utf-8"
    );
    expect(content).toContain("Publish");
  });

  it("PrivacyNotices.tsx has Submit for Review button", () => {
    const content = fs.readFileSync(
      "./client/src/pages/PrivacyNotices.tsx",
      "utf-8"
    );
    expect(content).toContain("Submit for Review");
  });
});

// ── 13. AccreditationStatus.tsx frontend wiring ──────────────────────────────
describe("Phase 44 — AccreditationStatus.tsx Frontend Wiring", () => {
  it("AccreditationStatus.tsx has submitRenewal mutation", () => {
    const content = fs.readFileSync(
      "./client/src/pages/AccreditationStatus.tsx",
      "utf-8"
    );
    expect(content).toContain("accreditation.submitRenewal");
    expect(content).toContain("renewalMutation");
  });
});

// ── 14. DpoDashboard.tsx frontend wiring ─────────────────────────────────────
describe("Phase 44 — DpoDashboard.tsx Frontend Wiring", () => {
  it("DpoDashboard.tsx has inline requestReview mutation", () => {
    const content = fs.readFileSync(
      "./client/src/pages/DpoDashboard.tsx",
      "utf-8"
    );
    expect(content).toContain("automatedDecisions.requestReview");
    expect(content).toContain("requestReviewMutation");
  });
});

// ── 15. Home.tsx live sectorStats ────────────────────────────────────────────
describe("Phase 44 — Home.tsx Live sectorStats", () => {
  it("Home.tsx uses publicRegistry.sectorStats live query", () => {
    const content = fs.readFileSync(
      "./client/src/pages/Home.tsx",
      "utf-8"
    );
    expect(content).toContain("publicRegistry.sectorStats");
    expect(content).toContain("sectorStats");
  });

  it("Home.tsx computes totalOrgs from sectorStats", () => {
    const content = fs.readFileSync(
      "./client/src/pages/Home.tsx",
      "utf-8"
    );
    expect(content).toContain("totalOrgs");
  });
});

// ── 16. ropa.export uses exportProcedure ─────────────────────────────────────
describe("Phase 44 — ropa.export Uses exportProcedure", () => {
  it("routers.ts uses exportProcedure for ropa.export", () => {
    const content = fs.readFileSync(
      "./server/routers.ts",
      "utf-8"
    );
    // Find the export: exportProcedure line within the ropa router
    expect(content).toContain("export: exportProcedure");
  });
});

// ── 17. automatedDecisions schema has human review columns ───────────────────
describe("Phase 44 — DB Schema Human Review Columns", () => {
  it("drizzle schema has humanReviewRequested column", () => {
    const content = fs.readFileSync(
      "./drizzle/schema.ts",
      "utf-8"
    );
    expect(content).toContain("humanReviewRequested");
    expect(content).toContain("human_review_requested");
  });

  it("drizzle schema has humanReviewOutcome column", () => {
    const content = fs.readFileSync(
      "./drizzle/schema.ts",
      "utf-8"
    );
    expect(content).toContain("humanReviewOutcome");
  });
});

// ── 18. ropa.list is public ──────────────────────────────────────────────────
describe("Phase 44 — ropa.list Public Access", () => {
  it("ropa.list is accessible without auth", async () => {
    const { status, parsed } = await trpcGet("ropa.list");
    expect(status).toBe(200);
    expect(parsed?.result?.data).toBeDefined();
  });

  it("ropa.list returns an array", async () => {
    const { parsed } = await trpcGet("ropa.list");
    const raw = parsed?.result?.data;
    // superjson wraps the result as {json: [...]} — unwrap if needed
    const data = Array.isArray(raw) ? raw : (raw?.json ?? raw);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── 19. automatedDecisions.list is public ────────────────────────────────────
describe("Phase 44 — automatedDecisions.list Public Access", () => {
  it("automatedDecisions.list is accessible without auth", async () => {
    const { status, parsed } = await trpcGet("automatedDecisions.list");
    expect(status).toBe(200);
    expect(parsed?.result?.data).toBeDefined();
  });
});

// ── 20. privacyNotices.list is public ────────────────────────────────────────
describe("Phase 44 — privacyNotices.list Public Access", () => {
  it("privacyNotices.list is accessible without auth", async () => {
    const { status, parsed } = await trpcGet("privacyNotices.list");
    expect(status).toBe(200);
    expect(parsed?.result?.data).toBeDefined();
  });
});
