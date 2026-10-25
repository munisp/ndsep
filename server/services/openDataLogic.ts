/**
 * Open data portal — pure logic (no I/O).
 * k-anonymity suppression, CSV serialisation, accessor hashing and dataset
 * version/changelog helpers. Used by server/routers/openDataPortal.ts.
 */
import { createHash } from "crypto";

export const K_ANONYMITY_THRESHOLD = 5;
export const SUPPRESSED = "<5";

export interface AggregateCell {
  [dimension: string]: string | number;
  count: number;
}

/**
 * k-anonymity: any aggregate cell with 0 < count < k is suppressed (count
 * replaced by the "<5" marker). Cells with count 0 stay 0 (no individuals).
 * Returns new rows; input not mutated.
 */
export function kAnonymize<T extends AggregateCell>(rows: T[], k = K_ANONYMITY_THRESHOLD): Array<T | (Omit<T, "count"> & { count: string })> {
  return rows.map((r) => {
    const c = Number(r.count);
    if (c > 0 && c < k) {
      return { ...r, count: SUPPRESSED } as Omit<T, "count"> & { count: string };
    }
    return { ...r, count: c };
  });
}

/** CSV serialisation with RFC-4180 quoting. Deterministic column order from
 *  the first row's keys (or an explicit header list). */
export function toCsv(rows: Array<Record<string, string | number | null>>, headers?: string[]): string {
  const cols = headers ?? (rows.length ? Object.keys(rows[0]) : []);
  const esc = (v: string | number | null): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(esc).join(",")];
  for (const row of rows) lines.push(cols.map((c) => esc(row[c] ?? null)).join(","));
  return lines.join("\r\n");
}

/**
 * Hash an accessor reference (IP or user id) for the access log. Raw values
 * are never stored. Salt comes from OPEN_DATA_ACCESS_SALT; a stable default
 * keeps hashing functional in dev (documented, never raw).
 */
export function accessorHash(accessor: string | null | undefined, salt?: string): string | null {
  if (!accessor) return null;
  const s = salt ?? process.env.OPEN_DATA_ACCESS_SALT ?? "ndsep-open-data-default-salt";
  return createHash("sha256").update(`${s}:${accessor}`).digest("hex");
}

export interface ChangelogEntry {
  version: number;
  changed_at: string;
  changed_by: string;
  note: string;
}

/** Append a changelog entry and bump the version (pure). */
export function bumpDatasetVersion(
  current: { version: number; changelog: ChangelogEntry[] },
  changedBy: string,
  note: string,
  now: Date = new Date(),
): { version: number; changelog: ChangelogEntry[] } {
  const entry: ChangelogEntry = {
    version: current.version + 1,
    changed_at: now.toISOString(),
    changed_by: changedBy,
    note,
  };
  return { version: entry.version, changelog: [...(current.changelog ?? []), entry] };
}
