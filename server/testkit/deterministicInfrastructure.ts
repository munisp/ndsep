export const SIMULATED_INFRASTRUCTURE = [
  "keycloak",
  "permify",
  "temporal",
  "tigerbeetle",
  "kafka",
  "dapr",
  "fluvio",
  "opensearch",
  "redis",
  "lakehouse",
  "apisix",
] as const;

export type SimulatedInfrastructure = (typeof SIMULATED_INFRASTRUCTURE)[number];

export interface SimulatedOperation {
  dependency: SimulatedInfrastructure;
  operation: string;
  journeyId: string;
  detail: string;
}

export interface JourneyContract {
  id: `J${string}`;
  name: string;
  dependencies: readonly SimulatedInfrastructure[];
}

/**
 * DeterministicInfrastructure is an explicit acceptance-test double. It is not
 * imported by production modules. Each operation is recorded and every
 * dependency defaults to available only within this test harness; an unavailable
 * dependency rejects rather than manufacturing a plausible result.
 */
export class DeterministicInfrastructure {
  readonly operations: SimulatedOperation[] = [];
  private readonly availability = new Map<SimulatedInfrastructure, boolean>(
    SIMULATED_INFRASTRUCTURE.map((dependency) => [dependency, true]),
  );

  setAvailable(dependency: SimulatedInfrastructure, available: boolean): void {
    this.availability.set(dependency, available);
  }

  reset(): void {
    this.operations.splice(0, this.operations.length);
    for (const dependency of SIMULATED_INFRASTRUCTURE) {
      this.availability.set(dependency, true);
    }
  }

  executeJourney(contract: JourneyContract): readonly SimulatedOperation[] {
    const start = this.operations.length;
    for (const dependency of contract.dependencies) {
      this.executeDependency(dependency, contract);
    }
    return this.operations.slice(start);
  }

  private executeDependency(dependency: SimulatedInfrastructure, contract: JourneyContract): void {
    if (!this.availability.get(dependency)) {
      throw new Error(`SIMULATED_DEPENDENCY_UNAVAILABLE:${dependency}:${contract.id}`);
    }
    this.operations.push({
      dependency,
      operation: deterministicOperation(dependency),
      journeyId: contract.id,
      detail: `${contract.id}:${contract.name}:${dependency}`,
    });
  }
}

function deterministicOperation(dependency: SimulatedInfrastructure): string {
  const operations: Record<SimulatedInfrastructure, string> = {
    keycloak: "issue-and-validate-role-token",
    permify: "authorize-resource-action",
    temporal: "start-durable-workflow",
    tigerbeetle: "post-balanced-ledger-transfer",
    kafka: "publish-durable-event",
    dapr: "invoke-or-publish-service-command",
    fluvio: "append-edge-telemetry",
    opensearch: "index-and-query-search-document",
    redis: "set-or-invalidate-cache-entry",
    lakehouse: "append-immutable-analytic-record",
    apisix: "enforce-gateway-route-policy",
  };
  return operations[dependency];
}

export function expectExactDependencySet(
  operations: readonly SimulatedOperation[],
  dependencies: readonly SimulatedInfrastructure[],
): void {
  const actual = operations.map((operation) => operation.dependency).sort();
  const expected = [...dependencies].sort();
  if (actual.length !== expected.length || actual.some((dependency, index) => dependency !== expected[index])) {
    throw new Error(`Unexpected simulated dependency set: expected ${expected.join(",")}; received ${actual.join(",")}`);
  }
}
