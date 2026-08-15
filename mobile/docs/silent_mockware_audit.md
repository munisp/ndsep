# IDLR-PTS Silent-Mockware Audit

## Scope and conclusion

This audit examined the most dangerous class of misleading behavior: a system returning a plausible result that an operator could reasonably mistake for **verified, live, or production-backed output** when the underlying model, parser, verification key, device capability, or registry authority was unavailable.

The confirmed high-risk paths have been changed so that the platform now reports **source, provenance, availability, and review requirements** rather than silently upgrading fallback behavior into a credible-looking result. The system should not be described as having eliminated all possible defects; this is a focused hardening pass over the confirmed high-risk implementation paths.

## Confirmed findings and remediation

| Risk area | Previous behavior | Corrected behavior | Operator-visible outcome |
|---|---|---|---|
| **Notification AI** | Model failures returned a deterministic rank while the inbox presented it as ordinary AI insight. Seed data also contained plausible AI summaries and scores. | Analysis now carries `provenance`, `availability`, and `reason`. Seeded AI insights were removed. Rule-based output is explicitly labeled as model-unavailable. | A rank is shown as **model-assisted** or **rule-based; model unavailable**. |
| **Permit document extraction** | Failed model calls returned label-pattern extraction with a made-up confidence score of 52 and fields sourced as `ai`. PDF parsing failures converted binary bytes into apparent text. | Heuristic values now use source `heuristic`, confidence is `null`, and the result status requires review. PDF parser failures return unavailable/no text rather than binary-as-text. | Extracted fields are never represented as verified. A reviewer must confirm every value. |
| **Image document screening** | Engine names such as PaddleOCR or Docling could be inferred from file hints although the actual implementation used an LLM vision request. | The engine is identified as `vision_llm`, and model screening is always `requires_review`. | The screen states that automated screening cannot verify identity, registry authority, or authenticity. |
| **Liveness** | A single selfie was sent with `framesAnalyzed: 5` and could be marked verified from estimated scores. | Single-image screening sends one frame, always returns `requires_review`, and records `single_image_screening`. The repository rejects `verified` unless a `challenge_video` verification method is supplied. | The UI states clearly that this build cannot verify a blink-turn-smile challenge. |
| **Inbox KYC action** | An inbox action set a document to `verified`, raised confidence, and used approval language without independent identity validation. | The action now routes the document to `requires_review` with explicit `manual_review` provenance. | Users see **Request KYC review**, not an unsupported approval claim. |
| **Legal registration reference** | A registration number could be synthetically generated when a workflow was marked registered. | Registration now requires a supplied official registry reference unless the workflow already has one. | A workflow cannot gain a credible-looking registration number from local code alone. |
| **Audit signatures** | An unconfigured deployment generated an in-memory RSA key pair, which made a same-process verification look valid. A seeded revoked key was also exposed as registry data. | Audit signing now requires configured private key, public key, and key ID. Otherwise exports are explicitly unsigned and verification returns unavailable/false. | A verification page says **Verification unavailable** instead of showing a transient key as public trust material. |
| **Parcel geofencing** | A saved server preference was labeled “Geofence active,” while registration failures and replay errors were discarded. | Device registration returns an explicit runtime result: active, configured-only, permission-denied, unsupported, or failed. The parcel screen separates preference state from device monitoring. | “Preference saved” is not confused with active background monitoring. |

## Validation evidence

The hardening changes were validated against the current repository with a clean compile and the complete automated suite.

| Validation command | Result |
|---|---|
| `pnpm run check` | Passing TypeScript compilation |
| `pnpm test` | **48 tests passed, 1 skipped** |
| New high-risk regression coverage | Unsigned audit fail-closed behavior, tampered audit rejection, non-verifiable single-image liveness, manual KYC review routing, official registration-reference requirement, heuristic extraction provenance, and removal of seeded pseudo-AI insights |

## Important remaining limitations

The following limitations are still real and should remain visible in any procurement, pilot, or production-readiness claim.

| Limitation | Why it matters |
|---|---|
| **No production liveness provider** | The current application does not implement a certified video challenge, passive anti-spoof model, biometric-template comparison, or hardware-attested capture. It intentionally does not verify liveness from one still image. |
| **No external KYC/KYB authority check** | NIN, BVN, CAC, TIN, and document authenticity are not independently verified against authoritative services in this portable runtime. |
| **No deployed Docling/PaddleOCR pipeline** | The system no longer mislabels an LLM vision request as those engines, but a genuine document-intelligence service still needs deployment. |
| **Audit key lifecycle is configuration-dependent** | The code fails closed without keys. A real deployment still needs HSM/KMS custody, rotation policy, access controls, archival, and independent trust distribution. |
| **Device geofencing remains platform-dependent** | Registration now reports truthfully, but physical-device testing is needed for permission behavior, iOS region limits, Android vendor restrictions, and background lifecycle conditions. |
| **Approval endpoints need enterprise authorization** | Explicit status labels reduce misleading output, but production workflows still need identity federation, authorization enforcement, and delegated signing controls. |
| **Seed data remains seed data** | The application exposes a seed/offline-cache source state. Seeded parcels, cases, and boundaries must not be represented as official registry or cadastral data. |

## Corrected platform claim

> **IDLR-PTS now distinguishes model-assisted, rule-based, unavailable, manually reviewed, configured, and actively registered states across the audited high-risk paths. It remains a pilot-grade platform and is not yet an independently verified national registry, biometric KYC provider, or production public-key infrastructure.**

## Relevant implementation evidence

The remediation is implemented in `server/mobilePlatformRepository.ts`, `server/permittingPlatformRepository.ts`, `server/routers.ts`, `lib/mobile-geofencing.ts`, `lib/mobile-sync.ts`, `lib/mobile-activity.ts`, and the associated permit, onboarding, notifications, geofence, and audit-verification screens. Regression tests were expanded in `tests/mobile-platform-repository.test.ts`, `tests/permitting-platform-repository.test.ts`, and `tests/mobile-activity.test.ts`.
