# Docker Bridge Networking Blocker Post-Mortem

**Author:** Manus AI
**Date:** 2026-08-18
**Status:** Open environment blocker; application remediation complete

## Executive summary

The real FalkorDB deployment round trip could not run in the current sandbox because the host kernel does not expose the iptables **raw** table required by this Docker Engine bridge-network path. Docker successfully pulled the real FalkorDB `v4.20.3` image and began building the NDSEP graph-worker image, but failed when it attempted to create a container bridge endpoint. The terminal error was:

> `iptables ... -t raw ... PREROUTING ... can't initialize iptables table 'raw': Table does not exist`

This is a host-kernel and container-runtime capability failure, not an NDSEP service failure. No application container reached startup, so the real FalkorDB neighbor/path round trip, persistence restart, outage, and recovery assertions remain unexecuted in this sandbox.

Docker documents that bridge networking depends on firewall rules, including a raw-table `PREROUTING` rule used to protect direct routed access to containers.[1] Docker also advises against disabling its firewall management because that can break bridge networking.[2]

## Timeline and evidence

| Time / sequence | Observation | Interpretation |
|---|---|---|
| First live run | User-level Docker socket access was denied. | The invoking account lacked access to `/var/run/docker.sock`; this was not an application result. |
| System-daemon retry | The initial fixture image tag, `falkordb/falkordb-server:4.12.0`, did not exist. | Fixture configuration defect; corrected to the published immutable tag `v4.20.3`. |
| Corrected retry | FalkorDB image pull completed and the graph-worker image build began. | Registry/image resolution and Docker daemon access were functioning. |
| Container build network setup | Docker failed creating a bridge endpoint because `iptables -t raw` could not initialize the raw table. | Host kernel/netfilter capability is absent or unavailable to the sandbox. |
| Mock round trip | The integration runner completed all expected branches against a deterministic mock Compose interface. | Runner shell control flow, log formatting, cleanup, password handling, and expected HTTP-status assertions are validated; graph-server behavior is not. |

## Root cause

The sandbox Docker daemon uses the Linux bridge-network implementation. During a container build/run, Docker tried to append a direct-access filtering rule to the raw table `PREROUTING` chain. The kernel rejected the operation because the table does not exist in this environment.

The immediate missing capability is normally provided by the host netfilter raw-table support, for example the `iptable_raw` kernel module or equivalent kernel configuration. This environment cannot load or expose that table. Docker bridge networking therefore cannot create required endpoints. Docker's own documentation states that its bridge networks create host firewall rules and that the raw `PREROUTING` rule is used for direct-routing protection.[1]

## Impact

The following application validation remains blocked only on this host:

| Test assertion | Current status | Why |
|---|---|---|
| Real graph-worker health against FalkorDB | Not executed | Containers cannot create bridge endpoints. |
| Real parameterized neighbor query | Not executed | Same blocker. |
| Real bounded shortest-path query | Not executed | Same blocker. |
| AOF persistence after FalkorDB restart | Not executed | Same blocker. |
| Real server outage returns graph-worker `503` | Not executed | Same blocker. |
| Recovery after FalkorDB restart | Not executed | Same blocker. |

The code-level FalkorDB query tests, refused-endpoint failure test, mock runner dry run, TypeScript suite, Go modules, Python compilation, Rust workspaces, and fresh PostgreSQL migration tests are independently covered. They do not substitute for a real networked graph server.

## Non-remediations

The following are not acceptable substitutes for a CI graph round trip:

| Proposal | Why it is rejected |
|---|---|
| Set Docker `iptables=false` | Docker warns this is likely to break bridge networking and remove required isolation/NAT behavior.[2] |
| Change the test fixture to host networking | It bypasses the isolated service-network assumptions the test must verify. |
| Re-enable the retired in-memory graph worker | It would make graph-like results appear durable without a real graph server. |
| Mark the real round trip as passed from a mock run | The mock validates runner control flow, not FalkorDB protocol, persistence, authentication, or live query behavior. |

## Required CI/CD execution environment

Use a Linux VM or privileged runner where Docker Engine can create and operate bridge networks. Nested unprivileged containers are unsuitable unless the executor explicitly supplies the required netfilter capabilities.

| Requirement | Acceptance check | Rationale |
|---|---|---|
| Docker daemon access | `docker info` succeeds for the CI user. | The runner must build and run the graph-worker fixture. |
| Docker Compose v2 and Buildx | `docker compose version` and `docker buildx version` succeed. | The manifest uses Compose and builds a multi-stage worker image. |
| Bridge network support | `docker network create ndsep-preflight` then `docker run --rm --network ndsep-preflight alpine:3.20 true` succeeds. | Detects endpoint creation failure before application work. |
| Raw-table support | `iptables -t raw -S PREROUTING` succeeds; on modular hosts, `modprobe iptable_raw` is available to the runner image/host bootstrap. | Matches the exact observed missing capability. |
| IP forwarding | `sysctl net.ipv4.ip_forward` reports `1`. | Docker bridge networking requires host IP forwarding.[1] |
| Firewall compatibility | Docker-managed iptables/nftables rules are permitted; do not set `iptables=false`. | Bridge isolation, port publishing, and NAT depend on Docker firewall rules.[2] |
| Secret injection | CI injects a one-run `FALKORDB_PASSWORD` through secret storage, never source control. | The runner uses the password for server authentication. |
| Cleanup capability | `docker compose down -v --remove-orphans` succeeds. | Removes graph data volume and test containers even on assertion failure. |

## CI/CD preflight gate

Run this preflight before the real FalkorDB job. It must fail the job with a runner-infrastructure classification rather than reporting an application test failure.

```bash
set -euo pipefail

docker info >/dev/null
docker compose version >/dev/null
docker buildx version >/dev/null
sudo modprobe iptable_raw 2>/dev/null || true
iptables -t raw -S PREROUTING >/dev/null
[ "$(sysctl -n net.ipv4.ip_forward)" = "1" ]

docker network create ndsep-falkor-preflight
trap 'docker network rm ndsep-falkor-preflight >/dev/null 2>&1 || true' EXIT
docker run --rm --network ndsep-falkor-preflight alpine:3.20 true
```

When preflight passes, the integration job must generate an ephemeral password and execute:

```bash
export FALKORDB_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"
./scripts/integration/run-falkordb-roundtrip.sh
```

Persist the Compose logs and runner log as CI artifacts. The job must fail on any health, query, injection, relation/depth-bound, persistence, outage, or recovery assertion. The cleanup trap in the runner removes its named volume only after collecting the required logs.

## Preventive actions

The CI pipeline should split this work into two statuses: **static/contract validation** and **live graph integration**. The static job can run in ordinary shared runners. The live graph job must target a labeled runner, such as `self-hosted`, `linux`, `docker-bridge`, whose preflight is verified periodically. A failed preflight should be treated as an infrastructure incident, not a product regression.

### References

[1]: https://docs.docker.com/engine/network/firewall-iptables/ "Docker with iptables"

[2]: https://docs.docker.com/engine/network/packet-filtering-firewalls/ "Docker packet filtering and firewalls"
