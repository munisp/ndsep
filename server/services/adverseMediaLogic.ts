/**
 * Adverse-media / OSINT feed — pure logic (no I/O, deterministic).
 * Used by server/routers/adverseMedia.ts and mirrored by
 * workers/python/adverse_media_worker.py (keep the two in sync).
 */
import { createHash } from "crypto";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const TRIAGE_LABELS = [
  "data_breach",
  "sanction",
  "lawsuit",
  "insolvency",
  "fraud",
  "other",
] as const;
export type TriageLabel = (typeof TRIAGE_LABELS)[number];

// ─── URL normalisation + dedupe hash ─────────────────────────────────────────

/** Normalise a URL for dedupe: lowercase host, strip tracking params, trim
 *  trailing slashes. Returns "" for unusable input. */
export function normalizeUrl(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "";
  }
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  // Strip common tracking params.
  const drop = /^utm_|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i;
  for (const key of [...u.searchParams.keys()]) {
    if (drop.test(key)) u.searchParams.delete(key);
  }
  u.hash = "";
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  let s = u.toString();
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/** sha256 dedupe anchor: normalised URL when available, else title+date. */
export function urlHash(url: string | null | undefined, title = "", publishedAt = ""): string {
  const norm = url ? normalizeUrl(url) : "";
  const anchor = norm || `${title.trim().toLowerCase()}|${publishedAt}`;
  return createHash("sha256").update(anchor).digest("hex");
}

// ─── Keyword severity classifier (explicit fallback when ollama absent) ──────

const KEYWORD_RULES: Array<{ label: TriageLabel; severity: Severity; patterns: RegExp[] }> = [
  {
    label: "data_breach",
    severity: "critical",
    patterns: [
      /\bdata breach\b/i, /\bransomware\b/i, /\bleaked\b/i, /\bexfiltrat/i,
      /\bpersonal data\b.*\b(exposed|stolen|compromised)\b/i,
    ],
  },
  {
    label: "sanction",
    severity: "high",
    patterns: [/\bsanction/i, /\bregulator\b.*\bfine/i, /\bbenforcement action\b/i, /\bpenal(ty|ise|ise[ds])\b/i],
  },
  {
    label: "lawsuit",
    severity: "medium",
    patterns: [/\blawsuit\b/i, /\bsued\b/i, /\bclass action\b/i, /\bcourt\b.*\bdata protection\b/i],
  },
  {
    label: "insolvency",
    severity: "medium",
    patterns: [/\binsolven/i, /\bbankrupt/i, /\bliquidat/i, /\breceivership\b/i],
  },
  {
    label: "fraud",
    severity: "high",
    patterns: [/\bfraud\b/i, /\bscam\b/i, /\bponzi\b/i, /\bembezzl/i],
  },
];

export interface TriageResult {
  label: TriageLabel;
  severity: Severity;
  method: "keyword";
  matchedKeywords: string[];
}

/** Deterministic keyword triage. Clearly labelled method='keyword'; the
 *  router/worker overrides with method='ollama' when the LLM is configured. */
export function keywordClassify(text: string): TriageResult {
  const body = (text ?? "").slice(0, 20000);
  for (const rule of KEYWORD_RULES) {
    const hits = rule.patterns.filter((p) => p.test(body));
    if (hits.length > 0) {
      return { label: rule.label, severity: rule.severity, method: "keyword", matchedKeywords: hits.map((h) => h.source) };
    }
  }
  return { label: "other", severity: "info", method: "keyword", matchedKeywords: [] };
}

// ─── Entity matching (exact / alias / fuzzy with confidence) ────────────────

export interface RegistryEntry {
  id: number;
  name: string;
  aliases?: string[];
}

export interface EntityMatch {
  organization_id: number;
  matched_name: string;
  match_method: "exact" | "alias" | "fuzzy";
  confidence: number;
}

function normaliseName(n: string): string {
  return n
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(ltd|limited|plc|llc|inc|ng|nigeria|company|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bigram Dice coefficient on normalised names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    const t = s.replace(/ /g, "");
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  let overlap = 0;
  for (const [g, c] of A) overlap += Math.min(c, B.get(g) ?? 0);
  const total = na.replace(/ /g, "").length - 1 + (nb.replace(/ /g, "").length - 1);
  return total <= 0 ? 0 : (2 * overlap) / total;
}

/** Match free text against the organizations registry. Exact (normalised)
 *  name hit => 1.0; alias hit => 0.9; fuzzy bigram hit >= threshold => score. */
export function matchOrganizations(
  text: string,
  registry: RegistryEntry[],
  fuzzyThreshold = 0.6,
): EntityMatch[] {
  const body = normaliseName(text ?? "");
  if (!body) return [];
  const out: EntityMatch[] = [];
  for (const entry of registry) {
    const normName = normaliseName(entry.name);
    if (!normName) continue;
    if (body.includes(normName)) {
      out.push({ organization_id: entry.id, matched_name: entry.name, match_method: "exact", confidence: 1 });
      continue;
    }
    const aliasHit = (entry.aliases ?? []).find((a) => {
      const na = normaliseName(a);
      return na && body.includes(na);
    });
    if (aliasHit) {
      out.push({ organization_id: entry.id, matched_name: aliasHit, match_method: "alias", confidence: 0.9 });
      continue;
    }
    // Fuzzy: compare each multi-word window of the body against the name.
    const words = body.split(" ");
    const nameWords = normName.split(" ").length;
    let best = 0;
    for (let i = 0; i + nameWords <= words.length; i++) {
      best = Math.max(best, nameSimilarity(words.slice(i, i + nameWords).join(" "), normName));
    }
    if (best >= fuzzyThreshold) {
      out.push({
        organization_id: entry.id,
        matched_name: entry.name,
        match_method: "fuzzy",
        confidence: Math.round(best * 1000) / 1000,
      });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

// ─── Retention ───────────────────────────────────────────────────────────────

export function retentionExpiry(fetchedAt: Date, retentionDays: number): Date {
  const d = new Date(fetchedAt.getTime());
  d.setUTCDate(d.getUTCDate() + retentionDays);
  return d;
}
