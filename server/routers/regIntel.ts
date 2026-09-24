/**
 * Regulatory Intelligence Knowledge Base Router
 *
 * Versioned corpus of Nigerian data-protection legal instruments (NDPA 2023,
 * GAID 2025, subsidiary legislation, tribunal / Federal High Court precedents):
 *
 *   - Corpus CRUD: instruments → versions (supersession chains, effective
 *     dates) → section chunks (migration 0091).
 *   - Ingestion delegates chunking/embedding/Qdrant upsert to
 *     workers/python/regintel_ingest_worker.py (REGINTEL_WORKER_URL). When the
 *     worker is unreachable the router persists sections via a LOCAL DEGRADED
 *     chunker and records ingest_status explicitly — embeddings/vectors are
 *     never fabricated.
 *   - askLegal(question): tries the EPR-KGQA worker (EPR_KGQA_URL, /ask) when
 *     configured; otherwise falls back to a direct keyword search over
 *     legal_sections, CLEARLY LABELED as `degraded_keyword_fallback`. Every
 *     answer carries section-level citations (instrument, section, version,
 *     effective date) and provenance is persisted in legal_queries.
 *   - Legal-change alerts: rule_legal_references maps platform rules/workflows
 *     to sections; adding a superseding version surfaces every rule that
 *     references a superseded section.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";

const REGINTEL_WORKER_URL = process.env.REGINTEL_WORKER_URL ?? "http://localhost:8210";
const EPR_KGQA_URL = process.env.EPR_KGQA_URL ?? process.env.KGQA_WORKER_URL ?? "";
const WORKER_TIMEOUT_MS = Number(process.env.REGINTEL_WORKER_TIMEOUT_MS ?? 15000);
const KGQA_TIMEOUT_MS = Number(process.env.EPR_KGQA_TIMEOUT_MS ?? 5000);

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[regIntel] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  userId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    const toInt = (v: string | number | null): number | null => {
      if (v == null) return null;
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
    };
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [action, resourceType, toInt(resourceId), toInt(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[regIntel] Audit log write failed");
  }
}

// ─── Local degraded chunker ─────────────────────────────────────────────────
// Mirrors workers/python/regintel_ingest_worker.chunk_by_section. Used ONLY
// when the ingest worker is unreachable; rows ingested this way carry
// ingest_status "degraded_local_chunk" and no qdrant_point_id.
const SECTION_RE = /^\s*(Section|SECTION|Article|ARTICLE|Regulation|REGULATION|Rule|RULE|Clause|CLAUSE)\s+([0-9]+(?:\([0-9a-z]+\))*)/gm;
const MAX_CHUNK_CHARS = 4000;

interface LocalChunk { section_ref: string; heading: string | null; body: string; chunk_index: number; }

function splitOversize(sectionRef: string, heading: string | null, body: string): LocalChunk[] {
  const paragraphs = body.split(/\n\s*\n/);
  const chunks: LocalChunk[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > MAX_CHUNK_CHARS) {
      chunks.push({ section_ref: sectionRef, heading, body: current.trim(), chunk_index: chunks.length });
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) {
    chunks.push({ section_ref: sectionRef, heading, body: current.trim(), chunk_index: chunks.length });
  }
  return chunks;
}

function chunkBySectionLocal(text: string): LocalChunk[] {
  if (!text.trim()) return [];
  const matches = Array.from(text.matchAll(SECTION_RE));
  if (matches.length === 0) return splitOversize("Unsectioned", null, text.trim());
  const chunks: LocalChunk[] = [];
  const preamble = text.slice(0, matches[0].index).trim();
  if (preamble) chunks.push(...splitOversize("Preamble", null, preamble));
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const block = text.slice(start, end).trim();
    const sectionRef = `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
    const firstLine = block.split("\n")[0] ?? "";
    const tail = firstLine.slice(m[0].length).replace(/^[\s.\-—:]+/, "").trim();
    const heading = tail && tail.length <= 200 ? tail : null;
    chunks.push(...splitOversize(sectionRef, heading, block));
  }
  return chunks;
}

interface IngestChunk extends LocalChunk { qdrant_point_id?: string; }

interface WorkerIngestResult {
  status: string;
  chunks?: IngestChunk[];
  embed_status?: Record<string, unknown>;
  qdrant_status?: Record<string, unknown>;
  reason?: string;
}

/** Call the ingest worker; returns null when unreachable (explicit degrade). */
async function callIngestWorker(payload: Record<string, unknown>): Promise<WorkerIngestResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
    const resp = await fetch(`${REGINTEL_WORKER_URL}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return (await resp.json()) as WorkerIngestResult;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[regIntel] ingest worker unreachable");
    return null;
  }
}

interface Citation {
  instrument: string;
  section_ref: string;
  version_label: string;
  effective_date: string;
}

/** Keyword fallback retrieval over legal_sections (current versions only). */
async function keywordRetrieve(question: string, topK: number): Promise<any[]> {
  const terms = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !["what", "when", "does", "under", "with", "from", "that", "this", "shall"].includes(t))
    .slice(0, 6);
  if (terms.length === 0) return [];
  const likes = terms.map((_, i) => `LOWER(s.body) LIKE $${i + 1}`).join(" OR ");
  const params: unknown[] = terms.map((t) => `%${t}%`);
  params.push(topK);
  return exec(
    `SELECT s.section_ref, s.heading, s.body, v.version_label, v.effective_date, i.code AS instrument
     FROM legal_sections s
     JOIN legal_versions v ON v.id = s.version_id AND v.status = 'current'
     JOIN legal_instruments i ON i.id = s.instrument_id
     WHERE ${likes}
     ORDER BY s.id
     LIMIT $${params.length}`,
    params,
  );
}

function toCitation(row: any): Citation {
  return {
    instrument: row.instrument,
    section_ref: row.section_ref,
    version_label: row.version_label,
    effective_date: row.effective_date instanceof Date
      ? row.effective_date.toISOString().slice(0, 10)
      : String(row.effective_date),
  };
}

/** Sections whose effective text changed between a version and its successor. */
async function findAffectedRules(instrumentId: number, supersededVersionId: number | null) {
  if (!supersededVersionId) return [];
  return exec(
    `SELECT r.id, r.rule_type, r.rule_ref, r.section_ref, r.note
     FROM rule_legal_references r
     WHERE r.instrument_id = $1
       AND EXISTS (
         SELECT 1 FROM legal_sections s
         WHERE s.version_id = $2 AND s.section_ref = r.section_ref
       )
     ORDER BY r.rule_type, r.rule_ref`,
    [instrumentId, supersededVersionId],
  );
}

export const regIntelRouter = router({
  // ─── Corpus CRUD ─────────────────────────────────────────────────────────

  createInstrument: adminProcedure
    .input(z.object({
      code: z.string().min(2).max(64).regex(/^[A-Z0-9][A-Z0-9\-]*$/, "Uppercase code, e.g. NDPA-2023"),
      title: z.string().min(4).max(512),
      instrumentType: z.enum(["act", "regulation", "guidance", "subsidiary_legislation", "tribunal_precedent", "court_precedent"]),
      issuingAuthority: z.string().max(255).optional(),
      gazetteRef: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `INSERT INTO legal_instruments (code, title, instrument_type, issuing_authority, gazette_ref, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET
           title = EXCLUDED.title, instrument_type = EXCLUDED.instrument_type,
           issuing_authority = EXCLUDED.issuing_authority, gazette_ref = EXCLUDED.gazette_ref,
           updated_at = NOW()
         RETURNING id, code, title, instrument_type, status`,
        [input.code, input.title, input.instrumentType, input.issuingAuthority ?? null, input.gazetteRef ?? null, ctx.user.email ?? String(ctx.user.id)],
      );
      await logAudit("regintel.instrument_create", "legal_instrument", rows[0].id, String(ctx.user.id), { code: input.code });
      return rows[0];
    }),

  /**
   * Add a new version of an instrument. The full instrument text is chunked
   * (+ embedded / vector-upserted by the ingest worker when configured), the
   * previous current version is marked superseded (supersession chain), and
   * every platform rule/workflow referencing a superseded section is returned
   * as a legal-change alert.
   */
  addVersion: adminProcedure
    .input(z.object({
      instrumentCode: z.string().min(2).max(64),
      versionLabel: z.string().min(1).max(128),
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD"),
      fullText: z.string().min(50),
      source: z.string().max(512).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const instrument = await exec(
        `SELECT id, code, title FROM legal_instruments WHERE code = $1`,
        [input.instrumentCode],
      );
      if (!instrument[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found — create it first" });

      const current = await exec(
        `SELECT id, version_label FROM legal_versions
         WHERE instrument_id = $1 AND status = 'current'
         ORDER BY effective_date DESC LIMIT 1`,
        [instrument[0].id],
      );
      const superseded = current[0] ?? null;

      const versionRows = await exec(
        `INSERT INTO legal_versions (instrument_id, version_label, effective_date, supersedes_version_id, source, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (instrument_id, version_label) DO UPDATE SET
           effective_date = EXCLUDED.effective_date,
           supersedes_version_id = EXCLUDED.supersedes_version_id,
           source = EXCLUDED.source
         RETURNING id, version_label`,
        [instrument[0].id, input.versionLabel, input.effectiveDate, superseded?.id ?? null, input.source ?? null, ctx.user.email ?? String(ctx.user.id)],
      );
      const version = versionRows[0];

      // Chunk + embed via the ingest worker; degrade explicitly to local
      // chunking (no vectors) when the worker is unreachable.
      const workerResult = await callIngestWorker({
        instrument_code: instrument[0].code,
        instrument_title: instrument[0].title,
        version_label: input.versionLabel,
        effective_date: input.effectiveDate,
        supersedes_version_label: superseded?.version_label ?? null,
        text: input.fullText,
      });

      let chunks: IngestChunk[];
      let ingestStatus: Record<string, unknown>;
      if (workerResult && workerResult.status === "ok" && workerResult.chunks) {
        chunks = workerResult.chunks;
        ingestStatus = {
          mode: "worker",
          embed_status: workerResult.embed_status ?? { status: "EMBED_UNCONFIGURED" },
          qdrant_status: workerResult.qdrant_status ?? { status: "QDRANT_UNCONFIGURED" },
        };
      } else {
        // DEGRADED: local chunking only. No embeddings, no Qdrant points.
        chunks = chunkBySectionLocal(input.fullText);
        ingestStatus = {
          mode: "degraded_local_chunk",
          reason: workerResult?.reason ?? "regintel_ingest_worker unreachable",
          embed_status: { status: "EMBED_UNCONFIGURED" },
          qdrant_status: { status: "QDRANT_UNCONFIGURED" },
        };
      }

      await exec(`DELETE FROM legal_sections WHERE version_id = $1`, [version.id]);
      for (const chunk of chunks) {
        await exec(
          `INSERT INTO legal_sections (instrument_id, version_id, section_ref, heading, body, chunk_index, qdrant_point_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (version_id, section_ref, chunk_index) DO UPDATE SET
             heading = EXCLUDED.heading, body = EXCLUDED.body, qdrant_point_id = EXCLUDED.qdrant_point_id`,
          [instrument[0].id, version.id, chunk.section_ref, chunk.heading ?? null, chunk.body, chunk.chunk_index, chunk.qdrant_point_id ?? null],
        );
      }

      // Close the supersession chain: prior current version → superseded.
      if (superseded && superseded.id !== version.id) {
        await exec(
          `UPDATE legal_versions SET status = 'superseded' WHERE id = $1`,
          [superseded.id],
        );
      }
      await exec(
        `UPDATE legal_versions SET status = 'current' WHERE id = $1`,
        [version.id],
      );

      // Legal-change alerts: rules referencing sections of the superseded version.
      const affectedRules = superseded && superseded.id !== version.id
        ? await findAffectedRules(instrument[0].id, superseded.id)
        : [];

      await logAudit("regintel.version_add", "legal_version", version.id, String(ctx.user.id), {
        instrument: input.instrumentCode,
        version: input.versionLabel,
        supersedes: superseded?.version_label ?? null,
        chunks: chunks.length,
        affected_rules: affectedRules.length,
        ingest_mode: ingestStatus.mode,
      });
      emitMutationEvent("ndsep.regintel.version", {
        action: "addVersion", instrument: input.instrumentCode, version: input.versionLabel,
        affectedRules: affectedRules.length, ts: new Date().toISOString(),
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));

      return {
        versionId: version.id,
        versionLabel: version.version_label,
        supersedes: superseded?.version_label ?? null,
        chunkCount: chunks.length,
        ingestStatus,
        legalChangeAlerts: affectedRules,
      };
    }),

  listInstruments: publicProcedure
    .input(z.object({
      instrumentType: z.enum(["act", "regulation", "guidance", "subsidiary_legislation", "tribunal_precedent", "court_precedent"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      let sql = `SELECT i.id, i.code, i.title, i.instrument_type, i.issuing_authority, i.gazette_ref, i.status,
                        (SELECT v.version_label FROM legal_versions v WHERE v.instrument_id = i.id AND v.status = 'current'
                         ORDER BY v.effective_date DESC LIMIT 1) AS current_version
                 FROM legal_instruments i`;
      const params: unknown[] = [];
      if (input?.instrumentType) {
        params.push(input.instrumentType);
        sql += ` WHERE i.instrument_type = $1`;
      }
      sql += ` ORDER BY i.code`;
      return exec(sql, params);
    }),

  getInstrument: publicProcedure
    .input(z.object({ code: z.string().min(2).max(64) }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT * FROM legal_instruments WHERE code = $1`, [input.code]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found" });
      const versions = await exec(
        `SELECT v.id, v.version_label, v.effective_date, v.status, v.source,
                sv.version_label AS supersedes_label,
                (SELECT COUNT(*)::int FROM legal_sections s WHERE s.version_id = v.id) AS section_count
         FROM legal_versions v
         LEFT JOIN legal_versions sv ON sv.id = v.supersedes_version_id
         WHERE v.instrument_id = $1
         ORDER BY v.effective_date DESC`,
        [rows[0].id],
      );
      return { ...rows[0], versions };
    }),

  listSections: publicProcedure
    .input(z.object({
      instrumentCode: z.string().min(2).max(64),
      versionLabel: z.string().max(128).optional(), // default: current version
    }))
    .query(async ({ input }) => {
      const params: unknown[] = [input.instrumentCode];
      let versionFilter = `v.status = 'current'`;
      if (input.versionLabel) {
        params.push(input.versionLabel);
        versionFilter = `v.version_label = $2`;
      }
      return exec(
        `SELECT s.section_ref, s.heading, s.chunk_index,
                LEFT(s.body, 500) AS body_excerpt,
                (s.qdrant_point_id IS NOT NULL) AS embedded,
                v.version_label, v.effective_date
         FROM legal_sections s
         JOIN legal_versions v ON v.id = s.version_id AND ${versionFilter}
         JOIN legal_instruments i ON i.id = s.instrument_id AND i.code = $1
         ORDER BY s.section_ref, s.chunk_index`,
        params,
      );
    }),

  // ─── askLegal ────────────────────────────────────────────────────────────

  /**
   * Answer a legal question against the corpus. Primary path: EPR-KGQA worker
   * (EPR_KGQA_URL /ask). Fallback: direct keyword retrieval over
   * legal_sections, CLEARLY labeled degraded_keyword_fallback. Provenance
   * (question, mode, answer, citations) is always persisted.
   */
  askLegal: publicProcedure
    .input(z.object({
      question: z.string().min(8).max(2000),
      topK: z.number().int().min(1).max(10).default(5),
    }))
    .mutation(async ({ input, ctx }) => {
      const retrieved = await keywordRetrieve(input.question, input.topK);
      const citations = retrieved.map(toCitation);

      let mode: "kgqa" | "degraded_keyword_fallback" = "degraded_keyword_fallback";
      let answer: string;
      const retrievalMeta: Record<string, unknown> = { top_k: input.topK, keyword_hits: retrieved.length };

      if (EPR_KGQA_URL) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), KGQA_TIMEOUT_MS);
          const resp = await fetch(`${EPR_KGQA_URL}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: input.question }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (resp.ok) {
            const data = (await resp.json()) as { answer?: string };
            if (data.answer) {
              mode = "kgqa";
              answer = data.answer;
              retrievalMeta.kgqa_status = "ok";
            } else {
              throw new Error("KGQA response missing answer");
            }
          } else {
            throw new Error(`KGQA HTTP ${resp.status}`);
          }
        } catch (err) {
          retrievalMeta.kgqa_status = "unavailable";
          retrievalMeta.degraded_reason = err instanceof Error ? err.message : String(err);
          answer = "";
        }
      } else {
        retrievalMeta.kgqa_status = "UNCONFIGURED";
        retrievalMeta.degraded_reason = "EPR_KGQA_URL is not set; using keyword fallback";
        answer = "";
      }

      if (mode === "degraded_keyword_fallback") {
        // DEGRADED PATH — explicit in both the mode field and the answer text.
        if (retrieved.length === 0) {
          answer = "[DEGRADED — keyword fallback, no LLM] No sections in the legal corpus matched this question. "
            + "Ingest the relevant instrument (or configure EPR_KGQA_URL for full KGQA retrieval) and retry.";
        } else {
          const excerpts = retrieved
            .map((r, i) => `[${i + 1}] ${r.instrument} ${r.section_ref}${r.heading ? ` — ${r.heading}` : ""} `
              + `(version ${r.version_label}, effective ${String(r.effective_date).slice(0, 10)}):\n`
              + `${String(r.body).slice(0, 800)}`)
            .join("\n\n");
          answer = "[DEGRADED — keyword fallback, no LLM synthesis] The following corpus sections keyword-match your question; "
            + "read them directly rather than relying on an automated summary:\n\n" + excerpts;
        }
      }

      const rows = await exec(
        `INSERT INTO legal_queries (question, mode, answer, citations, retrieval_meta, asked_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [input.question, mode, answer, JSON.stringify(citations), JSON.stringify(retrievalMeta), ctx.user ? String(ctx.user.id) : null],
      );
      await logAudit("regintel.ask", "legal_query", rows[0].id, ctx.user ? String(ctx.user.id) : null, { mode, citations: citations.length });

      return { id: rows[0].id, mode, answer, citations, retrievalMeta };
    }),

  /** Provenance trail for past answers (officers/auditors). */
  listQueries: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      mode: z.enum(["kgqa", "degraded_keyword_fallback"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      let sql = `SELECT id, question, mode, LEFT(answer, 400) AS answer_excerpt, citations, retrieval_meta, asked_by, created_at
                 FROM legal_queries`;
      const params: unknown[] = [];
      if (input?.mode) {
        params.push(input.mode);
        sql += ` WHERE mode = $1`;
      }
      params.push(input?.limit ?? 20);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      return exec(sql, params);
    }),

  // ─── Rule ↔ section references & legal-change alerts ─────────────────────

  registerRuleReference: adminProcedure
    .input(z.object({
      ruleType: z.enum(["platform_rule", "workflow", "compliance_check", "penalty_basis"]),
      ruleRef: z.string().min(2).max(255),
      instrumentCode: z.string().min(2).max(64),
      sectionRef: z.string().min(1).max(64),
      note: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const instrument = await exec(`SELECT id FROM legal_instruments WHERE code = $1`, [input.instrumentCode]);
      if (!instrument[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found" });
      const rows = await exec(
        `INSERT INTO rule_legal_references (rule_type, rule_ref, instrument_id, section_ref, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (rule_type, rule_ref, instrument_id, section_ref) DO UPDATE SET note = EXCLUDED.note
         RETURNING id`,
        [input.ruleType, input.ruleRef, instrument[0].id, input.sectionRef, input.note ?? null, ctx.user.email ?? String(ctx.user.id)],
      );
      await logAudit("regintel.rule_ref_register", "rule_legal_reference", rows[0].id, String(ctx.user.id), {
        rule: input.ruleRef, instrument: input.instrumentCode, section: input.sectionRef,
      });
      return { success: true, id: rows[0].id };
    }),

  removeRuleReference: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(`DELETE FROM rule_legal_references WHERE id = $1 RETURNING id`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Reference not found" });
      await logAudit("regintel.rule_ref_remove", "rule_legal_reference", input.id, String(ctx.user.id), {});
      return { success: true };
    }),

  /**
   * Legal-change alerts: every rule/workflow that references a section whose
   * version has been superseded (i.e. the section exists on a non-current
   * version but the instrument has since moved on). Review these after any
   * addVersion that reports legalChangeAlerts.
   */
  legalChangeAlerts: protectedProcedure
    .input(z.object({ instrumentCode: z.string().min(2).max(64).optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let filter = "";
      if (input?.instrumentCode) {
        params.push(input.instrumentCode);
        filter = `AND i.code = $1`;
      }
      return exec(
        `SELECT r.id, r.rule_type, r.rule_ref, r.section_ref, r.note,
                i.code AS instrument,
                sv.version_label AS superseded_version,
                cv.version_label AS current_version,
                cv.effective_date AS current_effective_date
         FROM rule_legal_references r
         JOIN legal_instruments i ON i.id = r.instrument_id
         JOIN legal_versions sv ON sv.instrument_id = i.id AND sv.status = 'superseded'
         JOIN legal_sections ss ON ss.version_id = sv.id AND ss.section_ref = r.section_ref
         JOIN legal_versions cv ON cv.instrument_id = i.id AND cv.status = 'current'
         WHERE 1=1 ${filter}
         ORDER BY i.code, r.rule_type, r.rule_ref`,
        params,
      );
    }),
});
