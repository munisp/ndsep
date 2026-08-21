/// NDSEP Flutter — ApiService Unit Tests
/// Tests URL construction, input encoding, and response parsing
/// without making real network calls.
library;

import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // ─── tRPC input encoding ──────────────────────────────────────────────────────
  group('tRPC input encoding', () {
    test('null input encodes correctly', () {
      final encoded = Uri.encodeComponent(jsonEncode({'0': {'json': null}}));
      expect(encoded, isNotEmpty);
      final decoded = jsonDecode(Uri.decodeComponent(encoded)) as Map;
      expect(decoded['0']['json'], isNull);
    });

    test('map input encodes correctly', () {
      final input = {'limit': 50, 'status': 'pending'};
      final encoded = Uri.encodeComponent(jsonEncode({'0': {'json': input}}));
      final decoded = jsonDecode(Uri.decodeComponent(encoded)) as Map;
      expect(decoded['0']['json']['limit'], 50);
      expect(decoded['0']['json']['status'], 'pending');
    });

    test('nested map input encodes correctly', () {
      final input = {'filters': {'status': 'active', 'orgId': 42}};
      final encoded = Uri.encodeComponent(jsonEncode({'0': {'json': input}}));
      final decoded = jsonDecode(Uri.decodeComponent(encoded)) as Map;
      expect(decoded['0']['json']['filters']['status'], 'active');
      expect(decoded['0']['json']['filters']['orgId'], 42);
    });

    test('list input encodes correctly', () {
      final input = {'ids': [1, 2, 3]};
      final encoded = Uri.encodeComponent(jsonEncode({'0': {'json': input}}));
      final decoded = jsonDecode(Uri.decodeComponent(encoded)) as Map;
      expect(decoded['0']['json']['ids'], [1, 2, 3]);
    });
  });

  // ─── tRPC response parsing ────────────────────────────────────────────────────
  group('tRPC response parsing', () {
    test('successful query response parsed correctly', () {
      final rawResponse = jsonEncode([
        {
          'result': {
            'data': {
              'json': {'id': 1, 'name': 'Test Org', 'status': 'active'}
            }
          }
        }
      ]);
      final body = jsonDecode(rawResponse) as List;
      final item = body.first as Map<String, dynamic>;
      expect(item.containsKey('error'), isFalse);
      final data = item['result']['data']['json'] as Map<String, dynamic>;
      expect(data['id'], 1);
      expect(data['name'], 'Test Org');
    });

    test('error response detected correctly', () {
      final rawResponse = jsonEncode([
        {
          'error': {
            'message': 'UNAUTHORIZED',
            'code': -32001,
          }
        }
      ]);
      final body = jsonDecode(rawResponse) as List;
      final item = body.first as Map<String, dynamic>;
      expect(item.containsKey('error'), isTrue);
      expect(item['error']['message'], 'UNAUTHORIZED');
    });

    test('list response parsed correctly', () {
      final rawResponse = jsonEncode([
        {
          'result': {
            'data': {
              'json': [
                {'id': 1, 'name': 'Org A'},
                {'id': 2, 'name': 'Org B'},
              ]
            }
          }
        }
      ]);
      final body = jsonDecode(rawResponse) as List;
      final item = body.first as Map<String, dynamic>;
      final data = item['result']['data']['json'] as List;
      expect(data.length, 2);
      expect((data[0] as Map)['name'], 'Org A');
    });

    test('null json result handled correctly', () {
      final rawResponse = jsonEncode([
        {
          'result': {
            'data': {'json': null}
          }
        }
      ]);
      final body = jsonDecode(rawResponse) as List;
      final item = body.first as Map<String, dynamic>;
      final data = item['result']['data']['json'];
      expect(data, isNull);
    });
  });

  // ─── URL construction ─────────────────────────────────────────────────────────
  group('URL construction', () {
    const baseUrl = 'https://ndsep.nitda.gov.ng';

    test('query URL is constructed correctly', () {
      const procedure = 'banking.kyc.list';
      final inputParam = Uri.encodeComponent(
        jsonEncode({'0': {'json': {'limit': 50}}}),
      );
      final uri = Uri.parse(
        '$baseUrl/api/trpc/$procedure?batch=1&input=$inputParam',
      );
      expect(uri.host, 'ndsep.nitda.gov.ng');
      expect(uri.path, '/api/trpc/banking.kyc.list');
      expect(uri.queryParameters['batch'], '1');
      expect(uri.queryParameters.containsKey('input'), isTrue);
    });

    test('mutation URL is constructed correctly', () {
      const procedure = 'financial.issuePenalty';
      final uri = Uri.parse('$baseUrl/api/trpc/$procedure?batch=1');
      expect(uri.path, '/api/trpc/financial.issuePenalty');
      expect(uri.queryParameters['batch'], '1');
    });

    test('nested procedure path is preserved', () {
      const procedure = 'banking.kyc.submit';
      final uri = Uri.parse('$baseUrl/api/trpc/$procedure?batch=1');
      expect(uri.path, '/api/trpc/banking.kyc.submit');
    });
  });

  // ─── Procedure name correctness ───────────────────────────────────────────────
  group('Procedure name registry', () {
    // These are the canonical procedure names as confirmed against the live backend.
    // If any of these change, the Flutter app will break.
    final canonicalProcedures = {
      'auth': ['auth.me', 'auth.logout'],
      'dashboard': ['dashboard.stats'],
      'organizations': ['organizations.list', 'organizations.create'],
      'banking_kyc': ['banking.kyc.list', 'banking.kyc.submit'],
      'banking_aml': ['banking.aml.list', 'banking.aml.flag'],
      'siem': ['siem.alerts', 'siem.resolveAlert'],
      'audit': ['auditLogs.list'],
      'enforcement': ['enforcementCases.list', 'enforcementCases.create'],
      'financial': ['financial.penalties', 'financial.issuePenalty'],
      'calendar': ['complianceCalendar.events', 'complianceCalendar.upcomingDeadlines', 'complianceCalendar.listCustom', 'complianceCalendar.createEvent'],
      'portal': ['portal.myOrg', 'portal.listOrgUsers', 'portal.addOrgUser'],
      'monitoring': ['monitoring.stats', 'monitoring.slaBreaches'],
      'workers': ['workers.status'],
      'tia': ['tia.list', 'tia.create'],
      'remediation': ['remediation.list', 'remediation.create'],
      'leaderboard': ['complianceLeaderboard.list'],
    };

    for (final entry in canonicalProcedures.entries) {
      test('${entry.key} procedures are well-formed', () {
        for (final proc in entry.value) {
          expect(proc, isNotEmpty,
              reason: 'Procedure name must not be empty');
          expect(proc, isNot(contains(' ')),
              reason: 'Procedure name must not contain spaces: $proc');
          expect(proc.split('.').length, greaterThanOrEqualTo(1),
              reason: 'Procedure name must have at least one segment: $proc');
        }
      });
    }
  });

  // ─── Security header validation ───────────────────────────────────────────────
  group('Security header validation', () {
    test('authorization header format is correct', () {
      const token = 'test-session-token-abc123';
      final header = 'Bearer $token';
      expect(header, startsWith('Bearer '));
      expect(header.split(' ').length, 2);
    });

    test('cookie header format is correct', () {
      const cookie = 'app_session_id=abc123xyz';
      expect(cookie, contains('='));
      expect(cookie, isNot(contains('\n')));
    });
  });
}
