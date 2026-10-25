/**
 * External WORM Anchor Sink (S3-compatible Object Lock)
 * =====================================================
 * Round-10 antiwipe gate: the daily/hourly ledger anchors produced by
 * anchorLedger() (./ledger.ts) must ALSO land in an external, write-once
 * store so that a fully wiped local Postgres (including ledger_anchors) is
 * still detectable by recomputing the chain and comparing against objects
 * an attacker with DB superuser cannot rewrite.
 *
 * Design:
 *  - S3-compatible object store with Object Lock in COMPLIANCE mode (WORM:
 *    not even the bucket owner can overwrite/delete before the retain-until
 *    date). Works against AWS S3, MinIO, Ceph RGW, Wasabi, etc.
 *  - One object per anchor: `<prefix><anchorDate>.json` (hourly intraday
 *    snapshots use `<prefix><anchorDate>T<hour>Z.json`). Put-if-absent via
 *    `If-None-Match: *` (S3 conditional write): a pre-existing object yields
 *    HTTP 412 and is treated as ALREADY ANCHORED, never overwritten.
 *  - No AWS SDK dependency (the vendored @aws-sdk/client-s3 in this repo is
 *    a partial install): requests are signed with a self-contained SigV4
 *    implementation over node:crypto, and the HTTP layer is injectable for
 *    tests (no network in unit tests).
 *  - Alerting: any mirror failure is an error-level structured log
 *    (alertmanager scrapes anchor_mirror_failure=true) plus an optional
 *    direct POST to ANCHOR_ALERT_WEBHOOK.
 *  - FAIL-CLOSED: when NODE_ENV=production and no sink is configured, the
 *    anchor job reports UNHEALTHY (see ./scheduler.ts) — a production ledger
 *    without external corroboration is a finding, not a silent degrade.
 *
 * Env:
 *   S3_ANCHOR_BUCKET            bucket with Object Lock enabled (required)
 *   S3_ANCHOR_ENDPOINT          e.g. https://s3.eu-west-1.amazonaws.com or
 *                               https://minio.internal:9000 (required)
 *   S3_ANCHOR_ACCESS_KEY / S3_ANCHOR_SECRET_KEY  (required)
 *   S3_ANCHOR_REGION            default "us-east-1"
 *   S3_ANCHOR_FORCE_PATH_STYLE  "true" for MinIO/Ceph (default false)
 *   S3_ANCHOR_KEY_PREFIX        default "antiwipe-anchors/"
 *   S3_ANCHOR_RETENTION_DAYS    default 2555 (7 years)
 *   ANCHOR_ALERT_WEBHOOK        optional HTTPS webhook for mirror failures
 */
import { createHmac, createHash } from "node:crypto";
import { logger } from "../logger";
import { computeMerkleRoot } from "./ledger";
import { q } from "./db";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ExternalAnchorConfig {
  bucket: string;
  endpoint: string; // scheme://host[:port], no trailing slash
  region: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  keyPrefix: string;
  retentionDays: number;
}

export function getExternalAnchorConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ExternalAnchorConfig | null {
  const bucket = env.S3_ANCHOR_BUCKET?.trim();
  const endpoint = env.S3_ANCHOR_ENDPOINT?.trim().replace(/\/+$/, "");
  const accessKey = env.S3_ANCHOR_ACCESS_KEY?.trim();
  const secretKey = env.S3_ANCHOR_SECRET_KEY?.trim();
  if (!bucket || !endpoint || !accessKey || !secretKey) return null;
  return {
    bucket,
    endpoint,
    region: env.S3_ANCHOR_REGION?.trim() || "us-east-1",
    accessKey,
    secretKey,
    forcePathStyle: env.S3_ANCHOR_FORCE_PATH_STYLE === "true",
    keyPrefix: env.S3_ANCHOR_KEY_PREFIX ?? "antiwipe-anchors/",
    retentionDays: Math.max(1, Number(env.S3_ANCHOR_RETENTION_DAYS ?? "2555") || 2555),
  };
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? "").toLowerCase() === "production";
}

// ─── Anchor payload ──────────────────────────────────────────────────────────

export interface ExternalAnchorPayload {
  anchorDate: string; // YYYY-MM-DD (daily) or YYYY-MM-DDThhZ (hourly snapshot)
  rootHash: string;
  firstSeq: number | null;
  lastSeq: number | null;
  entryCount: number;
  kind: "daily" | "hourly_snapshot";
  anchoredAt: string; // ISO timestamp the payload was mirrored
}

function anchorObjectBody(anchor: ExternalAnchorPayload): string {
  // Deterministic key order so the object body itself is reproducible.
  return JSON.stringify({
    anchorDate: anchor.anchorDate,
    rootHash: anchor.rootHash,
    firstSeq: anchor.firstSeq,
    lastSeq: anchor.lastSeq,
    entryCount: anchor.entryCount,
    kind: anchor.kind,
    anchoredAt: anchor.anchoredAt,
  });
}

// ─── SigV4 signing (self-contained) ──────────────────────────────────────────

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function deriveSigningKey(secretKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

interface SignedRequest {
  method: "PUT" | "GET";
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

function signS3Request(
  cfg: ExternalAnchorConfig,
  method: "PUT" | "GET",
  key: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
  now: Date = new Date(),
): SignedRequest {
  const endpoint = new URL(cfg.endpoint);
  const host = endpoint.host;
  const pathPrefix = endpoint.pathname.replace(/\/+$/, "");
  const canonicalUri = cfg.forcePathStyle
    ? `${pathPrefix}/${cfg.bucket}/${key}`
    : `${pathPrefix}/${key}`;
  const urlHost = cfg.forcePathStyle ? host : `${cfg.bucket}.${host}`;
  const url = `${endpoint.protocol}//${urlHost}${canonicalUri}`;

  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host: urlHost,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri.split("/").map(encodeURIComponent).join("/").replace(/%2F/g, "/"),
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const signature = createHmac("sha256", deriveSigningKey(cfg.secretKey, dateStamp, cfg.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { method, url, headers, body };
}

// ─── Sink ────────────────────────────────────────────────────────────────────

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export class S3ObjectLockAnchorSink {
  constructor(
    private readonly cfg: ExternalAnchorConfig,
    private readonly fetchFn: FetchLike | null = null,
  ) {}

  anchorKey(anchorDate: string): string {
    return `${this.cfg.keyPrefix}${anchorDate}.json`;
  }

  /**
   * Put-if-absent: writes the anchor object with Object Lock COMPLIANCE
   * retention. `If-None-Match: *` makes the write conditional on absence —
   * HTTP 412 means the anchor was already mirrored (idempotent success).
   */
  async putAnchorIfAbsent(anchor: ExternalAnchorPayload): Promise<{
    key: string;
    alreadyExisted: boolean;
    retainUntil: string;
  }> {
    const key = this.anchorKey(anchor.anchorDate);
    const retainUntilDate = new Date(Date.now() + this.cfg.retentionDays * 86_400_000);
    const retainUntil = retainUntilDate.toISOString();
    const signed = signS3Request(this.cfg, "PUT", key, Buffer.from(anchorObjectBody(anchor), "utf8"), {
      "content-type": "application/json",
      "if-none-match": "*",
      "x-amz-object-lock-mode": "COMPLIANCE",
      "x-amz-object-lock-retain-until-date": retainUntil,
    });
    const res = await this.send(signed);
    if (res.status === 412) {
      return { key, alreadyExisted: true, retainUntil };
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`S3 anchor PUT ${key} failed with HTTP ${res.status}: ${detail}`);
    }
    return { key, alreadyExisted: false, retainUntil };
  }

  /** Read back an anchor object; null when absent. */
  async readAnchor(anchorDate: string): Promise<ExternalAnchorPayload | null> {
    const key = this.anchorKey(anchorDate);
    const signed = signS3Request(this.cfg, "GET", key, Buffer.alloc(0));
    const res = await this.send(signed);
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`S3 anchor GET ${key} failed with HTTP ${res.status}: ${detail}`);
    }
    const text = await res.text();
    return JSON.parse(text) as ExternalAnchorPayload;
  }

  private async send(signed: SignedRequest) {
    const fetchImpl: FetchLike | undefined =
      this.fetchFn ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!fetchImpl) throw new Error("no fetch implementation available");
    return fetchImpl(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.method === "PUT" ? signed.body : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  }
}

// ─── Mirror + alert wiring ───────────────────────────────────────────────────

export interface ExternalMirrorResult {
  mirrored: boolean;
  healthy: boolean;
  reason?: string;
  key?: string;
  alreadyExisted?: boolean;
  checkedAt: string;
}

export async function alertExternalAnchorFailure(details: Record<string, unknown>): Promise<void> {
  logger.error(
    { anchor_mirror_failure: true, ...details },
    "[ANTWIPE] external WORM anchor mirror FAILED — ledger corroboration degraded",
  );
  const webhook = process.env.ANCHOR_ALERT_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert: "antiwipe_external_anchor_mirror_failure", ...details }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[ANTWIPE] anchor alert webhook delivery failed (error log is the durable signal)",
    );
  }
}

/**
 * Mirror one anchor to the external WORM sink. Never throws: the local
 * anchor row (ledger_anchors) remains the primary record; the mirror result
 * is surfaced through the scheduler health status.
 *
 * Fail-closed: in production, an unconfigured sink is UNHEALTHY (and alerts);
 * outside production it is a warning so dev/test environments stay usable.
 */
export async function mirrorAnchorExternal(
  anchor: Omit<ExternalAnchorPayload, "anchoredAt">,
  deps: { sink?: S3ObjectLockAnchorSink | null; env?: NodeJS.ProcessEnv } = {},
): Promise<ExternalMirrorResult> {
  const env = deps.env ?? process.env;
  const checkedAt = new Date().toISOString();
  const sink =
    deps.sink !== undefined
      ? deps.sink
      : (() => {
          const cfg = getExternalAnchorConfigFromEnv(env);
          return cfg ? new S3ObjectLockAnchorSink(cfg) : null;
        })();

  if (!sink) {
    const production = isProductionEnv(env);
    const reason = "external anchor sink UNCONFIGURED (S3_ANCHOR_* env missing)";
    if (production) {
      await alertExternalAnchorFailure({ anchorDate: anchor.anchorDate, reason });
      return { mirrored: false, healthy: false, reason, checkedAt };
    }
    logger.warn(
      { anchorDate: anchor.anchorDate },
      "[ANTWIPE] external anchor sink unconfigured — skipping mirror (allowed outside production)",
    );
    return { mirrored: false, healthy: true, reason, checkedAt };
  }

  try {
    const res = await sink.putAnchorIfAbsent({ ...anchor, anchoredAt: checkedAt });
    logger.info(
      { anchorDate: anchor.anchorDate, key: res.key, alreadyExisted: res.alreadyExisted },
      "[ANTWIPE] anchor mirrored to external WORM sink",
    );
    return {
      mirrored: true,
      healthy: true,
      key: res.key,
      alreadyExisted: res.alreadyExisted,
      checkedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alertExternalAnchorFailure({ anchorDate: anchor.anchorDate, error: message });
    return { mirrored: false, healthy: false, reason: message, checkedAt };
  }
}

// ─── Verification procedure ──────────────────────────────────────────────────

export interface ExternalAnchorVerification {
  checked: number;
  mismatches: Array<{ anchorDate: string; localRoot: string; externalRoot: string }>;
  missingExternal: string[];
  recomputedMismatch: Array<{ anchorDate: string; storedRoot: string; recomputedRoot: string }>;
  verifiedAt: string;
}

/**
 * Recompute each local daily anchor from the raw audit_ledger rows and
 * compare it BOTH against the stored ledger_anchors row and the external
 * WORM object. Any divergence means the local DB or the mirror was
 * tampered with — the report is surfaced to operators (and the caller
 * should alert on non-empty mismatch/missing lists).
 */
export async function verifyChainAgainstExternalAnchors(options: {
  sink?: S3ObjectLockAnchorSink | null;
  limit?: number;
} = {}): Promise<ExternalAnchorVerification> {
  const cfg = getExternalAnchorConfigFromEnv();
  const sink = options.sink !== undefined ? options.sink : cfg ? new S3ObjectLockAnchorSink(cfg) : null;
  const limit = Math.min(options.limit ?? 90, 366);

  const anchors = await q<{
    anchor_date: string;
    root_hash: string;
    entry_count: string;
  }>(
    `SELECT anchor_date::text AS anchor_date, root_hash, entry_count::text AS entry_count
       FROM ledger_anchors ORDER BY anchor_date DESC LIMIT $1`,
    [limit],
  );

  const result: ExternalAnchorVerification = {
    checked: 0,
    mismatches: [],
    missingExternal: [],
    recomputedMismatch: [],
    verifiedAt: new Date().toISOString(),
  };

  for (const a of anchors) {
    const anchorDate = String(a.anchor_date).slice(0, 10);
    // Recompute the merkle root from the live chain rows for that date.
    const rows = await q<{ entry_hash: string }>(
      `SELECT entry_hash FROM audit_ledger
        WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
        ORDER BY seq ASC`,
      [anchorDate],
    );
    const recomputed = computeMerkleRoot(rows.map((r) => r.entry_hash));
    if (recomputed !== a.root_hash) {
      result.recomputedMismatch.push({
        anchorDate,
        storedRoot: String(a.root_hash),
        recomputedRoot: recomputed,
      });
    }
    if (sink) {
      const external = await sink.readAnchor(anchorDate);
      if (!external) {
        result.missingExternal.push(anchorDate);
      } else if (external.rootHash !== a.root_hash) {
        result.mismatches.push({
          anchorDate,
          localRoot: String(a.root_hash),
          externalRoot: external.rootHash,
        });
      }
    }
    result.checked += 1;
  }

  const unhealthy =
    result.mismatches.length > 0 ||
    result.recomputedMismatch.length > 0 ||
    (sink != null && result.missingExternal.length > 0);
  if (unhealthy) {
    await alertExternalAnchorFailure({
      verification: true,
      mismatches: result.mismatches,
      recomputedMismatch: result.recomputedMismatch,
      missingExternal: result.missingExternal,
    });
  }
  return result;
}
