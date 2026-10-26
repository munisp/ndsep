/**
 * Infrastructure Posture Scanning Service (round 13, W3)
 * ======================================================
 * Runs OSIRIS RECON port/CVE/SSL checks against compliance-scanning targets
 * (registered controllers' web infrastructure) and folds the result into the
 * EXISTING compliance scanning pipeline:
 *
 *   - findings land in `scan_findings` with finding_type='infra_posture'
 *     (migration 0144 extends the CHECK), same lifecycle statuses and the
 *     same dual-control suppression workflow as crawler findings;
 *   - each posture sweep is also recorded in `infra_posture_runs`
 *     (bookkeeping: scanner availability, findings count, duration);
 *   - `postureSignalForOrg` exposes a normalized 0..1 infra-risk signal that
 *     supervisionRisk persists as an additional sweep input
 *     (source='infra_posture') WITHOUT touching the weight vector.
 *
 * FAIL-CLOSED: when OSIRIS_SCANNER_KEY is absent the OSIRIS scanner answers
 * 503 — scannerClient.scanHost returns status 'unavailable', we record the
 * bookkeeping run with scanner_available=FALSE and write NO findings. Posture
 * is never fabricated.
 */
import { createHash } from "crypto";
import { logger } from "../logger";
import { getPool } from "../db";
import { autoDecryptRows } from "../encryptionMiddleware";
import {
  scanHost,
  cveForProduct,
  kevFeed,
  scannerKeyPresent,
  type HostScanResult,
  type ProductCve,
} from "../osiris/scannerClient";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Remote-administration ports that must never be internet-exposed. */
export const ADMIN_PORTS = [22, 3389, 5900] as const;
/** Database/datastore ports that must never be internet-exposed. */
export const DB_PORTS = [1433, 1521, 3306, 5432, 6379, 9200, 27017, 9042] as const;
export const SENSITIVE_PORTS: readonly number[] = [...ADMIN_PORTS, ...DB_PORTS];
/** Expected web ports — anything else open is at least noteworthy. */
export const EXPECTED_WEB_PORTS: readonly number[] = [80, 443];

/** Saturation point for the posture risk signal (severity-weighted findings). */
export const INFRA_POSTURE_CAP = 12;

const SEVERITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 1 };
const MAX_CVE_QUERIES_PER_SCAN = 8;

export type PostureSeverity = "critical" | "high" | "medium" | "low";

// ─── Pure logic (unit-testable, DB-free) ─────────────────────────────────────

export interface PostureSeverityInput {
  /** Any matched CVE appears in the CISA KEV catalogue. */
  kevListed: boolean;
  /** Highest CVSS base score among matched CVEs (null when none matched). */
  maxCvss: number | null;
  /** Open sensitive ports (admin/DB) observed on the host. */
  exposedSensitivePorts: number[];
  /** TLS certificate present but expired. */
  certExpired: boolean;
  /** Other noteworthy exposure (unexpected open ports, CVSS 7–8.9, …). */
  otherExposure: boolean;
}

/**
 * Severity mapping (mission spec):
 *   KEV-listed CVE or CVSS ≥ 9            → critical
 *   exposed admin/DB ports or expired cert → high
 *   anything else noteworthy              → medium
 *   clean                                 → low
 */
export function mapPostureSeverity(i: PostureSeverityInput): PostureSeverity {
  if (i.kevListed || (i.maxCvss ?? 0) >= 9) return "critical";
  if (i.exposedSensitivePorts.length > 0 || i.certExpired) return "high";
  if (i.otherExposure || (i.maxCvss ?? 0) >= 7) return "medium";
  return "low";
}

/** Normalize a severity-weighted open-finding total to a 0..1 risk signal. */
export function normalizePostureSignal(weighted: number, cap: number = INFRA_POSTURE_CAP): number {
  if (!Number.isFinite(weighted) || weighted <= 0) return 0;
  return Math.min(1, weighted / cap);
}

export interface MatchedCve extends ProductCve {
  kevListed: boolean;
}

export interface PostureEvidence {
  scanner: "osiris-recon";
  scanner_key_present: boolean;
  host: string;
  scanned_at: string;
  open_ports: Array<{ port: number; protocol: string; service?: string; product?: string; version?: string }>;
  exposed_sensitive_ports: number[];
  matched_cves: Array<{
    cve_id: string;
    cvss_score?: number;
    severity?: string;
    kev_listed: boolean;
    query: string;
  }>;
  max_cvss: number | null;
  kev_listed_count: number;
  cert: {
    present: boolean;
    expired?: boolean;
    days_remaining?: number;
    issuer?: string;
    self_signed?: boolean;
  } | null;
  cert_issues: string[];
}

/** Build the evidence jsonb payload persisted on the scan_findings row. */
export function buildPostureEvidence(args: {
  host: string;
  scan: HostScanResult;
  matchedCves: MatchedCve[];
  scannerKey: boolean;
}): PostureEvidence {
  const { host, scan, matchedCves, scannerKey } = args;
  const openPorts = scan.ports
    .filter((p) => p.state === "open")
    .map((p) => ({ port: p.port, protocol: p.protocol, service: p.service, product: p.product, version: p.version }));
  const exposedSensitive = openPorts.map((p) => p.port).filter((p) => SENSITIVE_PORTS.includes(p));
  const maxCvss = matchedCves.length
    ? Math.max(...matchedCves.map((c) => c.cvssScore ?? 0))
    : null;
  const certIssues: string[] = [];
  if (scan.ssl?.present) {
    if (scan.ssl.expired) certIssues.push("certificate expired");
    else if ((scan.ssl.daysRemaining ?? 999) <= 14) certIssues.push(`certificate expires in ${scan.ssl.daysRemaining} day(s)`);
    if (scan.ssl.selfSigned) certIssues.push("self-signed certificate");
    if (scan.ssl.valid === false && !scan.ssl.expired) certIssues.push("certificate validation failed");
  }
  return {
    scanner: "osiris-recon",
    scanner_key_present: scannerKey,
    host,
    scanned_at: scan.scannedAt,
    open_ports: openPorts,
    exposed_sensitive_ports: exposedSensitive,
    matched_cves: matchedCves.map((c) => ({
      cve_id: c.cveId,
      cvss_score: c.cvssScore,
      severity: c.severity,
      kev_listed: c.kevListed,
      query: c.query,
    })),
    max_cvss: maxCvss,
    kev_listed_count: matchedCves.filter((c) => c.kevListed).length,
    cert: scan.ssl
      ? {
          present: scan.ssl.present,
          expired: scan.ssl.expired,
          days_remaining: scan.ssl.daysRemaining,
          issuer: scan.ssl.issuer,
          self_signed: scan.ssl.selfSigned,
        }
      : null,
    cert_issues: certIssues,
  };
}

/** Decide whether a completed scan produced anything worth a finding row. */
export function postureFindingTriggered(evidence: PostureEvidence): boolean {
  if (evidence.matched_cves.length > 0) return true;
  if (evidence.exposed_sensitive_ports.length > 0) return true;
  if (evidence.cert_issues.length > 0) return true;
  return evidence.open_ports.some((p) => !EXPECTED_WEB_PORTS.includes(p.port));
}

function evidenceHash(evidence: PostureEvidence): string {
  // Hash the stable identity of the finding (not timestamps) so repeat scans
  // of an unchanged posture dedupe to the same evidence_hash.
  const stable = {
    host: evidence.host,
    open_ports: evidence.open_ports.map((p) => [p.port, p.protocol]),
    cves: evidence.matched_cves.map((c) => c.cve_id).sort(),
    cert_issues: evidence.cert_issues,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// ─── DB helpers (self-contained; mirrors services/scheduledSweeps) ───────────

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const safeParams = params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date)) ? JSON.stringify(p) : p,
  );
  const result = await pool.query(query, safeParams);
  return autoDecryptRows(query, result.rows ?? []);
}

async function tryExec(query: string, params: unknown[] = []): Promise<any[] | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const result = await pool.query(query, params);
    return result.rows ?? [];
  } catch {
    return null;
  }
}

// ─── Scan orchestration ──────────────────────────────────────────────────────

export interface PostureScanTarget {
  id: number;
  base_url: string;
  controller_name?: string;
  organization_id?: number | null;
}

export interface PostureScanOutcome {
  postureRunId: number | null;
  scanRunId: number | null;
  scannerAvailable: boolean;
  scannerKeyPresent: boolean;
  severity: PostureSeverity | null;
  findingId: number | null;
  findingsCount: number;
  durationMs: number;
  error?: string;
}

/** Collect CVE matches for the products/services observed on open ports. */
export async function matchCvesForScan(scan: HostScanResult, kevIds: Set<string>): Promise<MatchedCve[]> {
  const queries: string[] = [];
  for (const p of scan.ports) {
    if (p.state !== "open") continue;
    const q = (p.product ?? p.service)?.trim();
    if (q && !queries.includes(q)) queries.push(q);
    if (queries.length >= MAX_CVE_QUERIES_PER_SCAN) break;
  }
  const found = new Map<string, MatchedCve>();
  for (const q of queries) {
    const cves = await cveForProduct(q);
    for (const c of cves) {
      if (!found.has(c.cveId)) {
        found.set(c.cveId, { ...c, kevListed: kevIds.has(c.cveId) || kevIds.has(c.cveId.toUpperCase()) });
      }
    }
  }
  return Array.from(found.values());
}

/**
 * Run one posture scan for a compliance-scanning target and persist the
 * result: infra_posture_runs bookkeeping row always; a scan_runs +
 * scan_findings('infra_posture') row only when the scanner was available AND
 * something noteworthy was observed. Never fabricates posture data.
 */
export async function scanTargetPosture(
  target: PostureScanTarget,
  opts: { createdBy?: string | null } = {},
): Promise<PostureScanOutcome> {
  const started = Date.now();
  const actor = opts.createdBy ?? null;
  const keyPresent = scannerKeyPresent();

  let host = "";
  try {
    host = new URL(target.base_url).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (!host) {
    const [run] = await exec(
      `INSERT INTO infra_posture_runs
         (target_id, host, scanner_available, scanner_key_present, findings_count, duration_ms, error, created_by)
       VALUES ($1, $2, FALSE, $3, 0, $4, 'invalid base_url', $5) RETURNING id`,
      [target.id, target.base_url.slice(0, 255), keyPresent, Date.now() - started, actor],
    );
    return {
      postureRunId: run?.id ?? null, scanRunId: null, scannerAvailable: false,
      scannerKeyPresent: keyPresent, severity: null, findingId: null,
      findingsCount: 0, durationMs: Date.now() - started, error: "invalid base_url",
    };
  }

  const scan = await scanHost(host);

  // ── Fail-closed path: scanner unavailable → bookkeeping only, no findings.
  if (scan.status !== "ok") {
    const [run] = await exec(
      `INSERT INTO infra_posture_runs
         (target_id, host, scanner_available, scanner_key_present, findings_count, duration_ms, error, result, created_by)
       VALUES ($1, $2, FALSE, $3, 0, $4, $5, $6, $7) RETURNING id`,
      [target.id, host, scan.scannerKeyPresent, Date.now() - started,
       scan.reason ?? "scanner unavailable", JSON.stringify({ status: scan.status }), actor],
    );
    logger.warn({ targetId: target.id, host, reason: scan.reason }, "[infraPosture] scanner unavailable — run recorded, no findings");
    return {
      postureRunId: run?.id ?? null, scanRunId: null, scannerAvailable: false,
      scannerKeyPresent: scan.scannerKeyPresent, severity: null, findingId: null,
      findingsCount: 0, durationMs: Date.now() - started, error: scan.reason,
    };
  }

  // ── Scanner OK: CVE match + KEV cross-reference + severity.
  const kev = await kevFeed().catch(() => [] as Awaited<ReturnType<typeof kevFeed>>);
  const kevIds = new Set(kev.map((k) => k.id));
  const matchedCves = await matchCvesForScan(scan, kevIds);
  const evidence = buildPostureEvidence({ host, scan, matchedCves, scannerKey: keyPresent });
  const triggered = postureFindingTriggered(evidence);
  const severity = mapPostureSeverity({
    kevListed: evidence.kev_listed_count > 0,
    maxCvss: evidence.max_cvss,
    exposedSensitivePorts: evidence.exposed_sensitive_ports,
    certExpired: scan.ssl?.expired === true,
    otherExposure: triggered,
  });
  const durationMs = Date.now() - started;

  // scan_runs row so findings satisfy the existing FK + dashboards/counts.
  const [scanRun] = await exec(
    `INSERT INTO scan_runs
       (target_id, trigger_type, status, scheduled_at, started_at, finished_at,
        pages_scanned, trackers_detected, findings_count, run_metadata, created_by)
     VALUES ($1, 'manual', 'completed', NOW(), NOW(), NOW(), 0, 0, $2, $3, $4)
     RETURNING id`,
    [target.id, triggered ? 1 : 0,
     JSON.stringify({ source: "infra_posture", scanner: "osiris-recon", severity }), actor],
  );
  const scanRunId = scanRun?.id ?? null;

  // Finding row — same table/statuses/suppression workflow as crawler findings.
  // Dedupe mirrors migration 0108: same target + type + evidence_hash bumps
  // last_seen/occurrence_count instead of stacking identical rows.
  let findingId: number | null = null;
  if (triggered && scanRunId != null) {
    const hash = evidenceHash(evidence);
    const [existing] = await exec(
      `UPDATE scan_findings
          SET last_seen = NOW(), occurrence_count = occurrence_count + 1,
              run_id = $3, evidence = $4, severity = $5
        WHERE target_id = $1 AND finding_type = 'infra_posture' AND evidence_hash = $2
          AND status IN ('open', 'acknowledged')
        RETURNING id`,
      [target.id, hash, scanRunId, JSON.stringify(evidence), severity],
    );
    if (existing) {
      findingId = existing.id;
    } else {
      const [finding] = await exec(
        `INSERT INTO scan_findings
           (run_id, target_id, finding_type, severity, url, tracker_name, evidence, evidence_hash, status)
         VALUES ($1, $2, 'infra_posture', $3, $4, NULL, $5, $6, 'open')
         RETURNING id`,
        [scanRunId, target.id, severity, target.base_url, JSON.stringify(evidence), hash],
      );
      findingId = finding?.id ?? null;
    }
  }

  const [postureRun] = await exec(
    `INSERT INTO infra_posture_runs
       (target_id, scan_run_id, host, scanner_available, scanner_key_present,
        findings_count, duration_ms, result, created_by)
     VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8) RETURNING id`,
    [target.id, scanRunId, host, keyPresent, triggered ? 1 : 0, durationMs,
     JSON.stringify({ severity, evidence }), actor],
  );

  return {
    postureRunId: postureRun?.id ?? null, scanRunId, scannerAvailable: true,
    scannerKeyPresent: keyPresent, severity, findingId,
    findingsCount: triggered ? 1 : 0, durationMs,
  };
}

// ─── Supervision-risk signal ─────────────────────────────────────────────────

/**
 * Severity-weighted open infra_posture findings per org, in one grouped
 * query. Returns null when the tables are absent/unreadable (defensive
 * optional-source semantics, mirroring supervisionRisk.tryExec).
 */
export async function infraPostureWeightedByOrg(orgIds: number[]): Promise<Map<number, number> | null> {
  if (orgIds.length === 0) return new Map();
  const rows = await tryExec(
    `SELECT st.organization_id AS org_id,
            COALESCE(SUM(CASE lower(sf.severity::text)
              WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END), 0)::int AS w
       FROM scan_findings sf
       JOIN scan_targets st ON st.id = sf.target_id
      WHERE st.organization_id = ANY($1::int[])
        AND sf.finding_type = 'infra_posture'
        AND lower(sf.status::text) IN ('open', 'acknowledged', 'referred')
      GROUP BY st.organization_id`,
    [orgIds],
  );
  if (rows == null) return null;
  const out = new Map<number, number>();
  for (const r of rows) out.set(Number(r.org_id), Number(r.w));
  return out;
}

/**
 * Normalized 0..1 infra-posture risk signal for one controller. Returns 0
 * when the source is unavailable (signal contributes nothing rather than
 * fabricating risk); supervisionRisk records availability separately.
 */
export async function postureSignalForOrg(orgId: number): Promise<number> {
  const weighted = await infraPostureWeightedByOrg([orgId]);
  if (weighted == null) return 0;
  return normalizePostureSignal(weighted.get(orgId) ?? 0);
}
