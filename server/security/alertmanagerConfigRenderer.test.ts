import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const rendererPath = resolve(
  root,
  "scripts/security/render-alertmanager-config.mjs"
);
const templatePath = resolve(root, "infra/prometheus/alertmanager.yml");
const composePath = resolve(root, "docker-compose.production.yml");
const makefilePath = resolve(root, "Makefile");
const gitignorePath = resolve(root, ".gitignore");

const approvedEnvironment = [
  "SMTP_HOST=smtp.operations.ndsep.gov.ng:587",
  "SMTP_FROM=ndsep-alerts@operations.ndsep.gov.ng",
  "SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/abcdefghijklmnopqrstuvwxyz",
  "PAGERDUTY_INTEGRATION_KEY=0123456789abcdef0123456789abcdef",
  "NITDA_COMPLIANCE_EMAIL=compliance@operations.ndsep.gov.ng",
  "PLATFORM_URL=https://ndsep.operations.ndsep.gov.ng",
].join("\n");

function render(environment: string): { content: string; mode: number } {
  const directory = mkdtempSync(
    resolve(tmpdir(), "ndsep-alertmanager-render-")
  );
  const environmentPath = resolve(directory, "production.env");
  const outputPath = resolve(directory, "alertmanager.yml");
  try {
    writeFileSync(environmentPath, `${environment}\n`, "utf8");
    execFileSync(
      process.execPath,
      [rendererPath, templatePath, outputPath, environmentPath],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return {
      content: readFileSync(outputPath, "utf8"),
      mode: statSync(outputPath).mode & 0o777,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("production Alertmanager configuration renderer", () => {
  it("renders all required approved values without fallback interpolation and protects the output file", () => {
    const rendered = render(approvedEnvironment);
    expect(rendered.content).toContain("smtp.operations.ndsep.gov.ng:587");
    expect(rendered.content).toContain(
      "https://ndsep.operations.ndsep.gov.ng/compliance"
    );
    expect(rendered.content).toContain("0123456789abcdef0123456789abcdef");
    expect(rendered.content).not.toMatch(
      /__NDSEP_[A-Z0-9_]+__|PLACEHOLDER|\$\{[^}]+:-[^}]*\}/
    );
    expect(rendered.mode).toBe(0o600);
  });

  it("rejects placeholder secrets and alert-routing values", () => {
    expect(() =>
      render(
        approvedEnvironment.replace(
          "PAGERDUTY_INTEGRATION_KEY=0123456789abcdef0123456789abcdef",
          "PAGERDUTY_INTEGRATION_KEY=CHANGE_ME"
        )
      )
    ).toThrow(/approved non-placeholder production value/);
  });

  it("requires the rendered file in production Compose and renders it before startup", () => {
    expect(readFileSync(composePath, "utf8")).toContain(
      "./.ndsep-runtime/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro"
    );
    expect(readFileSync(makefilePath, "utf8")).toContain(
      "render-alertmanager-config.mjs"
    );
    expect(readFileSync(gitignorePath, "utf8")).toContain(".ndsep-runtime/");
  });
});
