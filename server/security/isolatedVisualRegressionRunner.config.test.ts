import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const script = () =>
  fs.readFileSync(
    path.join(root, "scripts/ci/run-isolated-visual-regression.sh"),
    "utf8"
  );

describe("isolated visual regression runner source contract", () => {
  it("uses a unique localhost PostgreSQL database and isolated output directory", () => {
    const source = script();
    expect(source).toContain('role="ndsep_visual_${run_nonce}"');
    expect(source).toContain('database="ndsep_visual_${run_nonce}"');
    expect(source).toContain("@127.0.0.1:5432/${database}");
    expect(source).toContain("mktemp -d /tmp/ndsep-visual-regression.XXXXXX");
    expect(source).toContain(
      "NDSEP_VISUAL_OUTPUT_DIR must be under /tmp or /home/ubuntu"
    );
    expect(source).toContain("DROP DATABASE IF EXISTS ${database}");
    expect(source).toContain("DROP ROLE IF EXISTS ${role}");
    expect(source).toContain("git status --porcelain");
    expect(source).toContain(
      'worktree add --detach "$worktree" "$source_commit"'
    );
    expect(source).toContain('worktree remove --force "$worktree"');
    expect(source).toContain('rm -rf "$worktree_parent"');
  });

  it("runs only Chromium with one worker, zero retries, and no snapshot mutation", () => {
    const source = script();
    const commandStart = source.indexOf(
      "pnpm exec playwright test e2e/visual-regression.spec.ts"
    );
    const commandEnd = source.indexOf("test_status=$?", commandStart);
    const command = source.slice(commandStart, commandEnd);
    expect(commandStart).toBeGreaterThan(-1);
    expect(commandEnd).toBeGreaterThan(commandStart);
    expect(command).toContain("--project=chromium");
    expect(command).toContain("--workers=1");
    expect(command).toContain("--retries=0");
    expect(command).not.toContain("--update-snapshots");
    expect(source).toContain("NDSEP_VISUAL_PORT=%s is already listening");
    expect(source).not.toContain("git add");
    expect(source).not.toContain("git commit");
  });

  it("requires health before browser execution and retains JSON diagnostics outside the checkout", () => {
    const source = script();
    expect(source).toContain('"$base_url/api/health"');
    expect(source).toContain(
      'PLAYWRIGHT_JSON_OUTPUT_NAME="$output_dir/test-results.json"'
    );
    expect(source).toContain('--output="$output_dir/playwright-output"');
    expect(source).toContain("playwright-exit-status.txt");
    expect(source).toContain("diagnostic_output=%s");
  });
});
