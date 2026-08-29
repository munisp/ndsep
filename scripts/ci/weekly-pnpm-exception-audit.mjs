#!/usr/bin/env node
/**
 * Weekly governance audit for NDSEP pnpm vulnerability exceptions.
 *
 * It deliberately performs no network calls and never prints secrets. The script
 * validates current risk tolerances, reports exceptions nearing expiry, compares
 * the registry against recent Git history to identify additions/changes/removals,
 * and returns a non-zero exit status for expired or malformed entries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error(`Missing value for ${name}.`);
  return args[index + 1];
};

const registryPath = option('--registry', '.github/security/pnpm-audit-exceptions.json');
const lockfilePath = option('--lockfile', 'pnpm-lock.yaml');
const warningDays = Number(option('--warning-days', '14'));
const historyDays = Number(option('--history-days', '8'));
const outputMarkdown = option('--output-markdown', 'weekly-exception-governance-report.md');
const outputJson = option('--output-json', 'weekly-exception-governance-report.json');
const now = new Date();
const nowDate = now.toISOString().slice(0, 10);

if (!Number.isInteger(warningDays) || warningDays < 1) throw new Error('--warning-days must be a positive integer.');
if (!Number.isInteger(historyDays) || historyDays < 1) throw new Error('--history-days must be a positive integer.');

const safeReadJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }
};

const sha256 = (filePath) => {
  try {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (error) {
    throw new Error(`Unable to read lockfile at ${filePath}: ${error.message}`);
  }
};

const asUtcEndOfDay = (date) => new Date(`${date}T23:59:59Z`);
const asUtcStartOfDay = (date) => new Date(`${date}T00:00:00Z`);
const daysUntil = (date) => Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
const recordKey = (record) => [record.advisory, record.module, record.resolved_version, record.scope, record.lockfile_sha256].join('|');

const validateRegistry = (registry, lockfileDigest) => {
  const errors = [];
  const warnings = [];
  const records = [];
  const seen = new Set();
  if (!Array.isArray(registry.exceptions)) {
    throw new Error("Registry must contain an 'exceptions' array.");
  }

  for (const [index, exception] of registry.exceptions.entries()) {
    const ref = `Exception ${index + 1}`;
    const required = [
      'advisory', 'severity', 'module', 'resolved_version', 'direct_parent', 'scope',
      'lockfile_sha256', 'expires_on', 'approved_by', 'service_owner', 'release_approver',
      'ticket', 'remediation_pr', 'justification', 'reachability_assessment',
      'compensating_controls', 'reviewed_at',
    ];
    for (const field of required) {
      if (!String(exception[field] ?? '').trim()) errors.push(`${ref}: missing '${field}'.`);
    }
    if (!/^GHSA-[\w-]+$/i.test(String(exception.advisory ?? ''))) errors.push(`${ref}: advisory must be a GHSA identifier.`);
    const severity = String(exception.severity ?? '').toLowerCase();
    if (!['high', 'critical'].includes(severity)) errors.push(`${ref}: severity must be high or critical.`);
    const scope = String(exception.scope ?? '').toLowerCase();
    if (!['runtime', 'development', 'unknown'].includes(scope)) errors.push(`${ref}: scope must be runtime, development, or unknown.`);
    if (!/^[a-f0-9]{64}$/i.test(String(exception.lockfile_sha256 ?? ''))) errors.push(`${ref}: lockfile_sha256 must be a SHA-256 digest.`);
    if (String(exception.lockfile_sha256 ?? '').toLowerCase() !== lockfileDigest) errors.push(`${ref}: applies to a different pnpm-lock.yaml digest.`);
    if (!/^https:\/\/github\.com\/munisp\/ndsep\/pull\/\d+\/?$/i.test(String(exception.remediation_pr ?? ''))) errors.push(`${ref}: remediation_pr must be an NDSEP pull-request URL.`);

    const roles = [exception.approved_by, exception.service_owner, exception.release_approver].map((value) => String(value ?? '').trim().toLowerCase());
    if (roles.every(Boolean) && new Set(roles).size !== roles.length) errors.push(`${ref}: approver, service owner, and release approver must be distinct.`);

    const expiry = asUtcEndOfDay(String(exception.expires_on ?? ''));
    const reviewedAt = asUtcStartOfDay(String(exception.reviewed_at ?? ''));
    if (Number.isNaN(expiry.getTime()) || Number.isNaN(reviewedAt.getTime())) {
      errors.push(`${ref}: reviewed_at and expires_on must be ISO dates (YYYY-MM-DD).`);
      continue;
    }
    const maxDays = severity === 'critical' ? (scope === 'development' ? 7 : 0) : (scope === 'development' ? 30 : 14);
    if (maxDays === 0) errors.push(`${ref}: critical runtime/unknown findings cannot be excepted.`);
    if (daysUntil(expiry) > maxDays) errors.push(`${ref}: expiry exceeds the ${maxDays}-day policy maximum for ${severity}/${scope}.`);
    if (expiry < now) errors.push(`${ref}: EXPIRED on ${exception.expires_on}.`);
    if (reviewedAt > now) errors.push(`${ref}: reviewed_at cannot be in the future.`);
    const reviewAge = Math.floor((now.getTime() - reviewedAt.getTime()) / 86_400_000);
    if (reviewAge >= 7) warnings.push(`${ref}: review evidence is ${reviewAge} days old; confirm status and remediation progress this week.`);
    const remaining = daysUntil(expiry);
    if (remaining >= 0 && remaining <= warningDays) warnings.push(`${ref}: expires in ${remaining} day(s) on ${exception.expires_on}.`);

    const normalized = { ...exception, advisory: String(exception.advisory ?? '').toUpperCase(), severity, scope, days_remaining: remaining, review_age_days: reviewAge };
    const key = recordKey(normalized);
    if (seen.has(key)) errors.push(`${ref}: duplicate exception record for ${normalized.advisory}/${normalized.module}.`);
    seen.add(key);
    records.push(normalized);
  }
  return { records, errors, warnings };
};

const parseRegistryFromCommit = (commit) => {
  try {
    const content = execFileSync('git', ['show', `${commit}:${registryPath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const registry = JSON.parse(content);
    return Array.isArray(registry.exceptions) ? registry.exceptions : [];
  } catch {
    return [];
  }
};

const recentRegistryChanges = () => {
  try {
    const commits = execFileSync('git', ['log', `--since=${historyDays} days ago`, '--format=%H%x09%s', '--', registryPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, subject = ''] = line.split('\t');
        return { sha, subject };
      });

    return commits.map(({ sha, subject }) => {
      const current = parseRegistryFromCommit(sha);
      const previous = parseRegistryFromCommit(`${sha}^`);
      const currentMap = new Map(current.map((record) => [recordKey(record), record]));
      const previousMap = new Map(previous.map((record) => [recordKey(record), record]));
      const added = [...currentMap.keys()].filter((key) => !previousMap.has(key)).map((key) => currentMap.get(key));
      const removed = [...previousMap.keys()].filter((key) => !currentMap.has(key)).map((key) => previousMap.get(key));
      return { sha, subject, added, removed };
    });
  } catch (error) {
    return [{ history_error: `Git history unavailable: ${error.message}`, added: [], removed: [] }];
  }
};

const markdown = ({ records, errors, warnings, changes, lockfileDigest }) => {
  const lines = [
    '# NDSEP Weekly pnpm Exception Governance Audit',
    '',
    `- **Run date:** ${now.toISOString()}`,
    `- **Registry:** \`${registryPath}\``,
    `- **Lockfile SHA-256:** \`${lockfileDigest}\``,
    `- **Active exception records:** ${records.length}`,
    `- **Governance errors (blocking):** ${errors.length}`,
    `- **Warnings requiring review:** ${warnings.length}`,
    `- **History window:** last ${historyDays} day(s)`,
    '',
    '## Current risk tolerances',
    '',
    '| Advisory | Severity | Module | Scope | Expiry | Days remaining | Ticket | Remediation PR |',
    '|---|---|---|---|---|---:|---|---|',
  ];
  if (!records.length) lines.push('| — | — | — | — | — | — | — | — |');
  for (const record of records.sort((a, b) => a.days_remaining - b.days_remaining || a.advisory.localeCompare(b.advisory))) {
    lines.push(`| ${record.advisory} | ${record.severity.toUpperCase()} | \`${record.module}\` | ${record.scope} | ${record.expires_on} | ${record.days_remaining} | ${record.ticket} | ${record.remediation_pr} |`);
  }

  lines.push('', '## New or changed exception records', '');
  if (!changes.length) {
    lines.push('No registry commits were detected in the configured history window.');
  } else {
    for (const change of changes) {
      if (change.history_error) {
        lines.push(`- **History check unavailable:** ${change.history_error}`);
        continue;
      }
      lines.push(`### ${change.sha.slice(0, 12)} — ${change.subject || '(no commit subject)'}`, '');
      lines.push(`- Added: ${change.added.length}`);
      for (const record of change.added) lines.push(`  - ${record.advisory ?? 'unknown advisory'} / \`${record.module ?? 'unknown module'}\` / expiry ${record.expires_on ?? 'unknown'}`);
      lines.push(`- Removed or replaced: ${change.removed.length}`);
      for (const record of change.removed) lines.push(`  - ${record.advisory ?? 'unknown advisory'} / \`${record.module ?? 'unknown module'}\` / previous expiry ${record.expires_on ?? 'unknown'}`);
      lines.push('');
    }
  }

  lines.push('## Blocking governance errors', '');
  if (!errors.length) lines.push('No blocking governance errors found.');
  for (const error of errors) lines.push(`- ${error}`);
  lines.push('', '## Review warnings', '');
  if (!warnings.length) lines.push('No warning-level review items found.');
  for (const warning of warnings) lines.push(`- ${warning}`);
  lines.push('', '## Required weekly action', '', 'Security Engineering must review each warning, validate that ticketed remediation is on schedule, revoke stale/invalid records, and open or update a release-blocking issue for every governance error.', '');
  return lines.join('\n');
};

try {
  const registry = safeReadJson(registryPath, 'exception registry');
  const lockfileDigest = sha256(lockfilePath);
  const result = validateRegistry(registry, lockfileDigest);
  const changes = recentRegistryChanges();
  const report = {
    generated_at: now.toISOString(),
    registry_path: registryPath,
    lockfile_sha256: lockfileDigest,
    warning_days: warningDays,
    history_days: historyDays,
    active_exceptions: result.records,
    governance_errors: result.errors,
    review_warnings: result.warnings,
    recent_registry_changes: changes,
  };
  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, markdown({ ...result, changes, lockfileDigest }));

  if (result.errors.length) {
    console.error(`Weekly exception audit failed with ${result.errors.length} blocking governance error(s).`);
    process.exit(1);
  }
  console.log(`Weekly exception audit passed: ${result.records.length} active record(s), ${result.warnings.length} warning(s).`);
} catch (error) {
  console.error(`Weekly exception audit configuration error: ${error.message}`);
  process.exit(2);
}
