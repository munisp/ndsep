# wasm_edge — NDSEP WASM Edge Processing Module

WebAssembly library (`wasm-bindgen`) for edge execution of lightweight
security analytics:

- statistical anomaly detection (rolling Z-score)
- threat scoring
- PII detection
- protocol classification

Intended targets: browser (client-side preliminary analysis), IoT gateways
(edge traffic analysis), and edge CDN nodes (geo-distributed processing).

## Status

**Experimental / unwired.** This crate is a member of the `workers/rust`
cargo workspace and compiles with it, but it is **not** deployed anywhere:

- no `wasm-pack`/`wasm-bindgen` build step in CI or packaging scripts
- no npm/browser bundle consumes the generated WASM module
- no service entry in `docker-compose*.yml` or k8s manifests

Keep it in the workspace as the foundation for future edge/browser analytics.
Build for the web target locally with:

```sh
wasm-pack build --target web workers/rust/wasm_edge
```
