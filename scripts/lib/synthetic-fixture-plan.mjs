import { readFile } from "node:fs/promises";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalTimestamp(value, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a canonical UTC ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO timestamp`);
  }
  return parsed;
}

function sortedKeys(record) {
  return Object.keys(record).sort((left, right) => left.localeCompare(right));
}

/**
 * Validates the source-controlled plan that distinguishes synthetic fixture
 * tables from a small set of runtime-owned, no-credit exemptions. It does not
 * approve an exemption and cannot create production or compliance evidence.
 */
export function validateSyntheticFixturePlan(manifest) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1) {
    throw new Error("Synthetic fixture manifest must be an object with schemaVersion 1");
  }
  const { fixtureRequired, runtimeOwnedExemptions } = manifest;
  if (!isPlainObject(fixtureRequired) || !isPlainObject(runtimeOwnedExemptions)) {
    throw new Error("Synthetic fixture manifest requires fixtureRequired and runtimeOwnedExemptions objects");
  }

  const fixtureTables = sortedKeys(fixtureRequired);
  const exemptTables = sortedKeys(runtimeOwnedExemptions);
  if (fixtureTables.length === 0) throw new Error("Synthetic fixture manifest must require at least one table fixture");
  if (new Set([...fixtureTables, ...exemptTables]).size !== fixtureTables.length + exemptTables.length) {
    throw new Error("A table cannot be both fixture-required and runtime-exempt");
  }
  for (const table of fixtureTables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table) || typeof fixtureRequired[table] !== "string" || fixtureRequired[table].trim().length < 24) {
      throw new Error(`Invalid synthetic fixture requirement for table '${table}'`);
    }
  }
  for (const table of exemptTables) {
    const exemption = runtimeOwnedExemptions[table];
    if (!/^[a-z][a-z0-9_]*$/.test(table) || !isPlainObject(exemption)) {
      throw new Error(`Invalid runtime-owned exemption for table '${table}'`);
    }
    if (typeof exemption.ownerRole !== "string" || exemption.ownerRole.trim().length < 3) {
      throw new Error(`Runtime-owned exemption '${table}' requires an ownerRole`);
    }
    if (typeof exemption.reason !== "string" || exemption.reason.trim().length < 24) {
      throw new Error(`Runtime-owned exemption '${table}' requires a detailed reason`);
    }
    if (exemption.readinessCredit !== false) {
      throw new Error(`Runtime-owned exemption '${table}' must explicitly deny readiness credit`);
    }
    canonicalTimestamp(exemption.expiresAt, `Runtime-owned exemption '${table}' expiresAt`);
  }
  return { fixtureTables, exemptTables };
}

export async function loadSyntheticFixturePlan(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read synthetic fixture manifest: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Synthetic fixture manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  validateSyntheticFixturePlan(manifest);
  return manifest;
}

/**
 * Evaluates a live public-table coverage summary against the manifest. This is
 * a non-production development/test reporting layer: `scenarioComplete` does
 * not mean every table is populated and must never be used as readiness proof.
 */
export function evaluateSyntheticFixtureCoverage(coverageSummary, manifest, now = new Date()) {
  if (!coverageSummary || !Array.isArray(coverageSummary.emptyTables) || !coverageSummary.emptyTables.every(table => typeof table === "string")) {
    throw new Error("Synthetic fixture coverage requires a valid public-table coverage summary");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("Synthetic fixture coverage requires a valid evaluation time");

  const { fixtureTables, exemptTables } = validateSyntheticFixturePlan(manifest);
  const required = new Set(fixtureTables);
  const exemptions = manifest.runtimeOwnedExemptions;
  const exempt = new Set(exemptTables);
  const emptyTables = [...new Set(coverageSummary.emptyTables)].sort((left, right) => left.localeCompare(right));
  const missingFixtureTables = emptyTables.filter(table => required.has(table));
  const runtimeOwnedEmptyTables = emptyTables.filter(table => exempt.has(table));
  const unplannedEmptyTables = emptyTables.filter(table => !required.has(table) && !exempt.has(table));
  const expiredRuntimeExemptions = exemptTables.filter(table => canonicalTimestamp(exemptions[table].expiresAt, `Runtime-owned exemption '${table}' expiresAt`).getTime() <= now.getTime());

  return {
    allPublicTablesPopulated: emptyTables.length === 0,
    scenarioComplete: missingFixtureTables.length === 0 && unplannedEmptyTables.length === 0 && expiredRuntimeExemptions.length === 0,
    missingFixtureTables,
    runtimeOwnedEmptyTables,
    unplannedEmptyTables,
    expiredRuntimeExemptions,
    noReadinessCredit: true,
  };
}

export function requireSyntheticFixtureScenario(report) {
  if (!report?.scenarioComplete) {
    const issues = [
      ...(report?.missingFixtureTables?.map(table => `missing fixture: ${table}`) ?? []),
      ...(report?.unplannedEmptyTables?.map(table => `unplanned empty table: ${table}`) ?? []),
      ...(report?.expiredRuntimeExemptions?.map(table => `expired exemption: ${table}`) ?? []),
    ];
    throw new Error(`Synthetic fixture scenario is incomplete; ${issues.join(", ") || "unknown evaluation failure"}`);
  }
  return report;
}
