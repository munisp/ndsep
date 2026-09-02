import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("visual baseline reminder source contract", () => {
  it("defaults to a read-only plan and requires explicit confirmation for a send", () => {
    const script = read("scripts/ci/remind-visual-baseline-reviewers.mjs");
    expect(script).toContain('const mode = arg(args, "--mode") ?? "plan"');
    expect(script).toContain(
      'const CONFIRMATION = "SEND_VISUAL_BASELINE_REVIEW_REMINDER"'
    );
    expect(script).toContain('arg(args, "--confirm") !== CONFIRMATION');
    expect(script).toContain('mode === "plan" || recentMatching');
  });

  it("only targets exactly four already-requested independent reviewers and deduplicates messages", () => {
    const script = read("scripts/ci/remind-visual-baseline-reviewers.mjs");
    expect(script).toContain("const REQUIRED_REVIEWERS = 4");
    expect(script).toContain("reviewers.includes(pr.author?.login)");
    expect(script).toContain("refusing to notify unassigned reviewer(s)");
    expect(script).toContain("reviewRequests");
    expect(script).toContain("REMINDER_WINDOW_MS");
    expect(script).toContain("ndsep-visual-baseline-reminder");
  });

  it("cannot approve, merge, update visual snapshots, or change repository policy", () => {
    const script = read("scripts/ci/remind-visual-baseline-reviewers.mjs");
    expect(script).not.toContain('"pr", "review"');
    expect(script).not.toContain('"pr", "merge"');
    expect(script).not.toContain('"--update-snapshots"');
    expect(script).not.toContain('"workflow", "run"');
    expect(script).not.toContain('"api", "--method", "PATCH"');
    expect(script).not.toContain('"api", "--method", "PUT"');
    expect(script).not.toContain('"api", "--method", "DELETE"');
    expect(script).toMatch(/"api",\s*"--method",\s*"POST"/);
    expect(script).toContain("issues/${prNumber}/comments");
  });
});
