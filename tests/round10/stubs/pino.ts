/**
 * Minimal pino stub for the round-10 test sandbox — the shared node_modules
 * mount lacks the pino entry point. Only the surface used by server/logger.ts
 * (default factory + stdTimeFunctions.isoTime) and the logger methods used by
 * server/permify.ts / server/permifySync.ts are implemented.
 */
type LogMethod = (...args: unknown[]) => void;

interface StubLogger {
  level: string;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
  trace: LogMethod;
  fatal: LogMethod;
  child: () => StubLogger;
}

function makeLogger(): StubLogger {
  const noop: LogMethod = () => undefined;
  const logger: StubLogger = {
    level: "silent",
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => makeLogger(),
  };
  return logger;
}

export default function pino(): StubLogger {
  return makeLogger();
}

export namespace pino {
  export const stdTimeFunctions = { isoTime: () => `,"time":${Date.now()}` };
  const identity = (v: unknown) => v;
  export const stdSerializers = { err: identity, req: identity, res: identity };
}

export const stdTimeFunctions = pino.stdTimeFunctions;
export const stdSerializers = pino.stdSerializers;
