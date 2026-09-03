#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REQUIRED_VALUES = [
  "SMTP_HOST",
  "SMTP_FROM",
  "SLACK_WEBHOOK_URL",
  "PAGERDUTY_INTEGRATION_KEY",
  "NITDA_COMPLIANCE_EMAIL",
  "PLATFORM_URL",
];

function usage() {
  console.error("usage: render-alertmanager-config.mjs <template.yml> <output.yml> <production.env>");
  process.exit(64);
}

function parseEnvironment(filePath) {
  const values = Object.create(null);
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) throw new Error(`${filePath}:${index + 1}: expected KEY=value`);
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      values[key] = value.slice(1, -1);
    } else {
      values[key] = value;
    }
  }
  return values;
}

function requireValue(values, key) {
  const value = values[key];
  if (!value || /(?:CHANGE_ME|PLACEHOLDER|example\.ng|example\.com)/i.test(value)) {
    throw new Error(`${key} must be supplied with an approved non-placeholder production value`);
  }
  return value;
}

function validate(values) {
  const checked = Object.fromEntries(REQUIRED_VALUES.map((key) => [key, requireValue(values, key)]));
  if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(checked.SLACK_WEBHOOK_URL)) {
    throw new Error("SLACK_WEBHOOK_URL must be an HTTPS Slack incoming-webhook URL");
  }
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(checked.PLATFORM_URL)) {
    throw new Error("PLATFORM_URL must be an absolute HTTPS URL");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checked.SMTP_FROM)) {
    throw new Error("SMTP_FROM must be an email address");
  }
  if (!/^[^\s:]+:\d{1,5}$/.test(checked.SMTP_HOST)) {
    throw new Error("SMTP_HOST must be host:port without whitespace");
  }
  if (checked.PAGERDUTY_INTEGRATION_KEY.length < 16) {
    throw new Error("PAGERDUTY_INTEGRATION_KEY must have at least 16 characters");
  }
  return checked;
}

function escapeYamlDoubleQuoted(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function main() {
  if (process.argv.length !== 5) usage();
  const [, , templatePath, outputPath, environmentPath] = process.argv;
  const template = readFileSync(templatePath, "utf8");
  const values = validate(parseEnvironment(environmentPath));
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    const token = `__NDSEP_${key}__`;
    if (!rendered.includes(token)) throw new Error(`template does not contain required token ${token}`);
    rendered = rendered.replaceAll(token, escapeYamlDoubleQuoted(value));
  }
  if (/__NDSEP_[A-Z0-9_]+__|\$\{[^}]+:-[^}]*\}|PLACEHOLDER/.test(rendered)) {
    throw new Error("rendered Alertmanager configuration contains unresolved or unsafe placeholders");
  }

  const output = resolve(outputPath);
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, rendered, { encoding: "utf8", mode: 0o600 });
  chmodSync(output, 0o600);
  console.log(`rendered Alertmanager configuration at ${output}`);
}

try {
  main();
} catch (error) {
  console.error(`Alertmanager configuration rendering failed: ${error.message}`);
  process.exit(1);
}
