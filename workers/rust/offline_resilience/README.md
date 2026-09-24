# offline_resilience — NDSEP Offline Resilience Worker

Rust worker for offline data synchronization and bandwidth optimization in
low-connectivity ("African deployment") scenarios:

- connection-quality monitoring with adaptive behavior
- message compression for low-bandwidth links
- request deduplication and batching
- store-and-forward with a priority queue

## Status

**Experimental / unwired.** This crate is a member of the `workers/rust`
cargo workspace and compiles with it, but it is **not** deployed anywhere:

- no service entry in `docker-compose*.yml`
- no Kubernetes manifest under `infra/k8s/` or `k8s/`
- no caller in the TS server or other workers

The production offline-sync path is currently served by
`workers/python/offline_sync_worker.py` (compose service `offline-sync-worker`
in `docker-compose-workers-addition.yml`) together with the
`fieldInspection.syncBatch` API (`server/routers/fieldInspection.ts`). This
Rust crate is the planned high-performance replacement; wire it before
relying on it.

Run locally:

```sh
cargo run -p offline_resilience
```
