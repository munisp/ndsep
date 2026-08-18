# Follow-Up Task: Strict WASM Scoring Input Validation

## Priority and ownership

This is a **P1 correctness and transparency task** for the client-side NDSEP WASM module. It should be completed before any workflow treats a locally computed compliance score as an authoritative decision.

## Problem statement

`services/rust/wasm-modules/src/lib.rs` currently parses `controls_json` with:

```rust
serde_json::from_str(controls_json).unwrap_or_default()
```

Malformed JSON is therefore converted to an empty control list, and the scoring function returns the normal baseline value of `27.5`. A caller cannot distinguish a legitimate empty list from invalid input. This is a silent input-normalization behavior, not a numeric-type issue.

## Objective

Replace the scalar-only API with an explicit validation contract so malformed payloads cannot produce a normal-looking compliance score.

## Required implementation

| Work item | Acceptance requirement |
|---|---|
| Define a result contract | Add a serializable result structure, for example `ComplianceScoreResult { score: Option<f64>, valid: bool, error_code: Option<String> }`, or an equivalent WASM-compatible typed result. |
| Implement strict parsing | Parse `controls_json` with a `match`; on parse failure return `valid: false`, `score: None`, and a stable code such as `INVALID_CONTROLS_JSON`. Do not use `unwrap_or_default`. |
| Preserve valid behavior | A valid empty JSON array must continue to yield `27.5`; the full valid fixture must continue to yield `100.0`. |
| Define consumer migration | Update every JavaScript, React, React Native, and worker caller to require `valid == true` before displaying or persisting a score. Invalid results must be shown as unavailable rather than zero or baseline. |
| Add regression tests | Cover malformed JSON, valid empty array, full controls, non-array JSON, unknown controls, and WASM serialization/deserialization. |
| Add telemetry | Emit a non-sensitive counter/event for validation failure without recording the raw supplied payload. |

## Non-goals

This task does not redesign the score formula, alter score constants, substitute an AI model, or make the local score an authoritative server-side compliance decision.

## Definition of done

The task is complete only when invalid JSON cannot result in a score; all callers propagate invalid state explicitly; regression tests pass; and product documentation identifies the score as local/offline guidance rather than an authoritative compliance determination.
