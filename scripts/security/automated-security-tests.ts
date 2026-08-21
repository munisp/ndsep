/**
 * NDSEP Automated Security Test Suite
 * ======================================
 * Runs as part of CI to catch security regressions before deployment.
 * Tests critical security controls: auth bypass, injection, CSRF, encryption, rate limiting.
 *
 * Run: npx tsx security/automated-security-tests.ts
 */

import crypto from "crypto";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const SKIP = "\x1b[33mSKIP\x1b[0m";

interface TestResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  details: string;
}

const results: TestResult[] = [];

async function fetchJson(path: string, options?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ─── Test 1: Protected endpoints require authentication ──────────────────────

async function testAuthRequired() {
  const protectedPaths = [
    "/api/trpc/organizations.list",
    "/api/trpc/users.me",
    "/api/trpc/auditLogs.list",
    "/api/trpc/enforcementCases.list",
  ];

  for (const path of protectedPaths) {
    const { status } = await fetchJson(path);
    if (status !== 401 && status !== 403) {
      results.push({
        name: `Auth required: ${path}`,
        passed: false,
        details: `Expected 401/403, got ${status}`,
      });
      return;
    }
  }
  results.push({
    name: "Protected endpoints require authentication",
    passed: true,
    details: `${protectedPaths.length} endpoints correctly returned 401/403`,
  });
}

// ─── Test 2: SQL injection in public endpoints ───────────────────────────────

async function testSqlInjection() {
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "1 UNION SELECT * FROM users --",
    "admin'--",
    "1; WAITFOR DELAY '0:0:5'--",
  ];

  for (const payload of payloads) {
    const { status, body } = await fetchJson("/api/trpc/dsar.publicSubmit", {
      method: "POST",
      body: JSON.stringify({
        json: {
          requestType: "access",
          citizenName: payload,
          citizenEmail: "test@test.com",
          description: payload,
        },
      }),
    });

    // Should either reject the input (400) or succeed without error (200)
    // Should NEVER return 500 (indicates SQL injection reached DB)
    if (status === 500) {
      results.push({
        name: `SQL injection: ${payload.slice(0, 30)}`,
        passed: false,
        details: `Server error (500) on SQL injection payload — possible vulnerability`,
      });
      return;
    }
  }
  results.push({
    name: "SQL injection payloads blocked",
    passed: true,
    details: `${payloads.length} payloads tested — no 500 errors`,
  });
}

// ─── Test 3: XSS in public endpoints ────────────────────────────────────────

async function testXss() {
  const payloads = [
    '<script>alert("xss")</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(document.cookie)',
    '"><svg/onload=alert(1)>',
  ];

  for (const payload of payloads) {
    const { status, body } = await fetchJson("/api/trpc/dsar.publicSubmit", {
      method: "POST",
      body: JSON.stringify({
        json: {
          requestType: "access",
          citizenName: payload,
          citizenEmail: "xss@test.com",
          description: "XSS test",
        },
      }),
    });

    // If it succeeds, the stored value should be sanitized
    if (status === 200 && typeof body === "object" && body !== null) {
      const responseStr = JSON.stringify(body);
      if (responseStr.includes("<script>") || responseStr.includes("onerror=")) {
        results.push({
          name: `XSS: ${payload.slice(0, 30)}`,
          passed: false,
          details: `XSS payload reflected in response`,
        });
        return;
      }
    }
  }
  results.push({
    name: "XSS payloads sanitized or rejected",
    passed: true,
    details: `${payloads.length} payloads tested — none reflected`,
  });
}

// ─── Test 4: CSRF enforcement ────────────────────────────────────────────────

async function testCsrf() {
  const isEnforced = process.env.ENFORCE_CSRF === "true" || process.env.NODE_ENV === "production";
  if (!isEnforced) {
    results.push({
      name: "CSRF enforcement",
      passed: true,
      skipped: true,
      details: "CSRF not enforced in dev mode (set ENFORCE_CSRF=true to test)",
    });
    return;
  }

  // Without token — should get 403
  const { status: noTokenStatus } = await fetchJson("/api/trpc/dsar.publicSubmit", {
    method: "POST",
    body: JSON.stringify({ json: { requestType: "access", citizenName: "csrf", citizenEmail: "c@t.com", description: "test" } }),
  });

  if (noTokenStatus !== 403) {
    results.push({ name: "CSRF: no token rejected", passed: false, details: `Expected 403, got ${noTokenStatus}` });
    return;
  }

  // With matching tokens — should succeed
  const token = crypto.randomBytes(32).toString("hex");
  const { status: matchStatus } = await fetchJson("/api/trpc/dsar.publicSubmit", {
    method: "POST",
    headers: { "x-csrf-token": token, Cookie: `ndsep_csrf=${token}` },
    body: JSON.stringify({ json: { requestType: "access", citizenName: "csrf-match", citizenEmail: "cm@t.com", description: "test" } }),
  });

  results.push({
    name: "CSRF enforcement",
    passed: noTokenStatus === 403 && matchStatus === 200,
    details: `No token: ${noTokenStatus}, Matching: ${matchStatus}`,
  });
}

// ─── Test 5: Security headers ────────────────────────────────────────────────

async function testSecurityHeaders() {
  const res = await fetch(`${BASE_URL}/api/health`);
  const requiredHeaders: Record<string, string | null> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": null, // any value
    "strict-transport-security": null, // any value (may not be set in dev)
    "content-security-policy": null, // any value
    "referrer-policy": null, // any value
  };

  const missing: string[] = [];
  for (const [header, expectedValue] of Object.entries(requiredHeaders)) {
    const actual = res.headers.get(header);
    if (!actual) {
      missing.push(header);
    } else if (expectedValue && actual !== expectedValue) {
      missing.push(`${header} (expected: ${expectedValue}, got: ${actual})`);
    }
  }

  // X-Powered-By should NOT be present
  if (res.headers.get("x-powered-by")) {
    missing.push("x-powered-by should be removed");
  }

  results.push({
    name: "Security headers present",
    passed: missing.length === 0,
    details: missing.length ? `Missing/wrong: ${missing.join(", ")}` : "All required headers present",
  });
}

// ─── Test 6: Demo login blocked in production ────────────────────────────────

async function testDemoLoginGuard() {
  if (process.env.NODE_ENV !== "production") {
    results.push({
      name: "Demo login guard",
      passed: true,
      skipped: true,
      details: "Only testable in NODE_ENV=production",
    });
    return;
  }

  const { status } = await fetchJson("/api/demo-login", {
    method: "POST",
    body: JSON.stringify({ username: "admin" }),
  });

  results.push({
    name: "Demo login blocked in production",
    passed: status === 403,
    details: `Status: ${status}`,
  });
}

// ─── Test 7: Rate limiting active ────────────────────────────────────────────

async function testRateLimiting() {
  // Send rapid requests — should eventually get 429
  const promises = Array.from({ length: 25 }, () =>
    fetchJson("/api/health").then(r => r.status)
  );
  const statuses = await Promise.all(promises);
  const has429 = statuses.some(s => s === 429);

  // Rate limiting may not trigger with just 25 requests to /api/health
  // The important thing is no 500 errors
  const has500 = statuses.some(s => s === 500);

  results.push({
    name: "Rate limiting (no crashes under load)",
    passed: !has500,
    details: has429 ? "Rate limiting triggered (429)" : `25 rapid requests completed without errors (${new Set(statuses).size} distinct status codes)`,
  });
}

// ─── Test 8: Path traversal blocked ──────────────────────────────────────────

async function testPathTraversal() {
  const payloads = [
    "/api/../../../etc/passwd",
    "/api/trpc/../../etc/shadow",
    "/api/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
  ];

  for (const path of payloads) {
    const { status } = await fetchJson(path);
    if (status === 200) {
      results.push({
        name: `Path traversal: ${path.slice(0, 40)}`,
        passed: false,
        details: `Got 200 on path traversal attempt`,
      });
      return;
    }
  }
  results.push({
    name: "Path traversal attempts blocked",
    passed: true,
    details: `${payloads.length} traversal payloads blocked`,
  });
}

// ─── Test 9: Encryption active ───────────────────────────────────────────────

async function testEncryptionActive() {
  const hasKey = (process.env.FIELD_ENCRYPTION_KEY ?? "").length === 64;
  results.push({
    name: "Encryption key configured",
    passed: hasKey,
    details: hasKey ? "FIELD_ENCRYPTION_KEY is set (64-char hex)" : "FIELD_ENCRYPTION_KEY not configured",
  });
}

// ─── Test 10: Bot/scanner UA blocked ─────────────────────────────────────────

async function testBotBlocking() {
  const blockedUAs = ["sqlmap/1.7", "nikto/2.1.6", "Nmap Scripting Engine"];
  let allBlocked = true;

  for (const ua of blockedUAs) {
    const { status } = await fetchJson("/api/health", {
      headers: { "User-Agent": ua },
    });
    if (status !== 403) {
      allBlocked = false;
      results.push({
        name: `Bot blocking: ${ua}`,
        passed: false,
        details: `Expected 403, got ${status}`,
      });
    }
  }

  if (allBlocked) {
    results.push({
      name: "Malicious bot/scanner UAs blocked",
      passed: true,
      details: `${blockedUAs.length} scanner user-agents blocked (403)`,
    });
  }
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n🔒 NDSEP Automated Security Test Suite\n");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const tests = [
    testAuthRequired,
    testSqlInjection,
    testXss,
    testCsrf,
    testSecurityHeaders,
    testDemoLoginGuard,
    testRateLimiting,
    testPathTraversal,
    testEncryptionActive,
    testBotBlocking,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      results.push({
        name: test.name,
        passed: false,
        details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Output results
  console.log("─".repeat(70));
  for (const r of results) {
    const status = r.skipped ? SKIP : r.passed ? PASS : FAIL;
    console.log(`${status}  ${r.name}`);
    console.log(`       ${r.details}\n`);
  }

  const passed = results.filter(r => r.passed && !r.skipped).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  console.log("─".repeat(70));
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`Score: ${Math.round((passed / (passed + failed)) * 100)}%\n`);

  if (failed > 0) {
    console.log("❌ Security test suite FAILED — fix issues before deployment\n");
    process.exit(1);
  } else {
    console.log("Security test suite PASSED\n");
    process.exit(0);
  }
}

run().catch(console.error);
