/**
 * NDSEP Liveness Detection Router
 * =================================
 * tRPC procedures for biometric verification.
 * Proxies to the Python liveness microservice (port 8150)
 * with DB persistence and event publishing.
 *
 * Endpoints:
 *   liveness.passiveCheck     — Single-image passive liveness
 *   liveness.activeCheck      — Multi-frame active liveness
 *   liveness.faceDetect       — Face detection + 68-point landmarks
 *   liveness.faceMatch        — Two-image face comparison
 *   liveness.faceExtract      — 128-d face feature extraction
 *   liveness.antiSpoof        — Anti-spoofing classification
 *   liveness.deepfakeDetect   — Deepfake detection
 *   liveness.getResult        — Retrieve stored liveness result
 *   liveness.listResults      — List liveness results for a KYC record
 *   liveness.serviceHealth    — Liveness service health check
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import pg from "pg";
import { getPgSslConfig } from "../dbSslConfig";
import { getDatabaseUrl } from "../config";

const { Pool } = pg;
let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig() });
  }
  return _pool;
}
async function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  let idx = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
  const { rows } = await pool.query(pgSql, params);
  return rows as Record<string, unknown>[];
}

const LIVENESS_SERVICE_URL = process.env.LIVENESS_SERVICE_URL || "http://localhost:8150";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callLivenessService(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${LIVENESS_SERVICE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Liveness service error (${res.status}): ${text}`,
      });
    }
    return await res.json();
  } catch (err: unknown) {
    if (err instanceof TRPCError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, endpoint }, "liveness service call failed");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Liveness service unavailable: ${msg}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function generateRef(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${ts}-${rand}`.toUpperCase();
}

// ─── DB Persistence ──────────────────────────────────────────────────────────

async function persistLivenessResult(
  kycRecordId: number | null,
  checkType: string,
  result: Record<string, unknown>,
  userId: string,
): Promise<number> {
  const ref = generateRef("LIV");
  const rows = await query(
    `INSERT INTO liveness_checks
      (reference_id, kyc_record_id, check_type, is_live, liveness_score,
       face_detected, face_count, face_quality, spoof_type, spoof_probability,
       deepfake_probability, anti_spoof_score, confidence,
       result_json, performed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     RETURNING id`,
    [
      ref,
      kycRecordId,
      checkType,
      (result as Record<string, unknown>).is_live ?? (result as Record<string, unknown>).is_match ?? false,
      (result as Record<string, unknown>).liveness_score ?? (result as Record<string, unknown>).confidence ?? 0,
      (result as Record<string, unknown>).face_detected ?? true,
      (result as Record<string, unknown>).face_count ?? 1,
      (result as Record<string, unknown>).face_quality ?? 0,
      ((result as Record<string, unknown>).anti_spoof as Record<string, unknown>)?.spoof_type ?? "unknown",
      ((result as Record<string, unknown>).anti_spoof as Record<string, unknown>)?.spoof_probability ?? 0,
      ((result as Record<string, unknown>).deepfake as Record<string, unknown>)?.deepfake_probability ?? 0,
      ((result as Record<string, unknown>).anti_spoof as Record<string, unknown>)?.overall_score ?? 0,
      (result as Record<string, unknown>).confidence ?? (result as Record<string, unknown>).liveness_score ?? 0,
      JSON.stringify(result),
      userId,
    ]
  ) as { id: number }[];

  return rows[0]?.id ?? 0;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const livenessRouter = router({
  /** Single-image passive liveness check */
  passiveCheck: protectedProcedure
    .input(z.object({
      image: z.string().min(100, "Image data too short"),
      kycRecordId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }): Promise<{
      is_live: boolean; liveness_score: number; face_detected: boolean;
      face_count: number; face_quality: number;
      anti_spoof: Record<string, unknown> | null; deepfake: Record<string, unknown> | null;
      landmarks_68: number[][] | null; landmark_features: Record<string, number> | null;
      processing_time_ms: number; details: string; checkId: number;
    }> => {
      const r = await callLivenessService("/api/liveness/passive", {
        image: input.image,
      }) as Record<string, unknown>;

      const checkId = await persistLivenessResult(
        input.kycRecordId ?? null, "passive", r,
        ctx.user.email ?? ctx.user.name ?? "system",
      );

      if (input.kycRecordId) {
        await query(
          `UPDATE kyc_records SET liveness_score = ?, updated_at = NOW() WHERE id = ?`,
          [r.liveness_score, input.kycRecordId]
        );
      }

      emitMutationEvent("ndsep.liveness.passive", {
        checkId, kycRecordId: input.kycRecordId,
        isLive: r.is_live, score: r.liveness_score, ts: new Date().toISOString(),
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "event publish failed"));

      return {
        is_live: Boolean(r.is_live), liveness_score: Number(r.liveness_score ?? 0),
        face_detected: Boolean(r.face_detected), face_count: Number(r.face_count ?? 0),
        face_quality: Number(r.face_quality ?? 0),
        anti_spoof: (r.anti_spoof as Record<string, unknown>) ?? null,
        deepfake: (r.deepfake as Record<string, unknown>) ?? null,
        landmarks_68: (r.landmarks_68 as number[][]) ?? null,
        landmark_features: (r.landmark_features as Record<string, number>) ?? null,
        processing_time_ms: Number(r.processing_time_ms ?? 0),
        details: String(r.details ?? ""), checkId,
      };
    }),

  /** Multi-frame active liveness check with challenges */
  activeCheck: protectedProcedure
    .input(z.object({
      frames: z.array(z.string().min(100)).min(3).max(60),
      challenges: z.array(z.enum(["blink", "turn_left", "turn_right", "nod", "open_mouth"])).optional(),
      kycRecordId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }): Promise<{
      is_live: boolean; liveness_score: number; challenges_passed: number;
      challenges_total: number; blink_detected: boolean; head_movement_detected: boolean;
      motion_consistency: number; frame_count: number;
      anti_spoof: Record<string, unknown> | null; deepfake: Record<string, unknown> | null;
      processing_time_ms: number; details: string;
      challenge_results: Record<string, boolean>; checkId: number;
    }> => {
      const r = await callLivenessService("/api/liveness/active", {
        frames: input.frames,
        challenges: input.challenges ?? ["blink", "turn_left"],
      }) as Record<string, unknown>;

      const checkId = await persistLivenessResult(
        input.kycRecordId ?? null, "active", r,
        ctx.user.email ?? ctx.user.name ?? "system",
      );

      if (input.kycRecordId) {
        await query(
          `UPDATE kyc_records SET liveness_score = ?, updated_at = NOW() WHERE id = ?`,
          [r.liveness_score, input.kycRecordId]
        );
      }

      emitMutationEvent("ndsep.liveness.active", {
        checkId, kycRecordId: input.kycRecordId,
        isLive: r.is_live, score: r.liveness_score,
        challengesPassed: r.challenges_passed, ts: new Date().toISOString(),
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "event publish failed"));

      return {
        is_live: Boolean(r.is_live), liveness_score: Number(r.liveness_score ?? 0),
        challenges_passed: Number(r.challenges_passed ?? 0),
        challenges_total: Number(r.challenges_total ?? 0),
        blink_detected: Boolean(r.blink_detected),
        head_movement_detected: Boolean(r.head_movement_detected),
        motion_consistency: Number(r.motion_consistency ?? 0),
        frame_count: Number(r.frame_count ?? 0),
        anti_spoof: (r.anti_spoof as Record<string, unknown>) ?? null,
        deepfake: (r.deepfake as Record<string, unknown>) ?? null,
        processing_time_ms: Number(r.processing_time_ms ?? 0),
        details: String(r.details ?? ""),
        challenge_results: (r.challenge_results as Record<string, boolean>) ?? {},
        checkId,
      };
    }),

  /** Face detection with 68-point landmarks */
  faceDetect: protectedProcedure
    .input(z.object({ image: z.string().min(100) }))
    .mutation(async ({ input }) => {
      return await callLivenessService("/api/face/detect", { image: input.image });
    }),

  /** Face matching — compare two images */
  faceMatch: protectedProcedure
    .input(z.object({
      imageA: z.string().min(100),
      imageB: z.string().min(100),
      threshold: z.number().min(0).max(1).default(0.6),
      kycRecordId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }): Promise<{
      is_match: boolean; similarity: number; distance: number;
      confidence: number; threshold: number; embedding_model: string; checkId: number;
    }> => {
      const r = await callLivenessService("/api/face/match", {
        image_a: input.imageA,
        image_b: input.imageB,
        threshold: input.threshold,
      }) as Record<string, unknown>;

      const checkId = await persistLivenessResult(
        input.kycRecordId ?? null, "face_match", r,
        ctx.user.email ?? ctx.user.name ?? "system",
      );

      if (input.kycRecordId) {
        await query(
          `UPDATE kyc_records SET face_match_score = ?, updated_at = NOW() WHERE id = ?`,
          [Number(r.confidence), input.kycRecordId]
        );
      }

      emitMutationEvent("ndsep.liveness.face_match", {
        checkId, kycRecordId: input.kycRecordId,
        isMatch: r.is_match, similarity: r.similarity, ts: new Date().toISOString(),
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "event publish failed"));

      return {
        is_match: Boolean(r.is_match), similarity: Number(r.similarity ?? 0),
        distance: Number(r.distance ?? 0), confidence: Number(r.confidence ?? 0),
        threshold: Number(r.threshold ?? 0.6), embedding_model: String(r.embedding_model ?? ""),
        checkId,
      };
    }),

  /** Extract 128-d face feature embedding */
  faceExtract: protectedProcedure
    .input(z.object({ image: z.string().min(100) }))
    .mutation(async ({ input }) => {
      return await callLivenessService("/api/face/extract", { image: input.image });
    }),

  /** Anti-spoofing classification */
  antiSpoof: protectedProcedure
    .input(z.object({ image: z.string().min(100) }))
    .mutation(async ({ input }) => {
      const r = await callLivenessService("/api/anti-spoof/classify", { image: input.image }) as Record<string, unknown>;
      return {
        is_real: Boolean(r.is_real),
        overall_score: Number(r.overall_score ?? 0),
        spoof_type: String(r.spoof_type ?? "unknown"),
        spoof_probability: Number(r.spoof_probability ?? 0),
        checks: (r.checks ?? []) as { name: string; score: number; weight: number; details: string }[],
        attack_details: (r.attack_details ?? {}) as Record<string, number>,
      };
    }),

  /** Deepfake detection */
  deepfakeDetect: protectedProcedure
    .input(z.object({ image: z.string().min(100) }))
    .mutation(async ({ input }) => {
      const r = await callLivenessService("/api/deepfake/detect", { image: input.image }) as Record<string, unknown>;
      return {
        is_deepfake: Boolean(r.is_deepfake),
        confidence: Number(r.confidence ?? 0),
        deepfake_probability: Number(r.deepfake_probability ?? 0),
        frequency_score: Number(r.frequency_score ?? 0),
        blending_score: Number(r.blending_score ?? 0),
        lighting_score: Number(r.lighting_score ?? 0),
        texture_score: Number(r.texture_score ?? 0),
        details: String(r.details ?? ""),
      };
    }),

  /** Retrieve a stored liveness check result */
  getResult: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await query(
        `SELECT * FROM liveness_checks WHERE id = ?`, [input.id]
      ) as Record<string, unknown>[];
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const row = rows[0];
      return {
        ...row,
        resultJson: typeof row.result_json === "string" ? JSON.parse(row.result_json as string) : row.result_json,
      };
    }),

  /** List liveness results for a KYC record */
  listResults: protectedProcedure
    .input(z.object({
      kycRecordId: z.number().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (input.kycRecordId !== undefined) {
        conditions.push("kyc_record_id = ?");
        params.push(input.kycRecordId);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = await query(
        `SELECT id, reference_id, kyc_record_id, check_type, is_live, liveness_score,
                face_count, face_quality, spoof_type, spoof_probability,
                deepfake_probability, anti_spoof_score, confidence,
                performed_by, created_at
         FROM liveness_checks ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, input.limit, input.offset]
      ) as Record<string, unknown>[];
      return rows;
    }),

  /** Liveness service health check */
  serviceHealth: protectedProcedure.query(async () => {
    try {
      const res = await fetch(`${LIVENESS_SERVICE_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { healthy: false, error: `HTTP ${res.status}` };
      return { healthy: true, ...(await res.json() as Record<string, unknown>) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { healthy: false, error: msg };
    }
  }),
});
