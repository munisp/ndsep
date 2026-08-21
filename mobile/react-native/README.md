# NDSEP Mobile — React Native

Full-featured mobile app for the National Data Sovereignty Enforcement Platform. Feature parity with the web PWA.

## Screens

| Screen | tRPC Endpoint | Features |
|---|---|---|
| Dashboard | `dashboard.stats`, `leaderboard.list` | National Risk Score, KPI grid, compliance leaderboard |
| Compliance | `compliance.violations`, `compliance.resolveViolation` | Filter by severity, resolve violations |
| Enforcement | `enforcement.cases`, `financial.penalties`, `financial.issuePenalty` | Cases list, issue penalty modal |
| Security Alerts | `security.alerts`, `security.resolveAlert` | Severity filter, mark resolved |
| Organizations | `organizations.list` | Search, compliance score, status |
| Organization Detail | `organizations.get`, `compliance.violations`, `financial.penalties`, `assets.list` | Full org profile |
| Asset Registry | `assets.list` | Search by name/type/IP, border status |
| Citizen Rights | `citizenRights.list`, `citizenRights.create` | Submit new requests, track status |
| Portal | `portal.myOrg` | Self-service compliance portal |
| Audit Log | `audit.list` | Immutable audit trail |
| Notifications | `notifications.list`, `notifications.markRead` | Mark read, type-coded |
| Penalty Detail | `financial.receipt`, `financial.disputePenalty` | Receipt view, file dispute |
| Login | OAuth redirect | Manus/NITDA SSO |

## Setup

```bash
cd mobile/react-native
npm install

# Set your API URL
echo "NDSEP_API_URL=https://ndsep.nitda.gov.ng" > .env

# iOS
npx pod-install ios
npx react-native run-ios

# Android
npx react-native run-android
```

## Build for Production

```bash
# Android APK
cd android && ./gradlew assembleRelease

# Android AAB (Play Store)
cd android && ./gradlew bundleRelease

# iOS Archive (requires Xcode)
npx react-native build-ios --configuration Release
```

## Deep Link (OAuth Callback)

Register `ndsep://auth/callback` in your app scheme:
- **Android**: `android/app/src/main/AndroidManifest.xml`
- **iOS**: `ios/ndsep/Info.plist`

## Architecture

- **tRPC client** — shares the same type-safe API contract as the web app
- **React Navigation** — drawer + bottom tabs + stack for full navigation
- **React Query** — caching, background refetch, optimistic updates
- **AsyncStorage** — session token persistence
- **React Native Keychain** — biometric authentication (optional)
- **Firebase Messaging** — push notifications for enforcement events
