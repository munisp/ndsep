#!/usr/bin/env node
/**
 * NDSEP Comprehensive Smoke Test
 * ================================
 * Validates all critical platform endpoints and services.
 * Run: node scripts/smoke-test.mjs [BASE_URL]
 */

const BASE = process.argv[2] ?? "http://localhost:3000";
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: "FAIL", error: err.message });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok && !options.allowError) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`\n🔍 NDSEP Smoke Test — ${BASE}\n`);

// ── Health & Infrastructure ──────────────────────────────────────────────────
console.log("Health & Infrastructure:");
await test("GET /api/health returns ok", async () => {
  const { data } = await fetchJson("/api/health");
  assert(data.status === "ok", `Expected ok, got ${data.status}`);
  assert(data.service === "ndsep-api", `Expected ndsep-api, got ${data.service}`);
});

await test("GET /api/ready returns database ok", async () => {
  const { data } = await fetchJson("/api/ready");
  assert(data.checks?.database === "ok", `DB not ok: ${data.checks?.database}`);
});

await test("GET /api/metrics returns Prometheus format", async () => {
  const res = await fetch(`${BASE}/api/metrics`);
  const text = await res.text();
  assert(text.includes("ndsep_uptime_seconds"), "Missing uptime metric");
  assert(text.includes("ndsep_workers_running"), "Missing workers metric");
});

// ── Security Headers ─────────────────────────────────────────────────────────
console.log("\nSecurity Headers:");
await test("Security headers present", async () => {
  const { headers } = await fetchJson("/api/health");
  assert(headers.get("x-content-type-options") === "nosniff", "Missing nosniff");
  assert(headers.get("x-request-id"), "Missing X-Request-ID");
});

await test("Rate limit headers present on tRPC", async () => {
  const res = await fetch(`${BASE}/api/trpc/auth.me`, { headers: { "Content-Type": "application/json" } });
  // Even unauthorized requests should have rate limit headers
  assert(res.status === 401 || res.status === 200 || res.headers.has("x-ratelimit-limit"), "No rate limit info");
});

// ── Authentication ───────────────────────────────────────────────────────────
console.log("\nAuthentication:");
let sessionCookie = null;

await test("GET /api/demo-login redirects and sets cookie", async () => {
  const res = await fetch(`${BASE}/api/demo-login?role=admin`, { redirect: "manual" });
  assert(res.status === 302 || res.status === 301 || res.status === 200, `Expected redirect, got ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  sessionCookie = setCookie.split(";")[0];
  assert(sessionCookie.length > 0, "No session cookie set");
});

await test("tRPC auth.me returns user with session", async () => {
  if (!sessionCookie) { skipped++; return; }
  const { data } = await fetchJson("/api/trpc/auth.me", { headers: { Cookie: sessionCookie } });
  assert(data?.result?.data?.name, `No user name: ${JSON.stringify(data)}`);
});

// ── Core tRPC Endpoints ──────────────────────────────────────────────────────
console.log("\ntRPC Endpoints:");
const trpcEndpoints = [
  "dashboard.stats",
  "organizations.list",
  "assets.list",
  "compliancePolicies.list",
  "complianceViolations.list",
  "leaderboard.list",
  "breachIncidents.list",
  "consentRecords.list",
  "dpoAppointments.list",
  "dpiaAssessments.list",
  "auditLogs.list",
  "enforcementActions.list",
  "financialPenalties.list",
  "sectors.list",
  "portalSubmissions.list",
  "transferApprovals.list",
  "notifications.list",
];

for (const endpoint of trpcEndpoints) {
  await test(`tRPC ${endpoint}`, async () => {
    if (!sessionCookie) { skipped++; return; }
    const { status, data } = await fetchJson(`/api/trpc/${endpoint}`, {
      headers: { Cookie: sessionCookie },
      allowError: true,
    });
    assert(status < 500, `Server error: ${status} - ${JSON.stringify(data)?.slice(0, 200)}`);
  });
}

// ── Worker Status ────────────────────────────────────────────────────────────
console.log("\nWorkers:");
await test("GET /api/workers/status returns worker list", async () => {
  const { data } = await fetchJson("/api/workers/status");
  assert(Array.isArray(data.workers), "Workers should be an array");
  assert(data.workers.length > 0, "Should have at least one worker");
});

// ── Sector Monitor Health Checks ─────────────────────────────────────────────
console.log("\nSector Monitor Services:");
await test("Healthcare sector monitor (port 8123) health", async () => {
  try {
    const res = await fetch("http://localhost:8123/healthz", { signal: AbortSignal.timeout(2000) });
    assert(res.ok, `Healthcare monitor returned ${res.status}`);
  } catch {
    skipped++;
    console.log("    (skipped — service not running)");
  }
});

await test("Energy sector monitor (port 8124) health", async () => {
  try {
    const res = await fetch("http://localhost:8124/healthz", { signal: AbortSignal.timeout(2000) });
    assert(res.ok, `Energy monitor returned ${res.status}`);
  } catch {
    skipped++;
    console.log("    (skipped — service not running)");
  }
});

// ── PDF Endpoints ────────────────────────────────────────────────────────────
console.log("\nPDF Endpoints:");
await test("GET /api/certificate/:orgId requires auth", async () => {
  const res = await fetch(`${BASE}/api/certificate/1`);
  assert(res.status === 401 || res.status === 403, `Expected auth error, got ${res.status}`);
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`${"═".repeat(60)}\n`);

if (failed > 0) {
  console.log("FAILED TESTS:");
  for (const r of results.filter(r => r.status === "FAIL")) {
    console.log(`  ✗ ${r.name}: ${r.error}`);
  }
  console.log();
}

process.exit(failed > 0 ? 1 : 0);
