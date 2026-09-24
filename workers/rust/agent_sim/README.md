# agent_sim — NDSEP Agent-Based Modeling Engine

Each organization is modeled as an autonomous agent (budget, staff, tech
maturity, risk appetite, sector, jurisdiction). Agents interact: they compete
for compliance budget, share threat intel, and respond to peer pressure and
policy changes. Serves simulation requests over HTTP (axum, port 8178); this
is the "abm-engine" referred to by `server/k8sReadiness.ts`.

## Status

**Experimental / unwired.** This crate is a member of the `workers/rust`
cargo workspace and compiles with it, but it is **not** deployed anywhere:

- no service entry in `docker-compose*.yml`
- no Kubernetes manifest under `infra/k8s/` or `k8s/`
- no caller in the TS server or other workers

Keep it in the workspace: the simulation model complements `monte_carlo` and
`system_dynamics` and is referenced by the readiness audit. Do not rely on it
in production paths until it is wired behind a compose/k8s service.

Run locally:

```sh
cargo run -p agent_sim
# GET  /health
# POST /simulate  (ABMRequest: agents, duration_months, breach_sla_hours, ...)
```
