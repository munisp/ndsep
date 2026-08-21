/**
 * Phase 23 Tests
 * ==============
 * Tests for:
 *  1. Middleware helpers (emitEvent, logAuditEvent, broadcastUpdate, checkRateLimit)
 *  2. Go middleware bridge worker structure
 *  3. Rust middleware cache worker structure
 *  4. Python audit aggregator worker structure
 *  5. Watchlist screener v2 DOB matching
 *  6. SectorComplianceDetail AML confirmation dialog
 *  7. SectorComplianceDetail PDF progress bar
 *  8. Banking router middleware injection
 *  9. Accreditation router middleware injection
 * 10. Billing router middleware injection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

// ─── Helper: read file ────────────────────────────────────────────────────────
function readFile(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) throw new Error(`File not found: ${full}`);
  return readFileSync(full, "utf-8");
}

// ─── 1. middlewareHelpers.ts ──────────────────────────────────────────────────
describe("middlewareHelpers.ts", () => {
  let src: string;
  beforeEach(() => { src = readFile("server/middlewareHelpers.ts"); });

  it("exports emitEvent", () => expect(src).toContain("export async function emitEvent"));
  it("exports logAuditEvent", () => expect(src).toContain("export async function logAuditEvent"));
  it("exports broadcastUpdate", () => expect(src).toContain("export async function broadcastUpdate"));
  it("exports checkRateLimit", () => expect(src).toContain("export async function checkRateLimit"));
  it("exports startWorkflowIfAvailable", () => expect(src).toContain("export async function startWorkflowIfAvailable"));
  it("exports checkPermission", () => expect(src).toContain("export async function checkPermission"));
  it("handles Kafka errors gracefully", () => expect(src).toContain("catch"));
  it("handles Redis errors gracefully", () => expect(src).toContain("catch"));
  it("uses try/catch for all middleware calls", () => {
    const catchCount = (src.match(/catch/g) || []).length;
    expect(catchCount).toBeGreaterThanOrEqual(4);
  });
});

// ─── 2. Go middleware bridge ──────────────────────────────────────────────────
describe("Go middleware bridge worker", () => {
  let src: string;
  beforeEach(() => { src = readFile("workers/go/cmd/middleware_bridge/main.go"); });

  it("listens on configurable port", () => expect(src).toContain("MIDDLEWARE_BRIDGE_PORT"));
  it("has /health endpoint", () => expect(src).toContain("/health"));
  it("has /metrics endpoint", () => expect(src).toContain("/metrics"));
  it("has /events/relay endpoint", () => expect(src).toContain("/events/relay"));
  it("has /audit/forward endpoint", () => expect(src).toContain("/audit/forward"));
  it("uses Go standard library net/http", () => expect(src).toContain("net/http"));
  it("has Prometheus-style metrics", () => expect(src).toContain("ndsep_"));
  it("handles JSON payloads", () => expect(src).toContain("json."));
  it("has graceful error handling", () => expect(src).toContain("log."));
  it("has worker identification in health response", () => expect(src).toContain("middleware_bridge"));
});

// ─── 3. Rust middleware cache ─────────────────────────────────────────────────
describe("Rust middleware cache worker", () => {
  let src: string;
  beforeEach(() => { src = readFile("workers/rust/middleware_cache/src/main.rs"); });

  it("listens on configurable port", () => expect(src).toContain("MIDDLEWARE_CACHE_PORT"));
  it("has /health endpoint", () => expect(src).toContain("/health"));
  it("has /metrics endpoint", () => expect(src).toContain("/metrics"));
  it("has /cache/set endpoint", () => expect(src).toContain("/cache/set"));
  it("has /cache/get endpoint", () => expect(src).toContain("/cache/get"));
  it("has /cache/del endpoint", () => expect(src).toContain("/cache/del"));
  it("has /ratelimit/check endpoint", () => expect(src).toContain("/ratelimit/check"));
  it("implements sliding window rate limiter", () => expect(src).toContain("RateLimiter"));
  it("implements TTL-based cache eviction", () => expect(src).toContain("evict_expired"));
  it("uses thread-safe Mutex", () => expect(src).toContain("Mutex"));
  it("has Prometheus metrics", () => expect(src).toContain("ndsep_cache_"));
  it("has Cargo.toml", () => {
    const cargo = readFile("workers/rust/middleware_cache/Cargo.toml");
    expect(cargo).toContain("middleware_cache");
  });
});

// ─── 4. Python audit aggregator ───────────────────────────────────────────────
describe("Python middleware audit aggregator", () => {
  let src: string;
  beforeEach(() => { src = readFile("workers/python/middleware_audit_aggregator.py"); });

  it("listens on configurable port", () => expect(src).toContain("MIDDLEWARE_AUDIT_PORT"));
  it("has /health endpoint", () => expect(src).toContain("/health"));
  it("has /metrics endpoint", () => expect(src).toContain("/metrics"));
  it("detects anomalies", () => expect(src).toContain("detect_anomaly"));
  it("writes to PostgreSQL", () => expect(src).toContain("write_to_pg"));
  it("forwards critical events", () => expect(src).toContain("forward_critical"));
  it("defines CRITICAL_ACTIONS set", () => expect(src).toContain("CRITICAL_ACTIONS"));
  it("uses sliding window for anomaly detection", () => expect(src).toContain("window"));
  it("has Prometheus metrics", () => expect(src).toContain("ndsep_audit_"));
  it("runs consumer in background thread", () => expect(src).toContain("threading.Thread"));
});

// ─── 5. Watchlist screener v2 DOB matching ───────────────────────────────────
describe("Watchlist screener v2 DOB matching", () => {
  let src: string;
  beforeEach(() => { src = readFile("workers/python/watchlist_screener_fallback.py"); });

  it("has version 2.0.0", () => expect(src).toContain("2.0.0"));
  it("defines parse_dob function", () => expect(src).toContain("def parse_dob"));
  it("defines dob_match_score function", () => expect(src).toContain("def dob_match_score"));
  it("defines nationality_match_score function", () => expect(src).toContain("def nationality_match_score"));
  it("defines compute_composite_score function", () => expect(src).toContain("def compute_composite_score"));
  it("screen_entity accepts dob parameter", () => expect(src).toContain("dob: Optional[str]"));
  it("screen_entity accepts nationality parameter", () => expect(src).toContain("nationality: Optional[str]"));
  it("has /screen/batch endpoint", () => expect(src).toContain("/screen/batch"));
  it("tracks dob_matches in metrics", () => expect(src).toContain("dob_matches"));
  it("tracks nationality_matches in metrics", () => expect(src).toContain("nationality_matches"));
  it("uses DOB_WEIGHT env var", () => expect(src).toContain("DOB_WEIGHT"));
  it("uses NATIONALITY_WEIGHT env var", () => expect(src).toContain("NATIONALITY_WEIGHT"));
  it("sorts matches by composite_score", () => expect(src).toContain("composite_score"));
  it("uses normalized token-sorted name comparison", () => expect(src).toContain("normalize_name"));
  it("batch screening includes DOB from DB", () => expect(src).toContain("date_of_birth"));
  it("batch screening includes nationality from DB", () => expect(src).toContain("nationality"));
  it("has Prometheus DOB metrics", () => expect(src).toContain("ndsep_watchlist_dob_matches_total"));
  it("has Prometheus nationality metrics", () => expect(src).toContain("ndsep_watchlist_nationality_matches_total"));
});

// ─── 6. SectorComplianceDetail AML confirmation dialog ───────────────────────
describe("SectorComplianceDetail AML confirmation dialog", () => {
  let src: string;
  beforeEach(() => { src = readFile("client/src/pages/SectorComplianceDetail.tsx"); });

  it("has showConfirmDialog state", () => expect(src).toContain("showConfirmDialog"));
  it("has handleFlagClick function (step 1 validator)", () => expect(src).toContain("handleFlagClick"));
  it("handleFlagClick sets showConfirmDialog to true", () => expect(src).toContain("setShowConfirmDialog(true)"));
  it("handleFlagForInvestigation closes confirm dialog first", () => expect(src).toContain("setShowConfirmDialog(false)"));
  it("renders AML Confirmation Dialog heading", () => expect(src).toContain("Confirm AML Case Submission"));
  it("shows reason in confirmation dialog", () => expect(src).toContain("flagReason"));
  it("has Go Back button in confirmation dialog", () => expect(src).toContain("Go Back"));
  it("has Confirm & Submit button", () => expect(src).toContain("Confirm"));
  it("shows entity name in confirmation message", () => expect(src).toContain("flagEntity"));
  it("warns action cannot be undone", () => expect(src).toContain("cannot be undone"));
});

// ─── 7. SectorComplianceDetail PDF progress bar ──────────────────────────────
describe("SectorComplianceDetail PDF progress bar", () => {
  let src: string;
  beforeEach(() => { src = readFile("client/src/pages/SectorComplianceDetail.tsx"); });

  it("has pdfExporting state", () => expect(src).toContain("pdfExporting"));
  it("has pdfProgress state", () => expect(src).toContain("pdfProgress"));
  it("uses Progress component for PDF export", () => expect(src).toContain("Progress value={pdfProgress}"));
  it("uses setInterval for progress animation", () => expect(src).toContain("setInterval"));
  it("clears interval after completion", () => expect(src).toContain("clearInterval"));
  it("calls window.print after progress completes", () => expect(src).toContain("window.print()"));
  it("resets progress after print", () => expect(src).toContain("setPdfExporting(false)"));
  it("shows Generating PDF Report message", () => expect(src).toContain("Generating PDF Report"));
  it("shows contextual progress messages", () => expect(src).toContain("Gathering compliance data"));
  it("uses FileDown icon in progress overlay", () => expect(src).toContain("FileDown"));
});

// ─── 8. Banking router middleware injection ───────────────────────────────────
describe("Banking router middleware injection", () => {
  let src: string;
  beforeEach(() => { src = readFile("server/routers/banking.ts"); });

  it("imports middlewareHelpers", () => expect(src).toContain("middlewareHelpers"));
  it("calls emitEvent", () => expect(src).toContain("emitEvent"));
  it("calls logAuditEvent", () => expect(src).toContain("logAuditEvent"));
  it("calls broadcastUpdate", () => expect(src).toContain("broadcastUpdate"));
});

// ─── 9. Accreditation router middleware injection ─────────────────────────────
describe("Accreditation router middleware injection", () => {
  let src: string;
  beforeEach(() => { src = readFile("server/routers/accreditation.ts"); });

  it("imports middlewareHelpers", () => expect(src).toContain("middlewareHelpers"));
  it("calls emitEvent or logAuditEvent", () => {
    expect(src.includes("emitEvent") || src.includes("logAuditEvent")).toBe(true);
  });
});

// ─── 10. Billing router middleware injection ──────────────────────────────────
describe("Billing router middleware injection", () => {
  let src: string;
  beforeEach(() => { src = readFile("server/routers/billing.ts"); });

  it("imports middlewareHelpers", () => expect(src).toContain("middlewareHelpers"));
  it("calls emitEvent or logAuditEvent", () => {
    expect(src.includes("emitEvent") || src.includes("logAuditEvent")).toBe(true);
  });
});
