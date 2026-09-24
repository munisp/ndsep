/**
 * Redaction rules engine — PURE LOGIC
 * ===================================
 * PII pattern redaction for enforcement-decision publication:
 *   - email addresses
 *   - phone numbers (Nigerian formats: +234..., 234..., 0[789]0/1... and intl)
 *   - BVN / NIN (11-digit identifiers, keyword-context aware)
 *   - bank account numbers (10-digit NUBAN, keyword-context aware)
 * Minor-protection rule: replace a listed minor's full name with initials.
 * Investigation-sensitive material: caller flags the document; the engine
 * additionally redacts case-officer direct lines and informant references.
 *
 * Every substitution is recorded in a RedactionMapEntry {token, type, original}
 * — the map is stored SEPARATELY from the redacted text (redaction_tasks) and
 * is admin-only at the router layer. Pure functions: no I/O.
 */

export type RedactionType =
  | "email"
  | "phone"
  | "bvn_nin"
  | "account_number"
  | "minor_name"
  | "investigation_sensitive";

export interface RedactionMapEntry {
  token: string;        // e.g. "[REDACTED:EMAIL#3]"
  type: RedactionType;
  original: string;     // the exact text replaced — ADMIN-ONLY
}

export interface RedactionResult {
  redacted: string;
  map: RedactionMapEntry[];
  rulesApplied: string[];
}

// ─── Patterns ───────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Nigerian mobile/landline: +234 803 123 4567, 234-803-123-4567, 08031234567,
// 0701..., 081..., 090..., 091... ; also generic +<cc> international numbers.
const NG_PREFIXED_RE = /(?:\+?234[\s-]?)?(?:0)?([789][01]\d[\s-]?\d{3}[\s-]?\d{4})/g;
const INTL_PHONE_RE = /\+(?!234\b)\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g;

// 11-digit identifiers: BVN and NIN share the 11-digit format. Require keyword
// context (bvn/nin/verification/identity) OR label generically to avoid
// redacting innocent long numbers (e.g. gazette refs are shorter).
const BVN_NIN_CONTEXT_RE =
  /\b(?:bvn|nin|bank verification number|national identification number|identity number)\s*[:#]?\s*(\d{11})\b/gi;
const BARE_11_DIGIT_RE = /\b\d{11}\b/g;

// 10-digit NUBAN account numbers: only redact with account context keywords.
const ACCOUNT_CONTEXT_RE =
  /\b(?:acct?|account)\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d{10})\b/gi;

// Keyword part is case-insensitive, but the captured name stays capitalisation-
// sensitive (a global /i flag would make [A-Z] match lowercase words and
// over-capture trailing verbs like "reported").
const INFORMANT_RE =
  /\b(?:[Ii]nformant|[Ww]histleblower|[Cc]onfidential\s+[Ss]ource)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;

function replaceAll(
  text: string,
  re: RegExp,
  type: RedactionType,
  map: RedactionMapEntry[],
  extract: (m: RegExpExecArray) => string,
): string {
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const original = extract(m);
    const start = m.index + m[0].indexOf(original);
    const token = `[REDACTED:${type.toUpperCase()}#${map.length + 1}]`;
    map.push({ token, type, original });
    out += text.slice(last, start) + token;
    last = start + original.length;
    // Guard against zero-width loops
    if (re.lastIndex === m.index) re.lastIndex = m.index + 1;
  }
  return out + text.slice(last);
}

/**
 * Apply PII redaction patterns. Nigerian phone formats are normalised:
 * the full matched span (including country code) is replaced by one token.
 */
export function redactPii(text: string): RedactionResult {
  const map: RedactionMapEntry[] = [];
  const rulesApplied = new Set<string>();
  let out = text;

  const b0 = map.length;
  out = replaceAll(out, EMAIL_RE, "email", map, (m) => m[0]);
  if (map.length > b0) rulesApplied.add("email");

  let b = map.length;
  out = replaceAll(out, NG_PREFIXED_RE, "phone", map, (m) => m[0]);
  out = replaceAll(out, INTL_PHONE_RE, "phone", map, (m) => m[0]);
  if (map.length > b) rulesApplied.add("phone_ng_intl");

  b = map.length;
  // Context-tagged 11-digit identifiers first, then bare 11-digit runs
  // (a bare 11-digit run in a regulatory document is overwhelmingly a BVN/NIN).
  out = replaceAll(out, BVN_NIN_CONTEXT_RE, "bvn_nin", map, (m) => m[1]);
  out = replaceAll(out, BARE_11_DIGIT_RE, "bvn_nin", map, (m) => m[0]);
  if (map.length > b) rulesApplied.add("bvn_nin");

  b = map.length;
  out = replaceAll(out, ACCOUNT_CONTEXT_RE, "account_number", map, (m) => m[1]);
  if (map.length > b) rulesApplied.add("account_number");

  return { redacted: out, map, rulesApplied: Array.from(rulesApplied) };
}

/** Convert a full name to initials, e.g. "Adaeze Okafor" -> "A.O." */
export function toInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fullName;
  return parts.map((p) => `${p[0].toUpperCase()}.`).join("");
}

/**
 * Minor-protection rule: replace each listed minor's full name (word-boundary,
 * case-insensitive) with initials. Returns only the substitutions actually made.
 */
export function redactMinorNames(
  text: string,
  minorNames: string[],
): { redacted: string; applied: Array<{ name: string; initials: string }> } {
  let out = text;
  const applied: Array<{ name: string; initials: string }> = [];
  for (const raw of minorNames) {
    const name = raw.trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    if (!re.test(out)) continue;
    const initials = toInitials(name);
    out = out.replace(re, initials);
    applied.push({ name, initials });
  }
  return { redacted: out, applied };
}

export interface ApplyRedactionOptions {
  /** Full names of minors to be replaced by initials. */
  minorNames?: string[];
  /** TRUE when the document contains investigation-sensitive material. */
  investigationSensitive?: boolean;
}

export interface ApplyRedactionResult extends RedactionResult {
  minorNamesApplied: Array<{ name: string; initials: string }>;
  investigationSensitiveApplied: boolean;
}

/** Full pipeline: PII patterns + minor protection + investigation-sensitive flags. */
export function applyRedactionRules(text: string, opts: ApplyRedactionOptions = {}): ApplyRedactionResult {
  const base = redactPii(text);
  let out = base.redacted;
  const map = [...base.map];
  const rulesApplied = new Set(base.rulesApplied);

  const minors = redactMinorNames(out, opts.minorNames ?? []);
  if (minors.applied.length > 0) {
    // Re-run PII pass over the minor-substituted text would re-tokenise nothing
    // (initials are not PII patterns); record each name in the map instead.
    for (const a of minors.applied) {
      map.push({
        token: a.initials,
        type: "minor_name",
        original: a.name,
      });
    }
    rulesApplied.add("minor_protection");
    out = minors.redacted;
  }

  let investigationSensitiveApplied = false;
  if (opts.investigationSensitive) {
    const before = map.length;
    out = replaceAll(out, INFORMANT_RE, "investigation_sensitive", map, (m) => m[1]);
    investigationSensitiveApplied = map.length > before;
    rulesApplied.add("investigation_sensitive");
  }

  return {
    redacted: out,
    map,
    rulesApplied: Array.from(rulesApplied),
    minorNamesApplied: minors.applied,
    investigationSensitiveApplied,
  };
}
