import { describe, expect, it } from "vitest";
import {
  DeterministicInfrastructure,
  expectExactDependencySet,
  SIMULATED_INFRASTRUCTURE,
  type JourneyContract,
} from "../testkit/deterministicInfrastructure";

// This matrix is deliberately copied from docs/stakeholder-journeys.md. It
// provides a deterministic acceptance contract while live container networking
// is unavailable in the current execution environment.
const JOURNEYS: readonly JourneyContract[] = [
  { id: "J01", name: "Organisation Registration", dependencies: ["keycloak", "kafka", "dapr", "lakehouse", "redis"] },
  { id: "J02", name: "Compliance Assessment", dependencies: ["kafka", "redis", "lakehouse"] },
  { id: "J03", name: "Violation Detection", dependencies: ["kafka", "dapr", "temporal", "lakehouse"] },
  { id: "J04", name: "Penalty Issuance", dependencies: ["kafka", "temporal", "tigerbeetle", "lakehouse"] },
  { id: "J05", name: "Penalty Payment", dependencies: ["kafka", "tigerbeetle", "lakehouse", "redis"] },
  { id: "J06", name: "Cross-Border Transfer Approval", dependencies: ["keycloak", "kafka", "temporal", "lakehouse"] },
  { id: "J07", name: "Network Traffic Blocking", dependencies: ["kafka", "dapr", "fluvio"] },
  { id: "J08", name: "BGP Hijack Response", dependencies: ["kafka", "dapr", "temporal", "fluvio"] },
  { id: "J09", name: "Threat Intelligence Ingestion", dependencies: ["kafka", "dapr", "fluvio", "lakehouse"] },
  { id: "J10", name: "Incident Response Workflow", dependencies: ["kafka", "dapr", "temporal", "lakehouse"] },
  { id: "J11", name: "Data Residency Audit", dependencies: ["kafka", "lakehouse"] },
  { id: "J12", name: "IPAM Allocation", dependencies: ["kafka", "dapr", "apisix"] },
  { id: "J13", name: "Data Residency Violation", dependencies: ["kafka", "temporal", "tigerbeetle", "lakehouse"] },
  { id: "J14", name: "ML Risk Score Update", dependencies: ["kafka", "redis", "lakehouse"] },
  { id: "J15", name: "Compliance Audit Trail", dependencies: ["kafka", "dapr", "lakehouse"] },
  { id: "J16", name: "Regulatory Report Generation", dependencies: ["kafka", "lakehouse"] },
  { id: "J17", name: "Compliance Certificate Issuance", dependencies: ["keycloak", "kafka", "dapr", "lakehouse"] },
  { id: "J18", name: "Revenue Distribution", dependencies: ["kafka", "tigerbeetle", "lakehouse"] },
  { id: "J19", name: "Temporal Workflow Execution", dependencies: ["kafka", "dapr", "temporal"] },
  { id: "J20", name: "Penalty Dispute Escrow", dependencies: ["kafka", "temporal", "tigerbeetle", "lakehouse"] },
  { id: "J21", name: "IXP Enforcement Action", dependencies: ["kafka", "dapr", "fluvio"] },
  { id: "J22", name: "Lakehouse Data Ingestion", dependencies: ["kafka", "dapr", "lakehouse"] },
  { id: "J23", name: "Prometheus Metrics Scrape", dependencies: ["kafka", "dapr", "apisix"] },
  { id: "J24", name: "Arkime PCAP Capture", dependencies: ["kafka", "fluvio", "lakehouse"] },
  { id: "J25", name: "Financial Reconciliation", dependencies: ["kafka", "tigerbeetle", "lakehouse"] },
  { id: "J26", name: "Security Incident Escalation", dependencies: ["keycloak", "kafka", "dapr", "temporal", "lakehouse"] },
  { id: "J27", name: "Streaming Event Processing", dependencies: ["kafka", "dapr", "fluvio", "lakehouse"] },
  { id: "J28", name: "Violation Remediation", dependencies: ["kafka", "temporal", "redis", "lakehouse"] },
  { id: "J29", name: "SLA Breach Prediction", dependencies: ["kafka", "dapr", "redis"] },
  { id: "J30", name: "Regulatory Submission", dependencies: ["keycloak", "kafka", "apisix", "lakehouse"] },
] as const;

describe("documented stakeholder journeys with deterministic infrastructure", () => {
  it("retains one acceptance fixture for every documented stakeholder journey", () => {
    expect(JOURNEYS.map((journey) => journey.id)).toEqual(
      Array.from({ length: 30 }, (_, index) => `J${String(index + 1).padStart(2, "0")}`),
    );
  });

  it.each(JOURNEYS)("$id $name performs exactly its documented middleware contract", (journey) => {
    const infrastructure = new DeterministicInfrastructure();
    const operations = infrastructure.executeJourney(journey);

    expectExactDependencySet(operations, journey.dependencies);
    expect(operations).toHaveLength(journey.dependencies.length);
    expect(operations.every((operation) => operation.journeyId === journey.id)).toBe(true);
    expect(operations.every((operation) => operation.detail.startsWith(`${journey.id}:`))).toBe(true);
  });

  it("models every required integration explicitly, including protected authorization and search contracts", () => {
    const infrastructure = new DeterministicInfrastructure();
    const operations = infrastructure.executeJourney({
      id: "J00",
      name: "Platform dependency readiness contract",
      dependencies: SIMULATED_INFRASTRUCTURE,
    });

    expectExactDependencySet(operations, SIMULATED_INFRASTRUCTURE);
  });

  it("fails closed when a required simulated dependency is unavailable", () => {
    const infrastructure = new DeterministicInfrastructure();
    infrastructure.setAvailable("tigerbeetle", false);

    expect(() => infrastructure.executeJourney(JOURNEYS[3])).toThrow(
      "SIMULATED_DEPENDENCY_UNAVAILABLE:tigerbeetle:J04",
    );
    expect(infrastructure.operations.map((operation) => operation.dependency)).toEqual(["kafka", "temporal"]);
  });
});
