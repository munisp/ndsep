/**
 * Anti-Wipe tRPC Router
 * ======================
 * Exposes the antiwipe controls. Mount in server/routers.ts as:
 *   import { antiwipeRouter } from "./antiwipe/router";
 *   ... appRouter = router({ ..., antiwipe: antiwipeRouter, ... })
 * (see /tmp/wave1/aw_registration.md during the parallel-edit wave)
 *
 * Procedure map:
 *   append / verify / anchor / status   -> hash-chained audit ledger
 *   vault*                              -> append-only evidence vault
 *   backup*                             -> backup manifest verification
 *   canary*                             -> ransomware tripwires
 */
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  appendLedger,
  anchorLedger,
  ledgerStatus,
  verifyChain,
} from "./ledger";
import {
  getVaultDir,
  listEvidence,
  putEvidence,
  sealEvidence,
  verifyEvidence,
  verifyRecentEvidence,
} from "./vault";
import {
  checkCanaries,
  listBackups,
  registerBackup,
  verifyBackup,
  watchedDirs,
  writeCanary,
} from "./backupGuard";

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024; // 32 MiB per evidence blob via tRPC

export const antiwipeRouter = router({
  // ── Ledger ──────────────────────────────────────────────────────────────
  append: protectedProcedure
    .input(
      z.object({
        action: z.string().min(1).max(128),
        payload: z.unknown(),
        actor: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const actor =
        input.actor ??
        (ctx.user ? `user:${ctx.user.id}` : "anonymous");
      return appendLedger(input.action, input.payload, actor);
    }),

  verify: protectedProcedure
    .input(
      z
        .object({
          fromSeq: z.number().int().positive().optional(),
          limit: z.number().int().positive().max(1_000_000).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => verifyChain(input ?? {})),

  anchor: adminProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
    .mutation(async ({ input }) => anchorLedger(input?.date)),

  status: protectedProcedure.query(async () => {
    const ledger = await ledgerStatus();
    return {
      ledger,
      vault: { dir: getVaultDir() },
      canaries: { watchedDirs: watchedDirs() },
    };
  }),

  // ── Evidence vault ──────────────────────────────────────────────────────
  vaultPut: protectedProcedure
    .input(
      z.object({
        contentBase64: z.string().min(1),
        contentType: z.string().max(256).optional(),
        caseRef: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const content = Buffer.from(input.contentBase64, "base64");
      if (content.length === 0 || content.length > MAX_UPLOAD_BYTES) {
        throw new Error(`evidence payload must be 1..${MAX_UPLOAD_BYTES} bytes`);
      }
      return putEvidence(content, {
        uploaderId: ctx.user?.id ?? null,
        uploaderName:
          (ctx.user as { name?: string | null; email?: string | null } | null)?.name ??
          (ctx.user as { email?: string | null } | null)?.email ??
          null,
        caseRef: input.caseRef ?? null,
        contentType: input.contentType ?? null,
      });
    }),

  vaultList: protectedProcedure
    .input(
      z
        .object({
          caseRef: z.string().optional(),
          sealed: z.boolean().optional(),
          limit: z.number().int().positive().max(500).optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listEvidence(input ?? {})),

  vaultVerify: protectedProcedure
    .input(z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) }))
    .query(async ({ input }) => verifyEvidence(input.hash)),

  vaultVerifyRecent: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(1000).optional() }).optional())
    .query(async ({ input }) => verifyRecentEvidence(input?.limit ?? 25)),

  vaultSeal: adminProcedure
    .input(z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) }))
    .mutation(async ({ input }) => sealEvidence(input.hash)),

  // ── Backup verification ─────────────────────────────────────────────────
  backupRegister: adminProcedure
    .input(
      z.object({
        backupId: z.string().min(1).max(256),
        type: z.string().max(64).optional(),
        path: z.string().min(1),
        startedAt: z.coerce.date().optional(),
        finishedAt: z.coerce.date().optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => registerBackup(input)),

  backupVerify: adminProcedure
    .input(z.object({ backupId: z.string().min(1) }))
    .mutation(async ({ input }) => verifyBackup(input.backupId)),

  backupList: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(500).optional() }).optional())
    .query(async ({ input }) => listBackups(input?.limit ?? 50)),

  // ── Canaries ────────────────────────────────────────────────────────────
  canaryWrite: adminProcedure
    .input(z.object({ dirs: z.array(z.string()).max(20).optional() }).optional())
    .mutation(async ({ input }) => writeCanary(input?.dirs)),

  canaryCheck: protectedProcedure.query(async () => checkCanaries()),
});
