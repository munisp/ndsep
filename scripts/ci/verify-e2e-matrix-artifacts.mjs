#!/usr/bin/env node
/**
 * Validates downloaded artifacts from the NDSEP extended Chromium E2E matrix.
 *
 * This verifier is an evidence validator. It does not execute browser tests,
 * create GitHub artifacts, or authorize a release. Every required shard must
 * provide an independently produced manifest and Playwright JSON result tied
 * to the exact candidate commit.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EXPECTED_SHARDS = Object.freeze([
  { id: "auth", project: "chromium", expectedTests: 12 },
  { id: "critical-flows", project: "chromium", expectedTests: 34 },
  { id: "dpco-onboarding", project: "chromium", expectedTests: 20 },
  { id: "enforcement-loop", project: "chromium", expectedTests: 24 },
  { id: "penalty-enforcement", project: "chromium", expectedTests: 18 },
  { id: "temporal-kafka", project: "chromium", expectedTests: 16 },
  { id: "critical-workflows", project: "chromium", expectedTests: 11 },
  { id: "visual-regression", project: "chromium", expectedTests: 3 },
]);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseJson(filePath, label) {
  return readFile(filePath, "utf8")
    .then(content => JSON.parse(content))
    .catch(error => {
      throw new Error(`${label} at ${filePath} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function integerField(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function validateResultStats(result, shard) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${shard.id}: Playwright result must be an object`);
  }
  const stats = result.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    throw new Error(`${shard.id}: Playwright result has no stats object`);
  }

  const expected = integerField(stats.expected, `${shard.id}: stats.expected`);
  const unexpected = integerField(stats.unexpected, `${shard.id}: stats.unexpected`);
  const flaky = integerField(stats.flaky, `${shard.id}: stats.flaky`);
  const skipped = integerField(stats.skipped, `${shard.id}: stats.skipped`);

  if (expected !== shard.expectedTests) {
    throw new Error(`${shard.id}: expected ${shard.expectedTests} executable tests but result reports ${expected}`);
  }
  if (unexpected !== 0) throw new Error(`${shard.id}: result contains ${unexpected} unexpected test failure(s)`);
  if (flaky !== 0) throw new Error(`${shard.id}: result contains ${flaky} flaky/retried test(s)`);
  if (skipped !== 0) throw new Error(`${shard.id}: result contains ${skipped} skipped test(s)`);

  return { expected, unexpected, flaky, skipped, duration: stats.duration ?? null };
}

function validateManifest(manifest, shard, commit) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${shard.id}: shard manifest must be an object`);
  }
  const expectedShardName = `${shard.id}-${shard.project}`;
  if (manifest.candidateCommit !== commit) {
    throw new Error(`${shard.id}: manifest candidateCommit does not match ${commit}`);
  }
  if (manifest.shard !== expectedShardName) {
    throw new Error(`${shard.id}: manifest shard must equal ${expectedShardName}`);
  }
  if (manifest.project !== shard.project) {
    throw new Error(`${shard.id}: manifest project must equal ${shard.project}`);
  }
  if (typeof manifest.testRunId !== "string" || manifest.testRunId.trim().length < 1) {
    throw new Error(`${shard.id}: manifest testRunId is required`);
  }
}

async function main() {
  const artifactRoot = path.resolve(requiredEnvironment("E2E_ARTIFACT_ROOT"));
  const commit = requiredEnvironment("E2E_CANDIDATE_COMMIT");
  if (!/^[a-f0-9]{40}$/i.test(commit)) {
    throw new Error("E2E_CANDIDATE_COMMIT must be a full 40-character Git commit SHA");
  }
  if (!existsSync(artifactRoot)) throw new Error(`E2E_ARTIFACT_ROOT does not exist: ${artifactRoot}`);

  const summaries = [];
  for (const shard of EXPECTED_SHARDS) {
    const artifactName = `e2e-${commit}-${shard.id}-${shard.project}`;
    const artifactPath = path.join(artifactRoot, artifactName);
    const manifestPath = path.join(artifactPath, "e2e-shard-manifest.json");
    const resultsPath = path.join(artifactPath, "test-results.json");
    if (!existsSync(artifactPath)) throw new Error(`missing required shard artifact directory: ${artifactName}`);
    if (!existsSync(manifestPath)) throw new Error(`${shard.id}: missing e2e-shard-manifest.json`);
    if (!existsSync(resultsPath)) throw new Error(`${shard.id}: missing test-results.json`);

    const [manifest, result] = await Promise.all([
      parseJson(manifestPath, `${shard.id} shard manifest`),
      parseJson(resultsPath, `${shard.id} Playwright result`),
    ]);
    validateManifest(manifest, shard, commit);
    summaries.push({
      artifactName,
      shard: `${shard.id}-${shard.project}`,
      ...validateResultStats(result, shard),
    });
  }

  const totalExpected = summaries.reduce((sum, summary) => sum + summary.expected, 0);
  const output = {
    schemaVersion: 1,
    candidateCommit: commit,
    generatedAt: new Date().toISOString(),
    status: "complete_without_retries",
    totalExpectedTests: totalExpected,
    shardCount: summaries.length,
    shards: summaries,
  };
  const outputPath = path.resolve(process.env.E2E_MATRIX_SUMMARY_PATH || path.join(artifactRoot, "e2e-matrix-evidence.json"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch(error => {
  process.stderr.write(`E2E matrix evidence verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
