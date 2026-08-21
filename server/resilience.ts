/**
 * NDSEP Resilience Module
 * =======================
 * Production-grade circuit breaker + retry with exponential backoff.
 *
 * Circuit Breaker States:
 *   CLOSED   → normal operation, requests pass through
 *   OPEN     → failure threshold exceeded, requests fail-fast
 *   HALF_OPEN → probe state, one request allowed to test recovery
 *
 * Usage:
 *   const cb = getCircuitBreaker("kafka");
 *   const result = await cb.execute(() => kafkaProduce(topic, message));
 *
 *   // With retry:
 *   const result = await withRetry(() => fetchFromOpenSearch(query), { maxAttempts: 3 });
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Number of consecutive successes in HALF_OPEN to close the circuit (default: 2) */
  successThreshold?: number;
  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN (default: 30_000) */
  resetTimeoutMs?: number;
  /** Optional name for logging */
  name?: string;
}

export interface RetryOptions {
  /** Maximum number of attempts including the first (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms before first retry (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default: 10_000) */
  maxDelayMs?: number;
  /** Jitter factor 0–1 to randomize delay (default: 0.2) */
  jitter?: number;
  /** Predicate to decide if an error is retryable (default: always retry) */
  isRetryable?: (err: unknown) => boolean;
  /** Optional name for logging */
  name?: string;
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastOpenedAt: number | null = null;
  private readonly opts: Required<CircuitBreakerOptions>;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.opts = {
      failureThreshold: opts.failureThreshold ?? 5,
      successThreshold: opts.successThreshold ?? 2,
      resetTimeoutMs:   opts.resetTimeoutMs   ?? 30_000,
      name:             opts.name             ?? "unnamed",
    };
  }

  get currentState(): CircuitState { return this.state; }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - (this.lastOpenedAt ?? 0);
      if (elapsed >= this.opts.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        this.successes = 0;
        logger.info({ circuit: this.opts.name }, "[CircuitBreaker] HALF_OPEN — probing recovery");
      } else {
        throw new Error(`[CircuitBreaker:${this.opts.name}] Circuit OPEN — failing fast (${Math.round((this.opts.resetTimeoutMs - elapsed) / 1000)}s until probe)`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.opts.successThreshold) {
        this.state = "CLOSED";
        logger.info({ circuit: this.opts.name }, "[CircuitBreaker] CLOSED — service recovered");
      }
    }
  }

  private onFailure(err: unknown): void {
    this.failures++;
    if (this.state === "HALF_OPEN" || this.failures >= this.opts.failureThreshold) {
      this.state = "OPEN";
      this.lastOpenedAt = Date.now();
      logger.warn({ circuit: this.opts.name, failures: this.failures, err }, "[CircuitBreaker] OPEN — failure threshold exceeded");
    }
  }

  /** Reset the circuit breaker to CLOSED state (e.g., after manual intervention) */
  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.successes = 0;
    this.lastOpenedAt = null;
  }

  toJSON() {
    return {
      name:    this.opts.name,
      state:   this.state,
      failures: this.failures,
      lastOpenedAt: this.lastOpenedAt,
    };
  }
}

// ─── Circuit Breaker Registry ─────────────────────────────────────────────────

const registry = new Map<string, CircuitBreaker>();

/**
 * Get or create a named circuit breaker.
 * Reuses the same instance across calls with the same name.
 */
export function getCircuitBreaker(name: string, opts?: CircuitBreakerOptions): CircuitBreaker {
  if (!registry.has(name)) {
    registry.set(name, new CircuitBreaker({ ...opts, name }));
  }
  return registry.get(name)!;
}

/** Get all circuit breaker states for health reporting */
export function getAllCircuitBreakerStates(): ReturnType<CircuitBreaker["toJSON"]>[] {
  return Array.from(registry.values()).map(cb => cb.toJSON());
}

// ─── Retry with Exponential Backoff ──────────────────────────────────────────

/**
 * Execute an async function with exponential backoff retry.
 *
 * @param fn          The async function to execute
 * @param opts        Retry options
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts  = 3,
    initialDelayMs = 100,
    maxDelayMs   = 10_000,
    jitter       = 0.2,
    isRetryable  = () => true,
    name         = "operation",
  } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isRetryable(err)) {
        throw err;
      }
      const base = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitterMs = base * jitter * Math.random();
      const delay = Math.round(base + jitterMs);
      logger.warn({ name, attempt, maxAttempts, delayMs: delay, err }, "[Retry] Attempt failed — retrying");
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Resilient Wrapper (Circuit Breaker + Retry) ──────────────────────────────

/**
 * Execute a function with both circuit breaker protection and retry logic.
 * The circuit breaker wraps the retry loop — if the circuit is OPEN, no retries occur.
 */
export async function withResilience<T>(
  name: string,
  fn: () => Promise<T>,
  cbOpts?: CircuitBreakerOptions,
  retryOpts?: RetryOptions
): Promise<T> {
  const cb = getCircuitBreaker(name, cbOpts);
  return cb.execute(() => withRetry(fn, { ...retryOpts, name }));
}

// ─── Pre-configured Resilient Wrappers for NDSEP Services ────────────────────

/** Kafka producer with circuit breaker (5 failures → 30s cooldown) */
export const kafkaResilience = (fn: () => Promise<unknown>) =>
  withResilience("kafka", fn, { failureThreshold: 5, resetTimeoutMs: 30_000 }, { maxAttempts: 3, initialDelayMs: 200 });

/** OpenSearch with circuit breaker (3 failures → 15s cooldown) */
export const opensearchResilience = (fn: () => Promise<unknown>) =>
  withResilience("opensearch", fn, { failureThreshold: 3, resetTimeoutMs: 15_000 }, { maxAttempts: 2, initialDelayMs: 100 });

/** Temporal workflow with circuit breaker (3 failures → 60s cooldown) */
export const temporalResilience = (fn: () => Promise<unknown>) =>
  withResilience("temporal", fn, { failureThreshold: 3, resetTimeoutMs: 60_000 }, { maxAttempts: 2, initialDelayMs: 500 });

/** Keycloak with circuit breaker (5 failures → 30s cooldown) */
export const keycloakResilience = (fn: () => Promise<unknown>) =>
  withResilience("keycloak", fn, { failureThreshold: 5, resetTimeoutMs: 30_000 }, { maxAttempts: 3, initialDelayMs: 200 });

/** TigerBeetle with circuit breaker (3 failures → 30s cooldown) */
export const tigerbeetleResilience = (fn: () => Promise<unknown>) =>
  withResilience("tigerbeetle", fn, { failureThreshold: 3, resetTimeoutMs: 30_000 }, { maxAttempts: 2, initialDelayMs: 300 });

/** Dapr with circuit breaker (5 failures → 20s cooldown) */
export const daprResilience = (fn: () => Promise<unknown>) =>
  withResilience("dapr", fn, { failureThreshold: 5, resetTimeoutMs: 20_000 }, { maxAttempts: 3, initialDelayMs: 150 });

/** Fluvio with circuit breaker (5 failures → 20s cooldown) */
export const fluvioResilience = (fn: () => Promise<unknown>) =>
  withResilience("fluvio", fn, { failureThreshold: 5, resetTimeoutMs: 20_000 }, { maxAttempts: 3, initialDelayMs: 150 });

/** APISIX with circuit breaker (3 failures → 30s cooldown) */
export const apisixResilience = (fn: () => Promise<unknown>) =>
  withResilience("apisix", fn, { failureThreshold: 3, resetTimeoutMs: 30_000 }, { maxAttempts: 2, initialDelayMs: 200 });

/** Lakehouse with circuit breaker (3 failures → 60s cooldown) */
export const lakehouseResilience = (fn: () => Promise<unknown>) =>
  withResilience("lakehouse", fn, { failureThreshold: 3, resetTimeoutMs: 60_000 }, { maxAttempts: 2, initialDelayMs: 500 });

/** Permify with circuit breaker (5 failures → 20s cooldown) */
export const permifyResilience = (fn: () => Promise<unknown>) =>
  withResilience("permify", fn, { failureThreshold: 5, resetTimeoutMs: 20_000 }, { maxAttempts: 3, initialDelayMs: 100 });
