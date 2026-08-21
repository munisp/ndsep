/**
 * Vitest global setup — mocks heavy external dependencies so unit tests
 * can import server/routers.ts without needing live connections.
 */
import { vi } from "vitest";

// Mock superjson to avoid ESM/CJS transform issues in vitest
vi.mock("superjson", () => ({
  default: {
    serialize: (v: unknown) => ({ json: v, meta: undefined }),
    deserialize: (v: { json: unknown }) => v.json,
    stringify: (v: unknown) => JSON.stringify(v),
    parse: (s: string) => JSON.parse(s),
  },
}));

// Mock kafkajs
vi.mock("kafkajs", () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    producer: vi.fn().mockReturnValue({
      connect: vi.fn(),
      send: vi.fn().mockResolvedValue({}),
      disconnect: vi.fn(),
    }),
    consumer: vi.fn().mockReturnValue({
      connect: vi.fn(),
      subscribe: vi.fn(),
      run: vi.fn(),
      disconnect: vi.fn(),
    }),
    admin: vi.fn().mockReturnValue({
      connect: vi.fn(),
      listTopics: vi.fn().mockResolvedValue([]),
      disconnect: vi.fn(),
    }),
  })),
  logLevel: { ERROR: 1, WARN: 2, INFO: 4, DEBUG: 5 },
  CompressionTypes: { None: 0, GZIP: 1 },
}));

// Mock ioredis — uses an in-memory store so session blacklist tests work correctly
// Exports both `default` and named `Redis` so tests can use either import style
vi.mock("ioredis", () => {
  const ttlStore = new Map<string, number>();
  const Redis = vi.fn().mockImplementation(() => {
    const store = new Map<string, string>();
    return {
      ping: vi.fn().mockResolvedValue("PONG"),
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: vi.fn().mockImplementation((key: string, value: string, ...args: unknown[]) => {
        store.set(key, value);
        // Handle EX option for TTL
        const exIdx = (args as string[]).findIndex((a) => a === "EX");
        if (exIdx !== -1 && args[exIdx + 1] !== undefined) {
          ttlStore.set(key, Number(args[exIdx + 1]));
        }
        return Promise.resolve("OK");
      }),
      del: vi.fn().mockImplementation((key: string) => {
        const existed = store.has(key);
        store.delete(key);
        ttlStore.delete(key);
        return Promise.resolve(existed ? 1 : 0);
      }),
      exists: vi.fn().mockImplementation((key: string) => Promise.resolve(store.has(key) ? 1 : 0)),
      expire: vi.fn().mockImplementation((key: string, seconds: number) => {
        ttlStore.set(key, seconds);
        return Promise.resolve(1);
      }),
      ttl: vi.fn().mockImplementation((key: string) => Promise.resolve(ttlStore.get(key) ?? -2)),
      quit: vi.fn().mockResolvedValue("OK"),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      status: "ready",
    };
  });
  return { default: Redis, Redis };
});

// Mock @temporalio/client
vi.mock("@temporalio/client", () => ({
  Client: vi.fn().mockImplementation(() => ({
    workflow: {
      start: vi.fn().mockResolvedValue({ workflowId: "mock-wf-id" }),
      describe: vi.fn().mockResolvedValue({ status: { name: "RUNNING" } }),
      list: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: async function*() {} }),
    },
  })),
  Connection: {
    connect: vi.fn().mockResolvedValue({}),
  },
}));

// Mock stripe
vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test" }),
        retrieve: vi.fn().mockResolvedValue({ payment_status: "paid" }),
      },
    },
    paymentIntents: {
      create: vi.fn().mockResolvedValue({ id: "pi_test", client_secret: "secret" }),
      retrieve: vi.fn().mockResolvedValue({ status: "succeeded" }),
    },
    webhooks: {
      constructEvent: vi.fn().mockReturnValue({ type: "payment_intent.succeeded", id: "evt_test" }),
    },
    customers: {
      create: vi.fn().mockResolvedValue({ id: "cus_test" }),
    },
  }));
  Stripe.prototype = {};
  return { default: Stripe };
});

// Mock nodemailer
vi.mock("nodemailer", () => ({
  createTransport: vi.fn().mockReturnValue({
    sendMail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
  }),
}));
