/**
 * Round-10 vitest config. The shared node_modules mount is partially
 * populated (pino entry point missing), so `pino` is aliased to a local stub —
 * server/permify.ts and server/permifySync.ts only use the logger surface.
 *
 * Run with: npx vitest run --config tests/round10/vitest.config.ts
 */
import path from "path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export default {
  root: repoRoot,
  resolve: {
    alias: {
      pino: path.resolve(import.meta.dirname, "stubs", "pino.ts"),
      "@trpc/server": path.resolve(import.meta.dirname, "stubs", "trpc-server.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/round10/**/*.test.ts"],
    testTimeout: 15000,
  },
};
