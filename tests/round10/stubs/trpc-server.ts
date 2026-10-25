/**
 * Minimal @trpc/server stub for the round-10 test sandbox — the shared
 * node_modules mount ships a broken package entry for ESM resolution. Only
 * TRPCError (used by server/permify.ts) is implemented, with the real shape:
 * `code` and `message` properties.
 */
export class TRPCError extends Error {
  readonly code: string;
  constructor(opts: { code: string; message?: string; cause?: unknown }) {
    super(opts.message ?? opts.code);
    this.name = "TRPCError";
    this.code = opts.code;
  }
}
