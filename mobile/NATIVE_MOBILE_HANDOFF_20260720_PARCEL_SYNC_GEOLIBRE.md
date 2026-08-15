# Native Mobile Enhancement Handoff — 2026-07-20 (Parcel, GeoLibre, Sync Reliability)

## Summary

The native mobile application was extended with a **dedicated parcel detail screen**, a **dedicated GeoLibre launch screen with parcel export controls**, and **push-notification plus background sync replay support** for field updates. The app now gives operators a clearer mobile path from parcel review into field work, geospatial review, legal progression, and export-ready GeoLibre handoff while improving offline reliability.

## Implemented Enhancements

| Area | Status | What changed |
|---|---:|---|
| Parcel detail experience | Complete | Added a dedicated parcel detail route that consolidates parcel metadata, mission continuity, legal workflow status, and direct navigation into field, geo, legal, and GeoLibre tasks. |
| GeoLibre mobile launch | Complete | Added a dedicated GeoLibre launch screen with parcel-specific GeoJSON preview, export bundle sharing, launch-manifest sharing, and return paths back into parcel and geospatial workflows. |
| Parcel-to-task deep links | Complete | Updated parcel and geospatial screens so operators can open parcel detail and GeoLibre launch paths directly from active parcel cards. |
| Push notifications | Complete at repository level | Added notification permission handling, Android notification channel setup, and local notification scheduling for synchronized and queued field updates. |
| Offline sync replay | Complete at repository level | Added a persistent offline mutation queue, replay helper, and background task registration so queued mission status updates can be retried automatically. |
| Bundle startup registration | Complete | Imported notification and background-sync modules at root layout startup so handlers and background tasks are defined at bundle load time. |

## Key Files Added or Updated

| File | Purpose |
|---|---|
| `app/parcel/[id].tsx` | Dedicated parcel detail screen with deep links into downstream workflows. |
| `app/geolibre-launch.tsx` | Dedicated GeoLibre launch and export screen. |
| `app/(tabs)/parcels.tsx` | Parcel cards now link into parcel detail and GeoLibre launch flows. |
| `app/(tabs)/geo.tsx` | Geospatial cards now link into parcel detail and GeoLibre launch flows. |
| `lib/mobile-notifications.ts` | Notification permissions, channel registration, and field-update alert scheduling. |
| `lib/mobile-sync-replay.ts` | Persistent offline queue and replay logic for field mutations. |
| `lib/background-sync.ts` | Global Expo background task definition and registration for sync replay. |
| `lib/mobile-sync.ts` | Hook now registers notification/background services, replays queued updates, and falls back to offline queueing when live mission sync fails. |
| `app/_layout.tsx` | Root import registration for notification and background sync modules. |
| `app.config.ts` | Added background-task and notifications native configuration. |
| `tests/mobile-sync-replay.test.ts` | Focused test coverage for queueing and replay behavior. |

## Validation Evidence

| Check | Result |
|---|---:|
| TypeScript validation | Passed |
| Mobile seed data tests | Passed |
| Mobile repository tests | Passed |
| Mobile sync replay tests | Passed |
| Total focused tests | 9 / 9 passed |
| Runtime health | TypeScript clean, dependencies OK, dev server running |

## Remaining Boundary Gaps

| Gap | Boundary |
|---|---|
| True remote push delivery to device tokens | Requires physical-device push credentials and release-grade notification setup |
| Reliable background replay behavior verification | Requires physical iOS/Android device validation because Expo background execution is platform-constrained in development |
| Notifications and recent activity screen | Still open in the mobile backlog |

## Next Practical Step

The most natural next tranche is a **notifications and recent activity screen** so operators can review queued, replayed, and synchronized mission events in one place while also preparing the app for physical-device validation.
