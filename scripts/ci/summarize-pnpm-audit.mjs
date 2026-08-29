#!/usr/bin/env node
import fs from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: summarize-pnpm-audit.mjs <audit.json> <output.json>");
const audit = JSON.parse(fs.readFileSync(input, "utf8"));
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const findings = Object.values(audit.advisories ?? {})
  .filter((advisory) => severityRank[advisory.severity] >= severityRank.high)
  .map((advisory) => ({
    advisory_id: advisory.github_advisory_id ?? advisory.cves?.[0] ?? "not recorded",
    severity: advisory.severity,
    dependency: advisory.module_name,
    vulnerable_versions: advisory.vulnerable_versions,
    patched_versions: advisory.patched_versions,
    recommendation: advisory.recommendation,
    paths: advisory.findings?.map((finding) => finding.paths ?? finding.path ?? finding) ?? [],
    url: advisory.url,
  }))
  .sort((left, right) => right.severity.localeCompare(left.severity) || left.dependency.localeCompare(right.dependency));
fs.writeFileSync(output, `${JSON.stringify({ metadata: audit.metadata, finding_count: findings.length, findings }, null, 2)}\n`);
console.log(JSON.stringify({finding_count: findings.length, findings}, null, 2));
