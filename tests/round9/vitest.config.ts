/**
 * Round-9-local vitest config (mirrors tests/round8/vitest.config.ts).
 *
 * Run with: npx vitest run --config tests/round9/vitest.config.ts
 */
import path from "path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export default {
  root: repoRoot,
  test: {
    environment: "node",
    include: ["tests/round9/**/*.test.ts"],
    testTimeout: 15000,
  },
};
