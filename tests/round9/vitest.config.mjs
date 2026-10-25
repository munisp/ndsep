// Standalone config for round-9 pure-logic tests (repo vitest.config.ts only
// includes server/**). Plain-JS config (no vitest import) so it loads even
// when vitest runs from the npx cache.
// Run: npx vitest run --config tests/round9/vitest.config.mjs
export default {
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    testTimeout: 15000,
  },
};
