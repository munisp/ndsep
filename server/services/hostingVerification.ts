/**
 * Hosting Declaration Verification (Round-13 P0.2)
 * ===================================================================
 * Independently verifies self-declared hosting posture
 * (hosting_declarations, migration 0094) against live evidence gathered
 * through OSIRIS RECON (server/osiris/reconClient.ts): DNS resolution,
 * IP geolocation/ASN intel, and SSL/TLS certificate inspection.
 *
 * An IP counts as Nigerian ONLY on positive evidence:
 *   1. containment in the 422 verified AFRINIC/NG IPv4 prefixes seeded by
 *      migration 0120 (asn_geo_reference, reference_type='nigerian_cidr',
 *      status='active'; containment via the inet operator cidr >>= ip), OR
 *   2. its ASN appears in the verified NG ASN seed
 *      (reference_type='nigerian_asn', status='active'), OR
 *   3. OSIRIS IP-intel geolocates it to country 'NG'.
 *
 * FAIL-CLOSED: when recon evidence is unavailable (OSIRIS down, DNS
 * unresolvable, reference table missing) the verdict is 'unverified' —
 * NEVER 'compliant'. Local DNS fallback (reconClient) may supply A-records
 * for the intel step but is never, by itself, geo evidence.
 *
 * Aggregation (per declaration):
 *   any host outside_nigeria                      -> violation
 *   all hosts in_nigeria (at least one extracted) -> compliant
 *   otherwise (any unverified / no hosts)         -> unverified
 *
 * Persistence: hosting_verification_runs + hosting_verification_hosts
 * (migration 0142). Each run emits `ndsep.sovereignty.verification` via
 * publishWithOutbox (durable outbox, server/kafka.ts) and appends to the
 * hash-chained audit_ledger (server/antiwipe/ledger.ts). Violation runs
 * mint a decision_feedback prediction (surface 'hosting_verification') so
 * a human can confirm/reject the flag (see routers/hostingVerification.ts).
 *
 * Scheduling: runDueVerifications() re-verifies in-scope declarations
 * never verified or last checked > 30 days ago. Plain exported async
 * function — the integrator wires it into the scheduler of choice;
 * workers/temporal is NOT touched here.
 */
import net from "node:net";
import { getPool } from "../db";
import { logger } from "../logger";
import { publishWithOutbox } from "../kafka";
import { appendLedger } from "../antiwipe/ledger";
import { mintPrediction } from "../routers/decisionFeedback";
import {
  resolveDns as reconResolveDns,
  ipIntel as reconIpIntel,
  sslInspect as reconSslInspect,
  type ReconDnsResult,
  type ReconIpIntel,
  type ReconSslResult,
} from "../osiris/reconClient";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const HOST_VERDICTS = ["in_nigeria", "outside_nigeria", "unverified"] as const;
export type HostVerdict = (typeof HOST_VERDICTS)[number];

export const DECLARATION_VERDICTS = ["compliant", "violation", "unverified"] as const;
export type DeclarationVerdict = (typeof DECLARATION_VERDICTS)[number];

export const VERIFICATION_TOPIC = "ndsep.sovereignty.verification";
export const FEEDBACK_SURFACE = "hosting_verification";
export const REVERIFY_AFTER_DAYS = 30;
const MAX_HOSTS_PER_DECLARATION = 100;
const DUE_SWEEP_LIMIT = 50;

// ─── Dependency injection (tests mock recon + db through this seam) ──────────

export interface VerificationDeps {
  exec: (query: string, params?: unknown[]) => Promise<any[]>;
  resolveDns: (domain: string) => Promise<ReconDnsResult | null>;
  ipIntel: (ipOrDomain: string) => Promise<ReconIpIntel | null>;
  sslInspect: (domain: string) => Promise<ReconSslResult | null>;
  publish: (topic: string, key: string | null, value: Record<string, unknown>) => Promise<unknown>;
  ledger: (action: string, payload: unknown, actor: string | null) => Promise<unknown>;
  mintFeedback: (opts: { surface: string; suggestion: unknown; actorId: string | number }) => Promise<string>;
  now: () => Date;
}

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

async function defaultExec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const result = await pool.query(query, params);
  return result.rows ?? [];
}

function defaultDeps(): VerificationDeps {
  return {
    exec: defaultExec,
    resolveDns: reconResolveDns,
    ipIntel: reconIpIntel,
    sslInspect: reconSslInspect,
    publish: (t, k, v) => publishWithOutbox(t, k, v),
    ledger: (a, p, actor) => appendLedger(a, p, actor),
    mintFeedback: (opts) => mintPrediction({ ...opts, modelVersion: "recon-r13" }),
    now: () => new Date(),
  };
}

// ─── Pure helpers (unit-tested directly) ─────────────────────────────────────

/** Strict IPv4 dotted-quad containment check. Returns null on invalid input. */
export function ipv4InCidr(ip: string, cidr: string): boolean | null {
  const parse = (s: string): number | null => {
    const parts = s.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const v = parseInt(p, 10);
      if (v > 255) return null;
      n = n * 256 + v;
    }
    return n >>> 0;
  };
  const [base, bitsRaw] = cidr.split("/");
  const bits = parseInt(bitsRaw ?? "", 10);
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const ipN = parse(ip);
  const baseN = parse(base);
  if (ipN == null || baseN == null) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

export interface IpEvidenceInput {
  prefixMatch: boolean;
  asnMatch: boolean;
  intelCountry: string | null;
  intelAsn: number | null;
}

/**
 * Per-IP classification. FAIL-CLOSED: positive domestic evidence required
 * for in_nigeria; positive foreign geo evidence required for
 * outside_nigeria; anything else is unverified.
 */
export function classifyIp(ev: IpEvidenceInput): HostVerdict {
  if (ev.prefixMatch || ev.asnMatch || ev.intelCountry === "NG") return "in_nigeria";
  if (ev.intelCountry && ev.intelCountry !== "NG") return "outside_nigeria";
  return "unverified";
}

/** Per-host rollup of per-IP verdicts. Empty ip list => unverified. */
export function aggregateHostVerdict(ipVerdicts: HostVerdict[]): HostVerdict {
  if (!ipVerdicts.length) return "unverified";
  if (ipVerdicts.includes("outside_nigeria")) return "outside_nigeria";
  if (ipVerdicts.every((v) => v === "in_nigeria")) return "in_nigeria";
  return "unverified";
}

/** Declaration-level rollup of host verdicts. */
export function aggregateDeclarationVerdict(hostVerdicts: HostVerdict[]): DeclarationVerdict {
  if (hostVerdicts.includes("outside_nigeria")) return "violation";
  if (hostVerdicts.length > 0 && hostVerdicts.every((v) => v === "in_nigeria")) return "compliant";
  return "unverified";
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export interface DeclaredHost {
  host: string;
  kind: "domain" | "ip";
  field: string; // declaration field the token was extracted from
}

function pushHost(out: DeclaredHost[], seen: Set<string>, raw: unknown, field: string): void {
  if (typeof raw !== "string") return;
  const token = raw.trim().toLowerCase();
  if (!token || token.length > 253) return;
  const kind = net.isIP(token) ? "ip" : DOMAIN_RE.test(token) ? "domain" : null;
  if (!kind || seen.has(token)) return;
  seen.add(token);
  out.push({ host: token, kind, field });
}

/**
 * Extract declared domains/hosts/IPs from a hosting declaration row.
 * Scans the host-shaped fields of the 0094 declaration schema; only tokens
 * that are valid IPs or fully-qualified domain names are kept (org names,
 * region labels like 'lagos-1', city names, etc. are dropped).
 */
export function extractDeclaredHosts(declaration: Record<string, any>): DeclaredHost[] {
  const out: DeclaredHost[] = [];
  const seen = new Set<string>();
  const add = (v: unknown, field: string) => {
    if (out.length < MAX_HOSTS_PER_DECLARATION) pushHost(out, seen, v, field);
  };

  add(declaration.primary_dc_name, "primary_dc_name");
  for (const r of declaration.cloud_regions ?? []) add(r, "cloud_regions");
  for (const l of declaration.backup_locations ?? []) add(l?.name, "backup_locations");
  for (const l of declaration.dr_locations ?? []) add(l?.name, "dr_locations");
  for (const l of declaration.admin_access_locations ?? []) add(l?.name, "admin_access_locations");
  add(declaration.encryption_key_custody?.hsm_provider, "encryption_key_custody.hsm_provider");
  for (const s of declaration.subprocessors ?? []) add(s?.name, "subprocessors");
  return out;
}

// ─── Reference checks (verified NG prefix / ASN tables, migration 0120) ──────

/** CIDR containment via the inet >>= operator (cidr column type, see 0096). */
async function matchNgPrefix(deps: VerificationDeps, ip: string): Promise<string | null> {
  try {
    const rows = await deps.exec(
      `SELECT cidr::text AS cidr FROM asn_geo_reference
       WHERE reference_type = 'nigerian_cidr' AND status = 'active' AND is_nigerian
         AND cidr >>= $1::inet
       ORDER BY masklen(cidr) DESC LIMIT 1`,
      [ip]
    );
    return rows[0]?.cidr ?? null;
  } catch (err) {
    if (isMissingTable(err)) {
      logger.warn("[hostingVerification] asn_geo_reference missing (migrations 0096/0120 not applied) — prefix evidence unavailable");
      return null;
    }
    throw err;
  }
}

async function matchNgAsn(deps: VerificationDeps, asn: number): Promise<string | null> {
  try {
    const rows = await deps.exec(
      `SELECT provider FROM asn_geo_reference
       WHERE reference_type = 'nigerian_asn' AND status = 'active' AND asn = $1
       LIMIT 1`,
      [asn]
    );
    return rows[0]?.provider ?? (rows.length ? "listed" : null);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

// ─── Per-host verification ───────────────────────────────────────────────────

interface IpEvidence {
  ip: string;
  verdict: HostVerdict;
  matched_prefix: string | null;
  asn: number | null;
  asn_provider: string | null;
  country: string | null;
  org: string | null;
  intel_available: boolean;
}

interface HostResult {
  host: string;
  kind: "domain" | "ip";
  field: string;
  resolvedIps: string[];
  verdict: HostVerdict;
  evidence: Record<string, unknown>;
}

async function verifyIp(deps: VerificationDeps, ip: string): Promise<IpEvidence> {
  const [prefix, intel] = await Promise.all([
    matchNgPrefix(deps, ip),
    deps.ipIntel(ip).catch(() => null),
  ]);
  const asn = intel?.asn ?? null;
  const asnProvider = asn != null ? await matchNgAsn(deps, asn) : null;
  const country = intel?.country ?? null;
  const verdict = classifyIp({
    prefixMatch: prefix != null,
    asnMatch: asnProvider != null,
    intelCountry: country,
    intelAsn: asn,
  });
  return {
    ip,
    verdict,
    matched_prefix: prefix,
    asn,
    asn_provider: asnProvider,
    country,
    org: intel?.org ?? null,
    intel_available: intel != null,
  };
}

async function verifyHost(deps: VerificationDeps, host: DeclaredHost): Promise<HostResult> {
  const checkedAt = deps.now().toISOString();
  let resolvedIps: string[] = [];
  let dnsSource: string | null = null;
  const notes: string[] = [];

  if (host.kind === "ip") {
    resolvedIps = [host.host];
  } else {
    const dns = await deps.resolveDns(host.host).catch(() => null);
    dnsSource = dns?.source ?? null;
    if (!dns) {
      notes.push("dns_unavailable: neither OSIRIS DNS nor local fallback produced records");
    } else {
      resolvedIps = dns.records
        .filter((r) => (r.type === "A" || r.type === "AAAA") && net.isIP(r.value))
        .map((r) => r.value);
      if (dns.source === "local_dns_fallback") {
        notes.push("dns_source=local_dns_fallback: resolution proven, geography still requires IP-intel/prefix evidence");
      }
      if (!resolvedIps.length) notes.push("dns_no_address_records");
    }
  }

  // SSL/TLS cert sanity for domains (evidence only; geo verdict unaffected).
  let cert: Record<string, unknown> | null = null;
  if (host.kind === "domain") {
    const ssl = await deps.sslInspect(host.host).catch(() => null);
    if (ssl) {
      const issues: string[] = [];
      if (ssl.expired) issues.push("cert_expired");
      if (ssl.hostname_match === false) issues.push("cert_hostname_mismatch");
      if (ssl.days_to_expiry != null && ssl.days_to_expiry >= 0 && ssl.days_to_expiry <= 30) {
        issues.push("cert_expiring_soon");
      }
      cert = {
        subject: ssl.subject ?? null,
        issuer: ssl.issuer ?? null,
        valid_from: ssl.valid_from ?? null,
        valid_to: ssl.valid_to ?? null,
        days_to_expiry: ssl.days_to_expiry ?? null,
        expired: ssl.expired ?? null,
        hostname_match: ssl.hostname_match ?? null,
        source: ssl.source,
        issues,
      };
    } else {
      notes.push("ssl_unavailable: no certificate evidence obtained");
    }
  }

  const ipEvidence: IpEvidence[] = [];
  for (const ip of resolvedIps.slice(0, 16)) {
    ipEvidence.push(await verifyIp(deps, ip));
  }

  const verdict = aggregateHostVerdict(ipEvidence.map((e) => e.verdict));
  return {
    host: host.host,
    kind: host.kind,
    field: host.field,
    resolvedIps,
    verdict,
    evidence: {
      field: host.field,
      ips: ipEvidence,
      dns_source: dnsSource,
      cert,
      notes,
      checked_at: checkedAt,
    },
  };
}

// ─── Declaration verification ────────────────────────────────────────────────

export interface VerificationRunResult {
  runId: number | null;
  declarationId: number;
  entityRef: string;
  verdict: DeclarationVerdict;
  hostCount: number;
  inNigeriaCount: number;
  outsideNigeriaCount: number;
  unverifiedCount: number;
  hosts: HostResult[];
  predictionId: string | null;
  checkedAt: string;
}

export async function verifyDeclaration(
  declarationId: number,
  opts: {
    trigger?: "manual" | "scheduled";
    checkedBy?: string;
    deps?: Partial<VerificationDeps>;
  } = {}
): Promise<VerificationRunResult> {
  const deps: VerificationDeps = { ...defaultDeps(), ...opts.deps };
  const checkedBy = opts.checkedBy ?? "system";
  const checkedAt = deps.now().toISOString();

  const declRows = await deps.exec(`SELECT * FROM hosting_declarations WHERE id = $1`, [declarationId]);
  const declaration = declRows[0];
  if (!declaration) throw new Error(`Hosting declaration ${declarationId} not found`);

  const declaredHosts = extractDeclaredHosts(declaration);
  const hosts: HostResult[] = [];
  for (const h of declaredHosts) {
    try {
      hosts.push(await verifyHost(deps, h));
    } catch (err) {
      // Host-level failure is evidence loss, not a crash: fail-closed.
      logger.warn({ err, host: h.host }, "[hostingVerification] host check failed — marking unverified");
      hosts.push({
        host: h.host, kind: h.kind, field: h.field, resolvedIps: [], verdict: "unverified",
        evidence: { field: h.field, ips: [], dns_source: null, cert: null, notes: ["host_check_error"], checked_at: checkedAt },
      });
    }
  }

  const verdict = aggregateDeclarationVerdict(hosts.map((h) => h.verdict));
  const counts = {
    inNigeria: hosts.filter((h) => h.verdict === "in_nigeria").length,
    outsideNigeria: hosts.filter((h) => h.verdict === "outside_nigeria").length,
    unverified: hosts.filter((h) => h.verdict === "unverified").length,
  };

  // ── Persist run + hosts (migration 0142) ──
  let runId: number | null = null;
  try {
    const runRows = await deps.exec(
      `INSERT INTO hosting_verification_runs
         (declaration_id, entity_ref, verdict, trigger, host_count,
          in_nigeria_count, outside_nigeria_count, unverified_count, evidence, checked_by, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       RETURNING id`,
      [
        declarationId, String(declaration.entity_ref), verdict, opts.trigger ?? "manual",
        hosts.length, counts.inNigeria, counts.outsideNigeria, counts.unverified,
        JSON.stringify({ notes: hosts.length ? [] : ["no_verifiable_hosts_extracted"] }),
        checkedBy, checkedAt,
      ]
    );
    runId = Number(runRows[0]?.id ?? 0) || null;
    if (runId != null) {
      for (const h of hosts) {
        await deps.exec(
          `INSERT INTO hosting_verification_hosts
             (run_id, declaration_id, host, host_kind, resolved_ips, verdict, evidence, checked_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)`,
          [runId, declarationId, h.host, h.kind, JSON.stringify(h.resolvedIps), h.verdict, JSON.stringify(h.evidence), checkedAt]
        );
      }
    }
  } catch (err) {
    if (isMissingTable(err)) {
      logger.error("[hostingVerification] migration 0142 not applied — verdict NOT persisted");
    } else {
      throw err;
    }
  }

  // ── Human feedback baseline for violation flags (decision_feedback) ──
  let predictionId: string | null = null;
  if (verdict === "violation") {
    try {
      predictionId = await deps.mintFeedback({
        surface: FEEDBACK_SURFACE,
        suggestion: {
          kind: "hosting_violation_flag",
          declarationId,
          runId,
          entityRef: String(declaration.entity_ref),
          outsideHosts: hosts.filter((h) => h.verdict === "outside_nigeria").map((h) => ({
            host: h.host, resolvedIps: h.resolvedIps,
          })),
        },
        actorId: checkedBy,
      });
      if (runId != null && predictionId) {
        await deps.exec(`UPDATE hosting_verification_runs SET prediction_id = $1 WHERE id = $2`, [predictionId, runId]).catch(() => undefined);
      }
    } catch (err) {
      logger.warn({ err }, "[hostingVerification] decision_feedback mint failed — flag remains, untracked");
    }
  }

  // ── Durable event + audit ledger (never silently) ──
  const eventPayload = {
    event: "hosting.verification.completed",
    declarationId,
    runId,
    entityRef: String(declaration.entity_ref),
    verdict,
    hostCount: hosts.length,
    ...counts,
    trigger: opts.trigger ?? "manual",
    checkedBy,
    ts: checkedAt,
  };
  await deps.publish(VERIFICATION_TOPIC, String(declarationId), eventPayload).catch((e: unknown) =>
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "[hostingVerification] outbox publish failed")
  );
  await deps.ledger("sovereignty.hosting_verification", eventPayload, checkedBy).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[hostingVerification] audit_ledger append failed")
  );

  return {
    runId,
    declarationId,
    entityRef: String(declaration.entity_ref),
    verdict,
    hostCount: hosts.length,
    inNigeriaCount: counts.inNigeria,
    outsideNigeriaCount: counts.outsideNigeria,
    unverifiedCount: counts.unverified,
    hosts,
    predictionId,
    checkedAt,
  };
}

// ─── Scheduling hook (integrator wires; workers/temporal untouched) ──────────

export interface DueSweepResult {
  checked: number;
  verdicts: Record<DeclarationVerdict, number>;
  errors: Array<{ declarationId: number; error: string }>;
}

/**
 * Re-verify in-scope declarations that have never been verified or whose
 * latest run is older than REVERIFY_AFTER_DAYS (30). Plain async function —
 * call it from any scheduler/cron.
 */
export async function runDueVerifications(
  opts: { limit?: number; deps?: Partial<VerificationDeps> } = {}
): Promise<DueSweepResult> {
  const deps: VerificationDeps = { ...defaultDeps(), ...opts.deps };
  const limit = Math.min(Math.max(opts.limit ?? DUE_SWEEP_LIMIT, 1), 500);

  const due = await deps.exec(
    `SELECT d.id FROM hosting_declarations d
     LEFT JOIN LATERAL (
       SELECT r.checked_at FROM hosting_verification_runs r
       WHERE r.declaration_id = d.id ORDER BY r.checked_at DESC LIMIT 1
     ) lr ON TRUE
     WHERE d.in_scope = TRUE
       AND d.declaration_status <> 'rejected'
       AND (lr.checked_at IS NULL OR lr.checked_at < now() - make_interval(days => $1))
     ORDER BY lr.checked_at ASC NULLS FIRST
     LIMIT $2`,
    [REVERIFY_AFTER_DAYS, limit]
  );

  const result: DueSweepResult = {
    checked: 0,
    verdicts: { compliant: 0, violation: 0, unverified: 0 },
    errors: [],
  };
  for (const row of due) {
    const id = Number(row.id);
    try {
      const r = await verifyDeclaration(id, { trigger: "scheduled", checkedBy: "scheduler", deps });
      result.verdicts[r.verdict] += 1;
      result.checked += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, declarationId: id }, "[hostingVerification] scheduled verification failed");
      result.errors.push({ declarationId: id, error: msg });
    }
  }
  return result;
}
