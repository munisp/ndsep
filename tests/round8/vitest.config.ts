/**
 * Round-8-local vitest config.
 *
 * The repo-level vitest.config.ts only includes `server/**` test files.
 * tests/round8/ tests are run with:
 *
 *   npx vitest run --config tests/round8/vitest.config.ts
 *
 * This file exists so round-8 tests can be executed without editing the
 * shared vitest.config.ts (round-8 rule: new files only). It deliberately
 * exports a plain object instead of `defineConfig` from 'vitest/config' so
 * the config loads even when vitest is invoked from a node_modules tree
 * outside the repo root.
 */
import path from "path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export default {
  root: repoRoot,
  test: {
    environment: "node",
    include: ["tests/round8/**/*.test.ts"],
    testTimeout: 15000,
  },
};
