/**
 * Unit tests for the external WORM anchor sink (S3-compatible Object Lock).
 * The HTTP layer is a mocked FetchLike — no network access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  S3ObjectLockAnchorSink,
  getExternalAnchorConfigFromEnv,
  isProductionEnv,
  mirrorAnchorExternal,
  type ExternalAnchorConfig,
  type FetchLike,
} from "./externalAnchor";

const CFG: ExternalAnchorConfig = {
  bucket: "ndsep-worm-anchors",
  endpoint: "https://s3.eu-west-1.amazonaws.com",
  region: "eu-west-1",
  accessKey: "AKIDEXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  forcePathStyle: false,
  keyPrefix: "antiwipe-anchors/",
  retentionDays: 2555,
};

const ANCHOR = {
  anchorDate: "2026-10-25",
  rootHash: "ab".repeat(32),
  firstSeq: 10,
  lastSeq: 42,
  entryCount: 33,
  kind: "daily" as const,
};

function mockFetch(status: number, body = ""): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  }));
}

describe("getExternalAnchorConfigFromEnv", () => {
  it("returns null when any required env var is missing", () => {
    expect(getExternalAnchorConfigFromEnv({})).toBeNull();
    expect(
      getExternalAnchorConfigFromEnv({
        S3_ANCHOR_BUCKET: "b",
        S3_ANCHOR_ENDPOINT: "https://x",
        S3_ANCHOR_ACCESS_KEY: "k",
        // secret missing
      }),
    ).toBeNull();
  });

  it("builds a config with defaults when all required vars are present", () => {
    const cfg = getExternalAnchorConfigFromEnv({
      S3_ANCHOR_BUCKET: "b",
      S3_ANCHOR_ENDPOINT: "https://minio:9000/",
      S3_ANCHOR_ACCESS_KEY: "k",
      S3_ANCHOR_SECRET_KEY: "s",
    });
    expect(cfg).not.toBeNull();
    expect(cfg?.endpoint).toBe("https://minio:9000"); // trailing slash stripped
    expect(cfg?.region).toBe("us-east-1");
    expect(cfg?.retentionDays).toBe(2555);
    expect(cfg?.keyPrefix).toBe("antiwipe-anchors/");
  });
});

describe("S3ObjectLockAnchorSink.putAnchorIfAbsent", () => {
  it("PUTs a COMPLIANCE-locked object with If-None-Match and SigV4 auth header", async () => {
    const fetchMock = mockFetch(200);
    const sink = new S3ObjectLockAnchorSink(CFG, fetchMock as unknown as FetchLike);
    const res = await sink.putAnchorIfAbsent({ ...ANCHOR, anchoredAt: "2026-10-25T22:00:00Z" });

    expect(res.alreadyExisted).toBe(false);
    expect(res.key).toBe("antiwipe-anchors/2026-10-25.json");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("https://ndsep-worm-anchors.s3.eu-west-1.amazonaws.com/antiwipe-anchors/2026-10-25.json");
    expect(init.method).toBe("PUT");
    expect(init.headers["x-amz-object-lock-mode"]).toBe("COMPLIANCE");
    expect(init.headers["x-amz-object-lock-retain-until-date"]).toMatch(/^20\d\d-/);
    expect(init.headers["if-none-match"]).toBe("*");
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/s3\/aws4_request/);
    expect(init.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses path-style URLs when forcePathStyle is set (MinIO/Ceph)", async () => {
    const fetchMock = mockFetch(200);
    const sink = new S3ObjectLockAnchorSink({ ...CFG, forcePathStyle: true }, fetchMock as unknown as FetchLike);
    await sink.putAnchorIfAbsent({ ...ANCHOR, anchoredAt: "2026-10-25T22:00:00Z" });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://s3.eu-west-1.amazonaws.com/ndsep-worm-anchors/antiwipe-anchors/2026-10-25.json");
  });

  it("treats HTTP 412 as already-anchored (idempotent, never overwrites)", async () => {
    const fetchMock = mockFetch(412, "<Error><Code>PreconditionFailed</Code></Error>");
    const sink = new S3ObjectLockAnchorSink(CFG, fetchMock as unknown as FetchLike);
    const res = await sink.putAnchorIfAbsent({ ...ANCHOR, anchoredAt: "2026-10-25T22:00:00Z" });
    expect(res.alreadyExisted).toBe(true);
  });

  it("throws on other HTTP failures", async () => {
    const fetchMock = mockFetch(403, "AccessDenied");
    const sink = new S3ObjectLockAnchorSink(CFG, fetchMock as unknown as FetchLike);
    await expect(
      sink.putAnchorIfAbsent({ ...ANCHOR, anchoredAt: "2026-10-25T22:00:00Z" }),
    ).rejects.toThrow(/HTTP 403/);
  });
});

describe("S3ObjectLockAnchorSink.readAnchor", () => {
  it("returns the parsed anchor payload", async () => {
    const body = JSON.stringify({ ...ANCHOR, anchoredAt: "2026-10-25T22:00:00Z" });
    const fetchMock = mockFetch(200, body);
    const sink = new S3ObjectLockAnchorSink(CFG, fetchMock as unknown as FetchLike);
    const got = await sink.readAnchor("2026-10-25");
    expect(got?.rootHash).toBe(ANCHOR.rootHash);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string }];
    expect(init.method).toBe("GET");
  });

  it("returns null on 404 (anchor absent)", async () => {
    const fetchMock = mockFetch(404, "<Error><Code>NoSuchKey</Code></Error>");
    const sink = new S3ObjectLockAnchorSink(CFG, fetchMock as unknown as FetchLike);
    expect(await sink.readAnchor("2026-10-25")).toBeNull();
  });
});

describe("mirrorAnchorExternal", () => {
  const envBase = { S3_ANCHOR_BUCKET: "b", S3_ANCHOR_ENDPOINT: "https://x", S3_ANCHOR_ACCESS_KEY: "k", S3_ANCHOR_SECRET_KEY: "s" };

  beforeEach(() => {
    delete process.env.ANCHOR_ALERT_WEBHOOK;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mirrors via the injected sink and reports healthy", async () => {
    const sink = new S3ObjectLockAnchorSink(CFG, mockFetch(200) as unknown as FetchLike);
    const res = await mirrorAnchorExternal(ANCHOR, { sink, env: { ...envBase, NODE_ENV: "production" } });
    expect(res.mirrored).toBe(true);
    expect(res.healthy).toBe(true);
  });

  it("FAILS CLOSED in production when no sink is configured (unhealthy + alert)", async () => {
    const webhook = mockFetch(200);
    vi.stubGlobal("fetch", webhook);
    process.env.ANCHOR_ALERT_WEBHOOK = "https://alerts.internal/hook";
    const res = await mirrorAnchorExternal(ANCHOR, { sink: null, env: { NODE_ENV: "production" } });
    expect(res.mirrored).toBe(false);
    expect(res.healthy).toBe(false);
    expect(res.reason).toMatch(/UNCONFIGURED/);
    // webhook fired
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("stays healthy (warn-only) outside production when unconfigured", async () => {
    const res = await mirrorAnchorExternal(ANCHOR, { sink: null, env: { NODE_ENV: "test" } });
    expect(res.mirrored).toBe(false);
    expect(res.healthy).toBe(true);
  });

  it("reports unhealthy and alerts when the sink write fails", async () => {
    const webhook = mockFetch(200);
    vi.stubGlobal("fetch", webhook);
    process.env.ANCHOR_ALERT_WEBHOOK = "https://alerts.internal/hook";
    const sink = new S3ObjectLockAnchorSink(CFG, mockFetch(500, "boom") as unknown as FetchLike);
    const res = await mirrorAnchorExternal(ANCHOR, { sink, env: { ...envBase, NODE_ENV: "production" } });
    expect(res.mirrored).toBe(false);
    expect(res.healthy).toBe(false);
    expect(res.reason).toMatch(/HTTP 500/);
    expect(webhook).toHaveBeenCalledTimes(1);
  });
});

describe("isProductionEnv", () => {
  it("matches only NODE_ENV=production", () => {
    expect(isProductionEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isProductionEnv({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
