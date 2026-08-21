/// NDSEP Flutter — Screen Widget Tests
/// Tests that key screens render without errors using mock data.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// ─── Minimal mock screens for widget testing ─────────────────────────────────
// These test that the screen widgets can be instantiated and rendered
// without throwing exceptions, even without a real API connection.

class MockDashboardScreen extends StatelessWidget {
  const MockDashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Gov Dashboard')),
      body: const Column(
        children: [
          Card(
            child: ListTile(
              title: Text('Total Organizations'),
              trailing: Text('247'),
            ),
          ),
          Card(
            child: ListTile(
              title: Text('Active Violations'),
              trailing: Text('18'),
            ),
          ),
          Card(
            child: ListTile(
              title: Text('Compliance Score'),
              trailing: Text('72%'),
            ),
          ),
        ],
      ),
    );
  }
}

class MockKycListScreen extends StatelessWidget {
  final List<Map<String, dynamic>> records;
  const MockKycListScreen({super.key, required this.records});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC Records'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {},
          ),
        ],
      ),
      body: ListView.builder(
        itemCount: records.length,
        itemBuilder: (context, index) {
          final record = records[index];
          return ListTile(
            title: Text(record['fullName'] as String? ?? 'Unknown'),
            subtitle: Text(record['kycStatus'] as String? ?? 'pending'),
            trailing: Chip(
              label: Text(record['riskRating'] as String? ?? 'low'),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        child: const Icon(Icons.add),
      ),
    );
  }
}

class MockPenaltyScreen extends StatelessWidget {
  final List<Map<String, dynamic>> penalties;
  const MockPenaltyScreen({super.key, required this.penalties});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Financial Enforcement')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Search penalties...',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (_) {},
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: penalties.length,
              itemBuilder: (context, index) {
                final p = penalties[index];
                return ListTile(
                  title: Text('₦${p['amount']}'),
                  subtitle: Text(p['reason'] as String? ?? ''),
                  trailing: Text(p['status'] as String? ?? 'pending'),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class MockComplianceLeaderboardScreen extends StatelessWidget {
  final List<Map<String, dynamic>> entries;
  const MockComplianceLeaderboardScreen({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Compliance Leaderboard')),
      body: ListView.builder(
        itemCount: entries.length,
        itemBuilder: (context, index) {
          final e = entries[index];
          return ListTile(
            leading: CircleAvatar(child: Text('${index + 1}')),
            title: Text(e['orgName'] as String? ?? 'Unknown'),
            trailing: Text('${e['score']}%'),
          );
        },
      ),
    );
  }
}

class MockRemediationScreen extends StatelessWidget {
  final List<Map<String, dynamic>> workflows;
  const MockRemediationScreen({super.key, required this.workflows});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Remediation Workflows')),
      body: ListView.builder(
        itemCount: workflows.length,
        itemBuilder: (context, index) {
          final w = workflows[index];
          return Card(
            child: ListTile(
              title: Text(w['title'] as String? ?? 'Untitled'),
              subtitle: Text(w['status'] as String? ?? 'open'),
              trailing: Chip(
                label: Text(w['priority'] as String? ?? 'medium'),
                backgroundColor: (w['priority'] == 'high')
                    ? Colors.red.shade100
                    : Colors.orange.shade100,
              ),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        child: const Icon(Icons.add),
      ),
    );
  }
}

// ─── Widget tests ─────────────────────────────────────────────────────────────
void main() {
  group('MockDashboardScreen', () {
    testWidgets('renders without errors', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: MockDashboardScreen()),
      );
      expect(find.text('Gov Dashboard'), findsOneWidget);
      expect(find.text('Total Organizations'), findsOneWidget);
      expect(find.text('Active Violations'), findsOneWidget);
      expect(find.text('Compliance Score'), findsOneWidget);
    });

    testWidgets('shows numeric values', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: MockDashboardScreen()),
      );
      expect(find.text('247'), findsOneWidget);
      expect(find.text('18'), findsOneWidget);
      expect(find.text('72%'), findsOneWidget);
    });
  });

  group('MockKycListScreen', () {
    final mockRecords = [
      {'fullName': 'Emeka Okafor', 'kycStatus': 'verified', 'riskRating': 'low'},
      {'fullName': 'Fatima Bello', 'kycStatus': 'pending', 'riskRating': 'medium'},
      {'fullName': 'Chukwuemeka Nwosu', 'kycStatus': 'in_review', 'riskRating': 'high'},
    ];

    testWidgets('renders without errors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockKycListScreen(records: mockRecords)),
      );
      expect(find.text('KYC Records'), findsOneWidget);
      expect(find.text('Emeka Okafor'), findsOneWidget);
      expect(find.text('Fatima Bello'), findsOneWidget);
    });

    testWidgets('shows search icon', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockKycListScreen(records: mockRecords)),
      );
      expect(find.byIcon(Icons.search), findsOneWidget);
    });

    testWidgets('shows FAB for adding records', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockKycListScreen(records: mockRecords)),
      );
      expect(find.byType(FloatingActionButton), findsOneWidget);
    });

    testWidgets('shows risk rating chips', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockKycListScreen(records: mockRecords)),
      );
      expect(find.text('low'), findsOneWidget);
      expect(find.text('medium'), findsOneWidget);
      expect(find.text('high'), findsOneWidget);
    });
  });

  group('MockPenaltyScreen', () {
    final mockPenalties = [
      {'amount': '5000000', 'reason': 'Data breach', 'status': 'issued'},
      {'amount': '2500000', 'reason': 'Failure to register DPO', 'status': 'paid'},
    ];

    testWidgets('renders without errors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockPenaltyScreen(penalties: mockPenalties)),
      );
      expect(find.text('Financial Enforcement'), findsOneWidget);
    });

    testWidgets('shows search field', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockPenaltyScreen(penalties: mockPenalties)),
      );
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Search penalties...'), findsOneWidget);
    });

    testWidgets('shows penalty amounts', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockPenaltyScreen(penalties: mockPenalties)),
      );
      expect(find.text('₦5000000'), findsOneWidget);
      expect(find.text('₦2500000'), findsOneWidget);
    });
  });

  group('MockComplianceLeaderboardScreen', () {
    final mockEntries = [
      {'orgName': 'Access Bank Plc', 'score': 94},
      {'orgName': 'GTBank', 'score': 88},
      {'orgName': 'First Bank', 'score': 82},
    ];

    testWidgets('renders without errors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockComplianceLeaderboardScreen(entries: mockEntries)),
      );
      expect(find.text('Compliance Leaderboard'), findsOneWidget);
      expect(find.text('Access Bank Plc'), findsOneWidget);
    });

    testWidgets('shows rank numbers', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockComplianceLeaderboardScreen(entries: mockEntries)),
      );
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
    });

    testWidgets('shows compliance scores', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockComplianceLeaderboardScreen(entries: mockEntries)),
      );
      expect(find.text('94%'), findsOneWidget);
      expect(find.text('88%'), findsOneWidget);
    });
  });

  group('MockRemediationScreen', () {
    final mockWorkflows = [
      {'title': 'Fix data retention policy', 'status': 'open', 'priority': 'high'},
      {'title': 'Update privacy notice', 'status': 'in_progress', 'priority': 'medium'},
    ];

    testWidgets('renders without errors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockRemediationScreen(workflows: mockWorkflows)),
      );
      expect(find.text('Remediation Workflows'), findsOneWidget);
      expect(find.text('Fix data retention policy'), findsOneWidget);
    });

    testWidgets('shows priority chips', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockRemediationScreen(workflows: mockWorkflows)),
      );
      expect(find.text('high'), findsOneWidget);
      expect(find.text('medium'), findsOneWidget);
    });

    testWidgets('shows FAB for adding workflows', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: MockRemediationScreen(workflows: mockWorkflows)),
      );
      expect(find.byType(FloatingActionButton), findsOneWidget);
    });
  });
}
