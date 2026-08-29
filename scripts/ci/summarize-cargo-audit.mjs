#!/usr/bin/env node
import fs from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: summarize-cargo-audit.mjs <audit.json> <output.json>");
const audit = JSON.parse(fs.readFileSync(input, "utf8"));
const vulnerabilities = (audit.vulnerabilities?.list ?? []).map((finding) => ({
  advisory_id: finding.advisory?.id,
  severity: finding.advisory?.cvss,
  package: finding.advisory?.package,
  installed_version: finding.versions?.patched?.length ? finding.versions?.unaffected?.[0] ?? "recorded in advisory path" : "recorded in advisory path",
  patched_versions: finding.versions?.patched ?? [],
  title: finding.advisory?.title,
  url: finding.advisory?.url,
  dependency_chain: finding.affected?.dependency ?? finding.affected?.package ?? "not recorded",
}));
const report = {
  source: input,
  vulnerability_count: vulnerabilities.length,
  vulnerabilities,
  warnings: audit.warnings?.list ?? [],
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
