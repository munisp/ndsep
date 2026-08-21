/// NDSEP Flutter — Integration Test Suite
/// Tests the ApiService against the live NDSEP tRPC backend.
///
/// Run with:
///   flutter test test/integration/api_integration_test.dart \
///     --dart-define=NDSEP_API_URL=http://localhost:3000
///
/// Or against production:
///   flutter test test/integration/api_integration_test.dart \
///     --dart-define=NDSEP_API_URL=https://ndsep.nitda.gov.ng
library;

import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

/// Lightweight test client that mirrors ApiService without requiring
/// Flutter widget binding — safe to run in headless CI environments.
class TestApiClient {
  final String baseUrl;
  String? sessionCookie;

  TestApiClient({required this.baseUrl});

  Future<dynamic> query(String procedure, [Map<String, dynamic>? input]) async {
    final inputParam = Uri.encodeComponent(
      jsonEncode({'0': if (input != null) {'json': input} else {'json': null}}),
    );
    final uri = Uri.parse(
      '$baseUrl/api/trpc/$procedure?batch=1&input=$inputParam',
    );
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (sessionCookie != null) headers['Cookie'] = sessionCookie!;

    final response = await http.get(uri, headers: headers);
    expect(response.statusCode, anyOf(200, 401),
        reason: 'Procedure $procedure returned unexpected status');

    final body = jsonDecode(response.body) as List;
    final item = body.first as Map<String, dynamic>;
    if (response.statusCode == 401 || item.containsKey('error')) {
      return null; // unauthenticated — expected for protected procedures
    }
    return item['result']?['data']?['json'];
  }

  Future<dynamic> mutate(String procedure, Map<String, dynamic> input) async {
    final uri = Uri.parse('$baseUrl/api/trpc/$procedure?batch=1');
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (sessionCookie != null) headers['Cookie'] = sessionCookie!;

    final response = await http.post(
      uri,
      headers: headers,
      body: jsonEncode({'0': {'json': input}}),
    );
    expect(response.statusCode, anyOf(200, 401),
        reason: 'Mutation $procedure returned unexpected status');

    final body = jsonDecode(response.body) as List;
    final item = body.first as Map<String, dynamic>;
    if (response.statusCode == 401 || item.containsKey('error')) {
      return null;
    }
    return item['result']?['data']?['json'];
  }
}

void main() {
  late TestApiClient client;
  const apiUrl = String.fromEnvironment(
    'NDSEP_API_URL',
    defaultValue: 'http://localhost:3000',
  );

  setUpAll(() {
    client = TestApiClient(baseUrl: apiUrl);
  });

  // ─── Flow 1: Public health check ─────────────────────────────────────────────
  group('Flow 1 — Server reachability', () {
    test('GET /api/health returns 200', () async {
      final response = await http.get(Uri.parse('$apiUrl/api/health'));
      expect(response.statusCode, 200,
          reason: 'Server at $apiUrl must be reachable');
    });

    test('auth.me returns null or user object (not 500)', () async {
      final result = await client.query('auth.me');
      // null = unauthenticated (expected), Map = authenticated user
      expect(result, anyOf(isNull, isA<Map>()));
    });
  });

  // ─── Flow 2: Public read procedures ──────────────────────────────────────────
  group('Flow 2 — Public read procedures', () {
    test('dashboard.stats returns a map', () async {
      final result = await client.query('dashboard.stats');
      // Returns null if protected; if public it returns a Map
      expect(result, anyOf(isNull, isA<Map>()));
    });

    test('organizations.list returns null (protected) or list', () async {
      final result = await client.query('organizations.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('banking.kyc.list returns null (protected) or list', () async {
      final result = await client.query('banking.kyc.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('banking.aml.list returns null (protected) or list', () async {
      final result = await client.query('banking.aml.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('siem.alerts returns null (protected) or list', () async {
      final result = await client.query('siem.alerts', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('auditLogs.list returns null (protected) or list', () async {
      final result = await client.query('auditLogs.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('enforcementCases.list returns null (protected) or list', () async {
      final result = await client.query('enforcementCases.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('financial.penalties returns null (protected) or list', () async {
      final result = await client.query('financial.penalties', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('complianceCalendar.upcomingDeadlines returns null (protected) or list', () async {
      final result = await client.query('complianceCalendar.upcomingDeadlines', {'days': 30});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('portal.myOrg returns null (protected) or map', () async {
      final result = await client.query('portal.myOrg');
      expect(result, anyOf(isNull, isA<Map>()));
    });
  });

  // ─── Flow 3: Protected procedure returns 401 without auth ────────────────────
  group('Flow 3 — Auth enforcement on protected procedures', () {
    final protectedProcedures = [
      'dashboard.stats',
      'organizations.list',
      'banking.kyc.list',
      'siem.alerts',
      'auditLogs.list',
      'enforcementCases.list',
      'financial.penalties',
      'portal.myOrg',
      'workers.status',
    ];

    for (final proc in protectedProcedures) {
      test('$proc without session returns null (401 or error)', () async {
        final unauthClient = TestApiClient(baseUrl: apiUrl);
        final result = await unauthClient.query(proc, {'limit': 5});
        // All protected procedures should return null (401) without auth
        // (null means the test client received a 401 or error response)
        expect(result, isNull,
            reason: '$proc must require authentication');
      });
    }
  });

  // ─── Flow 4: Mutation endpoints reject unauthenticated requests ───────────────
  group('Flow 4 — Mutation auth enforcement', () {
    test('banking.kyc.submit rejects unauthenticated request', () async {
      final unauthClient = TestApiClient(baseUrl: apiUrl);
      final result = await unauthClient.mutate('banking.kyc.submit', {
        'bankId': 1,
        'subjectType': 'individual',
        'fullName': 'Test User',
        'bvn': '12345678901',
        'nationality': 'Nigerian',
      });
      expect(result, isNull,
          reason: 'KYC submission must require authentication');
    });

    test('financial.issuePenalty rejects unauthenticated request', () async {
      final unauthClient = TestApiClient(baseUrl: apiUrl);
      final result = await unauthClient.mutate('financial.issuePenalty', {
        'organizationId': 1,
        'amount': 1000000,
        'currency': 'NGN',
        'reason': 'Test',
        'violationType': 'data_breach',
      });
      expect(result, isNull,
          reason: 'Penalty issuance must require authentication');
    });

    test('siem.resolveAlert rejects unauthenticated request', () async {
      final unauthClient = TestApiClient(baseUrl: apiUrl);
      final result = await unauthClient.mutate('siem.resolveAlert', {
        'id': 1,
        'resolution': 'Test resolution',
      });
      expect(result, isNull,
          reason: 'Alert resolution must require authentication');
    });
  });

  // ─── Flow 5: CORS headers present ────────────────────────────────────────────
  group('Flow 5 — CORS and security headers', () {
    test('API response includes CORS headers', () async {
      final response = await http.options(
        Uri.parse('$apiUrl/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D'),
        headers: {
          'Origin': 'https://app.ndsep.ng',
          'Access-Control-Request-Method': 'GET',
        },
      );
      // Either 200 (CORS allowed) or 204 (preflight success)
      expect(response.statusCode, anyOf(200, 204),
          reason: 'CORS preflight should succeed');
    });

    test('API response includes X-NDSEP-API-Version header', () async {
      final response = await http.get(
        Uri.parse('$apiUrl/api/health'),
      );
      // The version header should be present on all API responses
      final versionHeader = response.headers['x-ndsep-api-version'];
      expect(versionHeader, isNotNull,
          reason: 'X-NDSEP-API-Version header must be present');
    });
  });

  // ─── Flow 6: Rate limiting does not block normal usage ───────────────────────
  group('Flow 6 — Rate limiting', () {
    test('auth.me can be called 10 times without 429', () async {
      for (var i = 0; i < 10; i++) {
        final uri = Uri.parse(
          '$apiUrl/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D',
        );
        final response = await http.get(uri);
        expect(response.statusCode, isNot(429),
            reason: 'auth.me should not be rate-limited for normal usage (call $i)');
      }
    });
  });

  // ─── Flow 7: API versioning ───────────────────────────────────────────────────
  group('Flow 7 — API versioning', () {
    test('X-NDSEP-API-Version is 2.0.0', () async {
      final response = await http.get(Uri.parse('$apiUrl/api/health'));
      final version = response.headers['x-ndsep-api-version'];
      expect(version, '2.0.0',
          reason: 'API version must be 2.0.0');
    });

    test('X-NDSEP-Platform header is present', () async {
      final response = await http.get(Uri.parse('$apiUrl/api/health'));
      final platform = response.headers['x-ndsep-platform'];
      expect(platform, isNotNull,
          reason: 'X-NDSEP-Platform header must be present');
    });
  });

  // ─── Flow 8: Monitoring procedures ───────────────────────────────────────────
  group('Flow 8 — Monitoring and workers', () {
    test('monitoring.stats returns null (protected) or map', () async {
      final result = await client.query('monitoring.stats');
      expect(result, anyOf(isNull, isA<Map>()));
    });

    test('workers.status returns null (protected) or list', () async {
      final result = await client.query('workers.status');
      expect(result, anyOf(isNull, isA<List>()));
    });
  });

  // ─── Flow 9: Compliance procedures ───────────────────────────────────────────
  group('Flow 9 — Compliance procedures', () {
    test('complianceLeaderboard.list returns null or list', () async {
      final result = await client.query('complianceLeaderboard.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('remediation.list returns null or list', () async {
      final result = await client.query('remediation.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('tia.list returns null or list', () async {
      final result = await client.query('tia.list', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });
  });

  // ─── Flow 10: Portal procedures ──────────────────────────────────────────────
  group('Flow 10 — Portal procedures', () {
    test('portal.listOrgUsers returns null (protected) or list', () async {
      final result = await client.query('portal.listOrgUsers', {'orgId': 1});
      expect(result, anyOf(isNull, isA<List>()));
    });

    test('portal.listSubmissions returns null (protected) or list', () async {
      final result = await client.query('portal.listSubmissions', {'limit': 5});
      expect(result, anyOf(isNull, isA<List>()));
    });
  });
}
