import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    exclude: [
      "server/phase15.test.ts",
      "server/phase16.test.ts",
      "server/phase17.test.ts",
      "server/phase20.test.ts",
      "server/phase43.test.ts",
      "server/phase44.test.ts",
    ],
    setupFiles: ["server/vitest.setup.ts"],
    testTimeout: 15000,
  },
});
