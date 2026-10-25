#!/usr/bin/env node
/**
 * Fails CI when pnpm audit reports high or critical advisories that do not have
 * a valid, time-bounded exception. This supports the legacy advisories object
 * emitted by the audited NDSEP pnpm version and the newer vulnerabilities shape.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1]) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return args[index + 1];
};

const severityRank = { low: 1, moderate: 2, high: 3, critical: 4 };
const inputPath = valueFor('--input');
const threshold = valueFor('--threshold').toLowerCase();
const allowlistPath = valueFor('--allowlist');
const lockfilePath = valueFor('--lockfile');
const maxExceptionDays = Number(valueFor('--max-exception-days'));

if (!(threshold in severityRank)) {
  throw new Error(`Unknown threshold '${threshold}'.`);
}
if (!Number.isInteger(maxExceptionDays) || maxExceptionDays < 1) {
  throw new Error('--max-exception-days must be a positive integer.');
}

const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }
};

const advisoryIdFromUrl = (url) => {
  try {
    const basename = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
    return /^GHSA-[\w-]+$/i.test(basename) ? basename.toUpperCase() : '';
  } catch {
    return '';
  }
};

const normalizeAudit = (report) => {
  const findings = [];

  // npm audit v1 / the audited NDSEP pnpm version
  for (const [auditId, advisory] of Object.entries(report.advisories ?? {})) {
    const severity = String(advisory.severity ?? '').toLowerCase();
    if (!(severity in severityRank)) continue;
    findings.push({
      auditId,
      advisory: advisoryIdFromUrl(advisory.url ?? '') || `AUDIT-${auditId}`,
      severity,
      module: advisory.module_name ?? 'unknown',
      title: advisory.title ?? 'No advisory title supplied',
      url: advisory.url ?? '',
      vulnerableVersions: advisory.vulnerable_versions ?? 'unknown',
      patchedVersions: advisory.patched_versions ?? 'unknown',
    });
  }

  // npm audit v2+ fallback. This form does not always include a GHSA; using the
  // synthetic key makes an unrecognised/external advisory fail closed.
  for (const [module, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    const severity = String(vulnerability.severity ?? '').toLowerCase();
    if (!(severity in severityRank)) continue;
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const source = String(via.source ?? via.url ?? `${module}-${via.title ?? 'unknown'}`);
      findings.push({
        auditId: source,
        advisory: advisoryIdFromUrl(via.url ?? '') || `AUDIT-${source}`,
        severity,
        module,
        title: via.title ?? 'No advisory title supplied',
        url: via.url ?? '',
        vulnerableVersions: via.range ?? vulnerability.range ?? 'unknown',
        patchedVersions: vulnerability.fixAvailable?.version ?? 'unknown',
      });
    }
  }

  // Preserve every audit finding. A single GHSA can affect more than one resolved
  // package/version tree, and each affected instance must remain visible in CI.
  return findings;
};

const lockfileSha256 = () => {
  try {
    return createHash('sha256').update(fs.readFileSync(lockfilePath)).digest('hex');
  } catch (error) {
    throw new Error(`Unable to read lockfile at ${lockfilePath}: ${error.message}`);
  }
};

const readExceptions = () => {
  if (!fs.existsSync(allowlistPath)) return [];
  const allowlist = readJson(allowlistPath, 'exception allowlist');
  if (!Array.isArray(allowlist.exceptions)) {
    throw new Error(`${allowlistPath} must contain an 'exceptions' array.`);
  }
  const now = new Date();
  const lockfileDigest = lockfileSha256();
  return allowlist.exceptions.map((exception, index) => {
    const prefix = `Exception ${index + 1}`;
    const requiredFields = [
      'advisory', 'severity', 'module', 'resolved_version', 'direct_parent', 'scope',
      'lockfile_sha256', 'expires_on', 'approved_by', 'service_owner', 'release_approver',
      'ticket', 'remediation_pr', 'justification', 'reachability_assessment',
      'compensating_controls', 'reviewed_at',
    ];
    for (const key of requiredFields) {
      if (!String(exception[key] ?? '').trim()) {
        throw new Error(`${prefix} is missing required field '${key}'.`);
      }
    }
    if (!/^GHSA-[\w-]+$/i.test(exception.advisory)) {
      throw new Error(`${prefix} must use a GitHub Advisory ID (GHSA-xxxx-xxxx-xxxx).`);
    }
    if (!['high', 'critical'].includes(String(exception.severity).toLowerCase())) {
      throw new Error(`${prefix} must have severity 'high' or 'critical'.`);
    }
    if (!['runtime', 'development', 'unknown'].includes(String(exception.scope).toLowerCase())) {
      throw new Error(`${prefix} has an invalid scope.`);
    }
    if (!/^[a-f0-9]{64}$/i.test(exception.lockfile_sha256)) {
      throw new Error(`${prefix} must contain a SHA-256 lockfile digest.`);
    }
    if (exception.lockfile_sha256.toLowerCase() !== lockfileDigest) {
      throw new Error(`${prefix} applies to a different pnpm-lock.yaml digest.`);
    }
    if (!/^https:\/\/github\.com\/munisp\/ndsep\/pull\/\d+\/?$/i.test(exception.remediation_pr)) {
      throw new Error(`${prefix} remediation_pr must be an NDSEP pull-request URL.`);
    }
    const approvers = [exception.approved_by, exception.service_owner, exception.release_approver].map((value) => String(value).trim().toLowerCase());
    if (new Set(approvers).size !== approvers.length) {
      throw new Error(`${prefix} violates separation of duties: security approver, service owner, and release approver must be distinct.`);
    }
    const expiresAt = new Date(`${exception.expires_on}T23:59:59Z`);
    const reviewedAt = new Date(`${exception.reviewed_at}T00:00:00Z`);
    if (Number.isNaN(expiresAt.getTime()) || Number.isNaN(reviewedAt.getTime())) {
      throw new Error(`${prefix} has an invalid reviewed_at or expires_on date.`);
    }
    if (expiresAt < now) {
      throw new Error(`${prefix} is expired (${exception.expires_on}).`);
    }
    if (reviewedAt > now) {
      throw new Error(`${prefix} reviewed_at cannot be in the future.`);
    }
    const policyMaximumDays = exception.severity.toLowerCase() === 'critical'
      ? (exception.scope.toLowerCase() === 'development' ? 7 : 0)
      : (exception.scope.toLowerCase() === 'development' ? 30 : 14);
    if (policyMaximumDays === 0) {
      throw new Error(`${prefix} cannot except a critical runtime or unknown-scope finding.`);
    }
    const cutoff = new Date(now.getTime() + Math.min(maxExceptionDays, policyMaximumDays) * 24 * 60 * 60 * 1000);
    if (expiresAt > cutoff) {
      throw new Error(`${prefix} exceeds the ${Math.min(maxExceptionDays, policyMaximumDays)}-day policy limit for ${exception.severity}/${exception.scope}.`);
    }
    return {
      ...exception,
      advisory: exception.advisory.toUpperCase(),
      severity: exception.severity.toLowerCase(),
      scope: exception.scope.toLowerCase(),
      lockfile_sha256: exception.lockfile_sha256.toLowerCase(),
    };
  });
};

const toMarkdown = ({ findings, exceptions, violations }) => {
  const bySeverity = findings.reduce((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    return counts;
  }, {});
  const lines = [
    '# pnpm audit security gate',
    '',
    `- Threshold: **${threshold.toUpperCase()}**`,
    `- Findings at/above threshold: **${findings.length}**`,
    `- Critical: **${bySeverity.critical ?? 0}**`,
    `- High: **${bySeverity.high ?? 0}**`,
    `- Valid, time-bounded exceptions: **${exceptions.length}**`,
    `- Blocking violations: **${violations.length}**`,
    '',
  ];
  if (violations.length) {
    lines.push('## Blocking findings', '', '| Severity | Package | Advisory | Fixed version |', '|---|---|---|---|');
    for (const finding of violations) {
      const advisory = finding.url ? `[${finding.advisory}](${finding.url})` : finding.advisory;
      lines.push(`| ${finding.severity.toUpperCase()} | \`${finding.module}\` | ${advisory}: ${finding.title} | \`${finding.patchedVersions}\` |`);
    }
  } else {
    lines.push('## Result', '', 'No unapproved high or critical pnpm audit findings remain.');
  }
  lines.push('');
  return lines.join('\n');
};

try {
  const report = readJson(inputPath, 'pnpm audit report');
  const findings = normalizeAudit(report).filter((finding) => severityRank[finding.severity] >= severityRank[threshold]);
  const exceptions = readExceptions();
  const exceptionByAdvisory = new Map(exceptions.map((exception) => [exception.advisory, exception]));
  const violations = findings.filter((finding) => {
    const exception = exceptionByAdvisory.get(finding.advisory);
    return !exception || exception.severity !== finding.severity || exception.module !== finding.module;
  });
  fs.writeFileSync(path.resolve('security-gate-summary.md'), toMarkdown({ findings, exceptions, violations }));

  if (violations.length > 0) {
    console.error(`Security gate failed: ${violations.length} high/critical audit finding(s) lack a valid exception.`);
    for (const finding of violations) {
      console.error(`- ${finding.severity.toUpperCase()} ${finding.module}: ${finding.advisory} (${finding.patchedVersions})`);
    }
    process.exit(1);
  }
  console.log('Security gate passed: no unapproved high/critical pnpm audit findings.');
} catch (error) {
  console.error(`Security gate configuration error: ${error.message}`);
  process.exit(2);
}
