import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverEntry = fs.readFileSync(path.resolve(import.meta.dirname, "_core/index.ts"), "utf8");

describe("destructive demo route wiring", () => {
  it("requires the production demo guard and administrator authorization before demo data can be reset", () => {
    expect(serverEntry).toMatch(
      /app\.get\(\s*["']\/api\/demo-reset["']\s*,\s*demoLoginGuard\s*,\s*requireAdmin\s*,/s,
    );
  });

  it("requires administrator authorization before returning worker operational inventory", () => {
    expect(serverEntry).toMatch(
      /app\.get\(\s*["']\/api\/workers\/status["']\s*,\s*requireAdmin\s*,/s,
    );
  });
});
