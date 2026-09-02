import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const journal = JSON.parse(readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
const schema = readFileSync(path.join(root, "drizzle/schema.ts"), "utf8");
const migration = readFileSync(path.join(root, "drizzle/0042_theme_preferences_durable_storage.sql"), "utf8");
const router = readFileSync(path.join(root, "server/routers/phase7Features.ts"), "utf8");
const rootRouter = readFileSync(path.join(root, "server/routers.ts"), "utf8");
const themeContext = readFileSync(path.join(root, "client/src/contexts/ThemeContext.tsx"), "utf8");

describe("theme preference durable storage contract", () => {
  it("registers a DDL-only theme-preferences migration and matching Drizzle model", () => {
    expect(journal.entries).toContainEqual(expect.objectContaining({
      idx: 42,
      tag: "0042_theme_preferences_durable_storage",
    }));
    expect(migration).toContain('CREATE TABLE "theme_preferences"');
    expect(migration).toContain('CONSTRAINT "theme_preferences_theme_check"');
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s+/im);
    expect(schema).toContain('export const themePreferences = pgTable("theme_preferences"');
    expect(schema).toContain('userId: varchar("user_id", { length: 64 }).primaryKey()');
  });

  it("uses parameterized durable writes and does not report a failed theme write as saved", () => {
    expect(router).toContain('VALUES ($1, $2, NOW())');
    expect(router).toContain('theme = EXCLUDED.theme');
    expect(router).not.toContain("Silently ignore if table doesn't exist yet");
    expect(router).not.toContain("VALUES ('${userId}'");
    expect(router).not.toContain("CREATE TABLE IF NOT EXISTS changelogs");
    expect(router).toContain("WHERE org_id = $1");
    expect(router).toContain("WHERE sector = $1");
    expect(router).toContain("NOW() - ($2 * INTERVAL '1 day')");
  });

  it("keeps user-scoped preferences protected without blocking an anonymous auth boundary", () => {
    expect(rootRouter).toContain("me: publicProcedure.query(opts => opts.ctx.user ?? null)");
    expect(themeContext).toContain("const authQuery = trpc.auth.me.useQuery");
    expect(themeContext).toContain("enabled: isAuthenticated");
    expect(themeContext).toContain("if (!isAuthenticated) return;");
  });
});
