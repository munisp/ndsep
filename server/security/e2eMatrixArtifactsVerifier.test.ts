import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const verifier = path.join(repositoryRoot, "scripts/ci/verify-e2e-matrix-artifacts.mjs");
const commit = "f328595c389a8ebbd794730442f52287fcea7158";
const shards = [
  ["auth", 17],
  ["critical-flows", 34],
  ["dpco-onboarding", 20],
  ["enforcement-loop", 24],
  ["penalty-enforcement", 18],
  ["temporal-kafka", 16],
  ["critical-workflows", 15],
  ["visual-regression", 12],
] as const;
const temporaryRoots: string[] = [];

async function createCompleteFixture(options: { flakyShard?: string; omitShard?: string; manifestCommit?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ndsep-e2e-matrix-verifier-"));
  temporaryRoots.push(root);
  for (const [id, expected] of shards) {
    if (id === options.omitShard) continue;
    const name = `e2e-${commit}-${id}-chromium`;
    const shardDirectory = path.join(root, name);
    await mkdir(shardDirectory, { recursive: true });
    await writeFile(
      path.join(shardDirectory, "e2e-shard-manifest.json"),
      `${JSON.stringify({
        candidateCommit: options.manifestCommit ?? commit,
        shard: `${id}-chromium`,
        project: "chromium",
        testRunId: `test-run-${id}`,
      })}\n`
    );
    await writeFile(
      path.join(shardDirectory, "test-results.json"),
      `${JSON.stringify({
        stats: {
          expected,
          unexpected: 0,
          flaky: id === options.flakyShard ? 1 : 0,
          skipped: 0,
          duration: 2500,
        },
      })}\n`
    );
  }
  return root;
}

async function runVerifier(root: string) {
  return execFileAsync(process.execPath, [verifier], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      E2E_ARTIFACT_ROOT: root,
      E2E_CANDIDATE_COMMIT: commit,
      E2E_MATRIX_SUMMARY_PATH: path.join(root, "e2e-matrix-evidence.json"),
    },
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("E2E matrix artifact verifier", () => {
  it("accepts all eight complete first-attempt Chromium shard artifacts", async () => {
    const root = await createCompleteFixture();
    const { stdout } = await runVerifier(root);
    const reported = JSON.parse(stdout) as { status: string; shardCount: number; totalExpectedTests: number };
    const evidence = JSON.parse(await readFile(path.join(root, "e2e-matrix-evidence.json"), "utf8")) as typeof reported;

    expect(reported).toMatchObject({
      status: "complete_without_retries",
      shardCount: 8,
      totalExpectedTests: 156,
    });
    expect(evidence).toMatchObject(reported);
  });

  it("fails closed when a required shard artifact is absent", async () => {
    const root = await createCompleteFixture({ omitShard: "temporal-kafka" });

    await expect(runVerifier(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("missing required shard artifact directory"),
    });
  });

  it("fails closed when a result reports a retry/flaky test", async () => {
    const root = await createCompleteFixture({ flakyShard: "auth" });

    await expect(runVerifier(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("flaky/retried test"),
    });
  });

  it("fails closed when an artifact manifest is bound to another commit", async () => {
    const root = await createCompleteFixture({ manifestCommit: "a".repeat(40) });

    await expect(runVerifier(root)).rejects.toMatchObject({
      stderr: expect.stringContaining("manifest candidateCommit does not match"),
    });
  });
});
