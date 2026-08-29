#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const input = option("--input");
const markdownOutput = option("--output-markdown");
const jsonOutput = option("--output-json");

if (!input || !markdownOutput || !jsonOutput) {
  throw new Error("Usage: summarize-trivy-sarif.mjs --input <sarif> --output-markdown <file> --output-json <file>");
}

const sarif = JSON.parse(fs.readFileSync(input, "utf8"));
const escapeCell = (value) => String(value ?? "not recorded in SARIF").replaceAll("|", "\\|").replaceAll("\n", " ").trim();
const propertiesFor = (result, rule) => ({ ...(rule?.properties ?? {}), ...(result?.properties ?? {}) });
const value = (properties, ...names) => {
  for (const name of names) {
    if (properties[name] !== undefined && properties[name] !== null && properties[name] !== "") return properties[name];
  }
  return "not recorded in SARIF";
};
const messageField = (message, label) => {
  const match = String(message ?? "").match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || "not recorded in SARIF";
};
const preferValue = (properties, names, fallback) => {
  const candidate = value(properties, ...names);
  return candidate === "not recorded in SARIF" ? fallback : candidate;
};
const layerFor = (target) => {
  const lower = String(target).toLowerCase();
  if (lower.includes("go.mod") || lower.includes("go.sum") || lower.includes("/go/")) return "Go";
  if (lower.includes("cargo.lock") || lower.includes("cargo.toml") || lower.includes("/rust/")) return "Rust";
  if (lower.includes("requirements") || lower.includes("poetry.lock") || lower.includes("pipfile") || lower.includes("pyproject") || lower.includes("/python/")) return "Python";
  if (lower.includes("package.json") || lower.includes("pnpm-lock") || lower.includes("yarn.lock") || lower.includes("package-lock") || lower.includes("node_modules")) return "Application / Node";
  return "Other / unclassified";
};

const rows = [];
for (const run of sarif.runs ?? []) {
  const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));
  for (const result of run.results ?? []) {
    const rule = rules.get(result.ruleId);
    const properties = propertiesFor(result, rule);
    const message = result.message?.text ?? "";
    const target = value(properties, "Target", "target", "PkgPath", "pkgPath", "FilePath", "filePath");
    const locations = result.locations ?? [];
    const locationTarget = locations[0]?.physicalLocation?.artifactLocation?.uri;
    const resolvedTarget = locationTarget ?? target;
    const dependency = preferValue(properties, ["PkgName", "pkgName", "Package", "package", "Dependency", "dependency"], messageField(message, "Package"));
    const installed = preferValue(properties, ["InstalledVersion", "installedVersion", "Version", "version"], messageField(message, "Installed Version"));
    const fixed = preferValue(properties, ["FixedVersion", "fixedVersion", "FixedVersions", "fixedVersions"], messageField(message, "Fixed Version"));
    const severity = preferValue(properties, ["Severity", "severity"], messageField(message, "Severity"));
    rows.push({
      advisory_id: result.ruleId ?? "not recorded in SARIF",
      severity,
      layer: layerFor(resolvedTarget),
      dependency,
      installed_version: installed,
      fixed_version: fixed,
      target: resolvedTarget,
      title: rule?.shortDescription?.text ?? result.message?.text ?? "not recorded in SARIF",
      location: locationTarget ?? "not recorded in SARIF",
      remediation: fixed === "not recorded in SARIF" ? "Identify a compatible patched release or document a bounded compensating control; do not waive by default." : `Update or converge ${dependency} to ${fixed}, regenerate the lockfile, and re-run the applicable build and scanner.`,
    });
  }
}

rows.sort((left, right) => left.layer.localeCompare(right.layer) || left.target.localeCompare(right.target) || left.dependency.localeCompare(right.dependency) || left.advisory_id.localeCompare(right.advisory_id));
const byLayer = Object.fromEntries([...new Set(rows.map((row) => row.layer))].map((layer) => [layer, rows.filter((row) => row.layer === layer)]));
const summary = Object.fromEntries(Object.entries(byLayer).map(([layer, findings]) => [layer, {
  finding_count: findings.length,
  target_count: new Set(findings.map((finding) => finding.target)).size,
  advisory_count: new Set(findings.map((finding) => finding.advisory_id)).size,
  dependencies: [...new Set(findings.map((finding) => finding.dependency))].sort(),
}]));

const markdown = [
  "# NDSEP Trivy High/Critical SARIF Finding Breakdown",
  "",
  `**Source:** ${path.basename(input)}. **Result count:** ${rows.length}. **Method:** Each Trivy SARIF result filtered by the security gate is shown below; repeated advisories across separate manifests/targets remain distinct findings.`,
  "",
  "## Summary by Remediation Layer",
  "",
  "| Layer | Findings | Unique advisories | Affected targets |",
  "|---|---:|---:|---:|",
  ...Object.entries(summary).map(([layer, value]) => `| ${layer} | ${value.finding_count} | ${value.advisory_count} | ${value.target_count} |`),
  "",
];
for (const [layer, findings] of Object.entries(byLayer)) {
  markdown.push(`## ${layer}`, "", "| Advisory | Severity | Dependency | Installed | Fixed version | Target | Required remediation |", "|---|---|---|---|---|---|---|");
  markdown.push(...findings.map((finding) => `| ${escapeCell(finding.advisory_id)} | ${escapeCell(finding.severity)} | ${escapeCell(finding.dependency)} | ${escapeCell(finding.installed_version)} | ${escapeCell(finding.fixed_version)} | ${escapeCell(finding.target)} | ${escapeCell(finding.remediation)} |`));
  markdown.push("");
}

fs.mkdirSync(path.dirname(markdownOutput), { recursive: true });
fs.mkdirSync(path.dirname(jsonOutput), { recursive: true });
fs.writeFileSync(markdownOutput, `${markdown.join("\n")}\n`);
fs.writeFileSync(jsonOutput, `${JSON.stringify({ source: input, finding_count: rows.length, summary, findings: rows }, null, 2)}\n`);
console.log(JSON.stringify({ finding_count: rows.length, summary }, null, 2));
