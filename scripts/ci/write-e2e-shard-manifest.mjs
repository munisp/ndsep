#!/usr/bin/env node
/**
 * Emits a minimal, non-secret manifest for one independently executed E2E shard.
 * The caller supplies immutable candidate and job identity from CI. This script
 * does not execute tests or grant release approval.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const candidateCommit = required("E2E_CANDIDATE_COMMIT");
  const shard = required("E2E_SHARD");
  const project = required("E2E_PROJECT");
  const testRunId = required("E2E_TEST_RUN_ID");
  const outputDirectory = path.resolve(required("E2E_ARTIFACT_DIRECTORY"));

  if (!/^[a-f0-9]{40}$/i.test(candidateCommit)) {
    throw new Error("E2E_CANDIDATE_COMMIT must be a full 40-character Git commit SHA");
  }
  if (!/^[a-z0-9-]+$/i.test(shard)) throw new Error("E2E_SHARD contains unsupported characters");
  if (!/^[a-z0-9-]+$/i.test(project)) throw new Error("E2E_PROJECT contains unsupported characters");
  if (!/^[a-z0-9._-]+$/i.test(testRunId)) throw new Error("E2E_TEST_RUN_ID contains unsupported characters");

  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "e2e-shard-manifest.json");
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const manifest = {
    schemaVersion: 1,
    candidateCommit,
    shard,
    project,
    testRunId,
    createdAt: new Date().toISOString(),
  };
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

main().catch(error => {
  process.stderr.write(`E2E shard manifest generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
