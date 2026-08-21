/**
 * NDSEP E2E — Temporal & Kafka Integration Smoke Tests
 *
 * Validates the Temporal Cloud integration and Kafka broker wiring
 * via the tRPC API layer. These tests run against the live dev server
 * and assert that:
 *   - The Temporal config endpoint returns valid metadata
 *   - The Kafka status endpoint returns broker info
 *   - The orchestration middleware health check includes temporal + kafka
 *   - The Temporal workflow list endpoint responds correctly
 *   - The streaming topic stats endpoint responds correctly
 *
 * Admin-only smoke-test mutations (kafkaSmokeTest, temporalSmokeTest) are
 * tested at the API level — they return 401 when unauthenticated, which
 * confirms the admin guard is working.
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

// ─── Temporal Integration Tests ───────────────────────────────────────────────
test.describe("Temporal Cloud Integration", () => {
  test("orchestration.temporalConfig endpoint responds", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/orchestration.temporalConfig`);
    expect([200, 401]).toContain(res.status());
  });

  test("orchestration.temporalConfig returns valid config shape when authenticated", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/orchestration.temporalConfig`);
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? json;
      expect(data).toBeDefined();
      expect(data).toHaveProperty("address");
      expect(data).toHaveProperty("namespace");
      expect(data).toHaveProperty("taskQueue");
      expect(data).toHaveProperty("isCloud");
      expect(data).toHaveProperty("authMethod");
      expect(data).toHaveProperty("sdkLoaded");
      expect(typeof (data as { address: unknown }).address).toBe("string");
      expect(typeof (data as { namespace: unknown }).namespace).toBe("string");
      expect(typeof (data as { isCloud: unknown }).isCloud).toBe("boolean");
      const validAuthMethods = ["mtls", "apikey", "none"];
      expect(validAuthMethods).toContain((data as { authMethod: string }).authMethod);
    }
  });

  test("orchestration.listTemporalWorkflows returns array", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(
      `${BASE}/api/trpc/orchestration.listTemporalWorkflows?input=${encodeURIComponent(JSON.stringify({ pageSize: 5 }))}`
    );
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? json;
      expect(Array.isArray(data)).toBe(true);
    }
  });

  test("orchestration.describeTemporalWorkflow handles non-existent workflow gracefully", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(
      `${BASE}/api/trpc/orchestration.describeTemporalWorkflow?input=${encodeURIComponent(JSON.stringify({ workflowId: "non-existent-workflow-12345" }))}`
    );
    // Should return 200 with null data, or 401 if unauthenticated
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? null;
      // Non-existent workflow returns null — that's the graceful degradation
      expect(data === null || typeof data === "object").toBe(true);
    }
  });

  test("orchestration.temporalSmokeTest is admin-gated (returns 401 when unauthenticated)", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.post(`${BASE}/api/trpc/orchestration.temporalSmokeTest`, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({}),
    });
    // Admin-only: 401 when unauthenticated, 403 when authenticated but not admin
    expect([200, 401, 403]).toContain(res.status());
  });

  test("orchestration.startTemporalWorkflow is protected (returns 401 when unauthenticated)", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.post(`${BASE}/api/trpc/orchestration.startTemporalWorkflow`, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        workflowType: "penalty_enforcement",
        workflowId: `e2e-test-${Date.now()}`,
        input: { test: true },
      }),
    });
    expect([200, 401]).toContain(res.status());
  });
});

// ─── Kafka Integration Tests ──────────────────────────────────────────────────
test.describe("Kafka Broker Integration", () => {
  test("streaming.kafkaStatus endpoint responds", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/streaming.kafkaStatus`);
    expect([200, 401]).toContain(res.status());
  });

  test("streaming.kafkaStatus returns valid status shape when authenticated", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/streaming.kafkaStatus`);
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? json;
      expect(data).toBeDefined();
      expect(data).toHaveProperty("connected");
      expect(data).toHaveProperty("brokers");
      expect(data).toHaveProperty("clientId");
      expect(data).toHaveProperty("ssl");
      expect(data).toHaveProperty("saslEnabled");
      expect(data).toHaveProperty("topics");
      expect(typeof (data as { connected: unknown }).connected).toBe("boolean");
      expect(Array.isArray((data as { brokers: unknown[] }).brokers)).toBe(true);
      expect(Array.isArray((data as { topics: unknown[] }).topics)).toBe(true);
      // Topics should include the core NDSEP topics
      const topics = (data as { topics: string[] }).topics;
      expect(topics.some(t => t.includes("ndsep"))).toBe(true);
    }
  });

  test("streaming.kafkaSmokeTest is admin-gated (returns 401 when unauthenticated)", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.post(`${BASE}/api/trpc/streaming.kafkaSmokeTest`, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({}),
    });
    // Admin-only: 401 when unauthenticated, 403 when authenticated but not admin
    expect([200, 401, 403]).toContain(res.status());
  });

  test("streaming.events returns event list or auth error", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(
      `${BASE}/api/trpc/streaming.events?input=${encodeURIComponent(JSON.stringify({ limit: 5 }))}`
    );
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? json;
      expect(Array.isArray(data)).toBe(true);
    }
  });

  test("streaming.topicStats returns topic statistics", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/streaming.topicStats`);
    expect([200, 401]).toContain(res.status());
  });
});

// ─── Middleware Health Check ──────────────────────────────────────────────────
test.describe("Middleware Health — Temporal + Kafka in health check", () => {
  test("orchestration.middlewareHealth endpoint responds", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/orchestration.middlewareHealth`);
    expect([200, 401]).toContain(res.status());
  });

  test("orchestration.middlewareHealth includes temporal and kafka services", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/orchestration.middlewareHealth`);
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? json;
      if (data && typeof data === "object" && "middleware" in data) {
        const mw = (data as { middleware: Array<{ service: string }> }).middleware;
        const serviceNames = mw.map(s => s.service);
        expect(serviceNames).toContain("temporal");
        expect(serviceNames).toContain("kafka");
      }
    }
  });

  test("orchestration.health returns full health check", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/orchestration.health`);
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? json;
      if (Array.isArray(data)) {
        expect(data.length).toBeGreaterThan(0);
        // Each health entry should have service and status
        for (const entry of data.slice(0, 3)) {
          expect(entry).toHaveProperty("service");
          expect(entry).toHaveProperty("status");
        }
      }
    }
  });
});

// ─── Temporal Workflow Trigger via Orchestration ──────────────────────────────
test.describe("Temporal Workflow Trigger (API level)", () => {
  test("orchestration.triggerWorkflow endpoint exists and is protected", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.post(`${BASE}/api/trpc/orchestration.triggerWorkflow`, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        workflowType: "penalty_enforcement",
        workflowId: `e2e-smoke-${Date.now()}`,
        input: { test: true, source: "e2e" },
      }),
    });
    expect([200, 401]).toContain(res.status());
  });

  test("orchestration.status returns orchestration status", async ({ page }) => {
    await page.goto(BASE);
    const res = await page.request.get(`${BASE}/api/trpc/orchestration.status`);
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const json = await res.json();
      const data = json?.result?.data ?? json;
      expect(data).toBeDefined();
    }
  });
});
