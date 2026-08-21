# NDSEP Flutter — Test Suite

## Structure

```
test/
├── README.md                          ← This file
├── integration/
│   └── api_integration_test.dart      ← Live API integration tests (10 flows, 40+ assertions)
└── unit/
    ├── api_service_unit_test.dart     ← URL construction, encoding, response parsing
    └── screen_widget_test.dart        ← Widget rendering tests for 5 key screens
```

## Running Tests

### Unit Tests (no network required)

```bash
cd mobile/flutter
flutter test test/unit/
```

### Integration Tests (requires running NDSEP backend)

Against the local dev server:

```bash
cd mobile/flutter
flutter test test/integration/ \
  --dart-define=NDSEP_API_URL=http://localhost:3000
```

Against the production server:

```bash
cd mobile/flutter
flutter test test/integration/ \
  --dart-define=NDSEP_API_URL=https://ndsep.nitda.gov.ng
```

### All Tests

```bash
cd mobile/flutter
flutter test
```

## Test Coverage

### Integration Tests (api_integration_test.dart)

| Flow | Description | Assertions |
|------|-------------|------------|
| 1 | Server reachability + auth.me | 2 |
| 2 | Public read procedures (10 procedures) | 10 |
| 3 | Auth enforcement on 9 protected procedures | 9 |
| 4 | Mutation auth enforcement (3 mutations) | 3 |
| 5 | CORS headers present | 2 |
| 6 | Rate limiting (10 consecutive calls) | 10 |
| 7 | API versioning headers | 2 |
| 8 | Monitoring and workers procedures | 2 |
| 9 | Compliance procedures | 3 |
| 10 | Portal procedures | 2 |

### Unit Tests (api_service_unit_test.dart)

- tRPC input encoding (null, map, nested map, list)
- tRPC response parsing (success, error, list, null)
- URL construction (query, mutation, nested procedure)
- Procedure name registry (17 procedure groups)
- Security header validation

### Widget Tests (screen_widget_test.dart)

- MockDashboardScreen (2 tests)
- MockKycListScreen (4 tests)
- MockPenaltyScreen (3 tests)
- MockComplianceLeaderboardScreen (3 tests)
- MockRemediationScreen (3 tests)

## Notes

- Integration tests use the `http` package directly (not `ApiService`) to avoid
  Flutter widget binding requirements in headless CI environments.
- All integration tests are designed to pass whether the backend is authenticated
  or not — protected procedures return `null` when unauthenticated, which is the
  expected behaviour.
- The `NDSEP_API_URL` dart-define defaults to `http://localhost:3000` if not set.
