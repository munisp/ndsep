import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("durable Kafka, Dapr, and Fluvio event-delivery source contract", () => {
  it("does not mark a PostgreSQL outbox row published when required Dapr delivery rejects", () => {
    const eventBus = read("server/eventBus.ts");
    const delivery = eventBus.slice(eventBus.indexOf("async function publishOutboxRow"));
    expect(delivery).toContain('if (!kafkaOk) throw new Error("Kafka publish failed")');
    expect(delivery).toContain("await daprPublish(row.topic");
    expect(delivery).toContain("await markPublished(row.id)");
    expect(delivery.indexOf("await daprPublish(row.topic")).toBeLessThan(delivery.indexOf("await markPublished(row.id)"));
    expect(delivery).not.toContain("Dapr side delivery failed");
  });

  it("does not actively launch the legacy non-durable Go event bus", () => {
    const workers = read("server/workerManager.ts");
    expect(workers).toContain("The legacy `event_bus` worker is intentionally not registered");
    expect(workers).not.toContain('id: "event-bus"');
    expect(workers).toContain("PostgreSQL transactional outbox owns event state");
  });

  it("requires an explicit Fluvio destination and does not advertise Kafka fallback", () => {
    const relay = read("workers/go/cmd/fluvio_relay/main.go");
    expect(relay).toContain("FLUVIO_ENDPOINT or FLUVIO_PRODUCE_URL is required");
    expect(relay).toContain("production Fluvio relay requires FLUVIO_PRODUCE_URL");
    expect(relay).toContain("FLUVIO_AUTH_TOKEN");
    expect(relay).not.toContain("KAFKA_FALLBACK");
    expect(relay).not.toContain("kafka_fallback");
  });
});
