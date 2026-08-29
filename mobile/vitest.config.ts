import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const mobileRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": mobileRoot,
      "@shared": path.join(mobileRoot, "shared"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    environment: "node",
    maxWorkers: 1,
  },
});
