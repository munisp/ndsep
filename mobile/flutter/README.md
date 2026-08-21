# NDSEP Mobile — Flutter

Cross-platform mobile app (iOS + Android) for the National Data Sovereignty Enforcement Platform. Full feature parity with the React Native app and web PWA.

## Screens

| Screen | API Endpoint | Features |
|---|---|---|
| Dashboard | `dashboard.stats`, `leaderboard.list` | National Risk Score, KPI grid, leaderboard |
| Compliance | `compliance.violations` | Filter by severity, resolve violations |
| Enforcement | `enforcement.cases`, `financial.penalties` | Cases + penalties tabs |
| Security Alerts | `security.alerts` | Severity filter, mark resolved |
| Organizations | `organizations.list` | Search, compliance score |
| Organization Detail | `organizations.get` | Full org profile |
| Asset Registry | `assets.list` | Search by name/type/IP, border status |
| Citizen Rights | `citizenRights.list/create` | Submit requests, track status |
| Portal | `portal.myOrg` | Self-service compliance portal |
| Audit Log | `audit.list` | Immutable audit trail |
| Notifications | `notifications.list/markRead` | Mark read, type-coded |
| Penalty Detail | `financial.receipt/disputePenalty` | Receipt, file dispute |
| Login | OAuth redirect | NITDA SSO |

## Architecture

- **Flutter 3.19+** with Material 3 dark theme
- **Riverpod** for state management (FutureProvider for async data)
- **go_router** for declarative navigation with deep links
- **Dio** HTTP client with auth interceptor (Bearer token from secure storage)
- **flutter_secure_storage** for session token persistence
- **fl_chart** for data visualizations
- **firebase_messaging** for push notifications

## Setup

```bash
cd mobile/flutter

# Install dependencies
flutter pub get

# Set API URL (optional, defaults to https://ndsep.nitda.gov.ng)
# Pass via --dart-define at build time

# Run on connected device/emulator
flutter run --dart-define=NDSEP_API_URL=https://ndsep.nitda.gov.ng

# iOS
flutter run -d ios

# Android
flutter run -d android
```

## Build for Production

```bash
# Android APK
flutter build apk --dart-define=NDSEP_API_URL=https://ndsep.nitda.gov.ng

# Android App Bundle (Play Store)
flutter build appbundle --dart-define=NDSEP_API_URL=https://ndsep.nitda.gov.ng

# iOS IPA (requires Xcode + Apple Developer account)
flutter build ios --dart-define=NDSEP_API_URL=https://ndsep.nitda.gov.ng
```

## Deep Link (OAuth Callback)

Register `ndsep://auth/callback` as a custom URL scheme:

**Android** (`android/app/src/main/AndroidManifest.xml`):
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="ndsep" android:host="auth" android:pathPrefix="/callback" />
</intent-filter>
```

**iOS** (`ios/Runner/Info.plist`):
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>ndsep</string></array>
  </dict>
</array>
```

## Firebase Push Notifications

1. Create a Firebase project at console.firebase.google.com
2. Add Android app with package `ng.gov.nitda.ndsep`
3. Add iOS app with bundle ID `ng.gov.nitda.ndsep`
4. Download `google-services.json` → `android/app/`
5. Download `GoogleService-Info.plist` → `ios/Runner/`
6. Run `flutter pub get && flutter run`
