import { defineConfig } from "vitest/config";

/**
 * This coverage scope intentionally measures executable TypeScript service and
 * domain logic. Native UI, Expo configuration, generated assets, deployment
 * manifests, and scripts are reported through build/device validation rather
 * than being silently counted as untested application logic.
 */
export default defineConfig({
  test: {
    exclude: [
      "node_modules/**",
      "e2e/**",
      "mobile/**",
      "client/**",
      "workers/**",
    ],
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts", "lib/**/*.ts"],
      exclude: [
        "server/_core/{imageGeneration,llm,notification,voiceTranscription,storageProxy}.ts",
        "lib/_core/**",
        "lib/**/nativewind-pressable.ts",
        "**/*.d.ts",
      ],
      reporter: ["text", "json-summary"],
    },
  },
});
