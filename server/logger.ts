/**
 * NDSEP Production Logger
 * Structured JSON logging via pino with pretty-print in development.
 * All application code should import from this module instead of using console.log.
 */
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  base: {
    service: "ndsep-api",
    env: process.env.NODE_ENV ?? "development",
    version: process.env.npm_package_version ?? "3.0.0",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname,service,env,version",
          },
        },
      }
    : {}),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

/** Child logger for a specific module/component */
export function childLogger(component: string, extra?: Record<string, unknown>) {
  return logger.child({ component, ...extra });
}

export default logger;
