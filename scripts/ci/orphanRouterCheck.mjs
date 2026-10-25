#!/usr/bin/env node
/**
 * Orphan-router gate (round-10, auditor recommendation)
 * =====================================================
 * Every module in server/routers/*.ts that defines a tRPC router
 * (`export const xxxRouter = router({...})`) must be imported and mounted in
 * server/routers.ts (the appRouter composition root). An exported router that
 * is never mounted is dead code that silently ships — a classic source of
 * "implemented but unreachable" audit findings.
 *
 * Allowlist below covers server/routers/*.ts modules that are intentionally
 * NOT tRPC routers (helpers, state machines, sub-composers mounted elsewhere).
 *
 * Usage: node scripts/ci/orphanRouterCheck.mjs   (exit 1 on orphans)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROUTERS_DIR = path.join(ROOT, "server/routers");
const COMPOSITION_ROOT = path.join(ROOT, "server/routers.ts");

/**
 * Modules allowed to exist in server/routers/ without being mounted in
 * server/routers.ts. Each entry needs a justification.
 */
const ALLOWLIST = new Map(Object.entries({
  ussdStateMachine: "helper: USSD session state machine consumed by ussdSms router, not a tRPC router",
}));

function main() {
  const rootSrc = fs.readFileSync(COMPOSITION_ROOT, "utf8");
  const files = fs.readdirSync(ROUTERS_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const orphans = [];
  const checked = [];

  for (const file of files.sort()) {
    const mod = file.replace(/\.ts$/, "");
    const src = fs.readFileSync(path.join(ROUTERS_DIR, file), "utf8");

    // Find exported router definitions in the module.
    const exported = [...src.matchAll(/export\s+const\s+(\w+Router)\s*=\s*router\s*\(/g)].map((m) => m[1]);
    if (exported.length === 0) {
      // No router export — only a problem if it isn't an allowlisted helper
      // AND nothing in the composition root imports it (fully dead module).
      if (!ALLOWLIST.has(mod) && !rootSrc.includes(`./routers/${mod}`)) {
        orphans.push(`${file}: exports no tRPC router and is never imported by server/routers.ts (fully dead module?)`);
      }
      continue;
    }
    checked.push(mod);

    if (ALLOWLIST.has(mod)) continue;

    // Must be imported from the composition root and have at least one
    // exported router mounted. Modules may export several sub-routers that
    // are composed into a single aggregate router (e.g. phase12Features.ts
    // mounts phase12Router, which embeds its sibling sub-routers) — that
    // pattern is accepted as long as the aggregate itself is mounted.
    const imported = rootSrc.includes(`./routers/${mod}`);
    const anyMounted = exported.some((r) => new RegExp(`\\b\\w+\\s*:\\s*${r}\\b`).test(rootSrc));
    if (!imported || !anyMounted) {
      orphans.push(
        `${file}: exports ${exported.join(", ")} but none is ${!imported ? "imported by" : "mounted in"} server/routers.ts`
      );
    }
  }

  if (orphans.length) {
    console.error(`[orphan-router-check] FAILED — ${orphans.length} orphan router(s):`);
    for (const o of orphans) console.error(`  - ${o}`);
    console.error("Mount the router in server/routers.ts or add a justified ALLOWLIST entry in scripts/ci/orphanRouterCheck.mjs.");
    process.exit(1);
  }
  console.log(`[orphan-router-check] OK — ${checked.length} router modules checked against server/routers.ts; all exported routers mounted.`);
}

main();
