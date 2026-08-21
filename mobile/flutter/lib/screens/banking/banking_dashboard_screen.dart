import 'package:flutter/material.dart';

import '../../services/api_service.dart';

class BankingDashboardScreen extends StatefulWidget {
  const BankingDashboardScreen({super.key});

  @override
  State<BankingDashboardScreen> createState() => _BankingDashboardScreenState();
}

class _BankingDashboardScreenState extends State<BankingDashboardScreen> {
  final ApiService _api = ApiService();
  late Future<_BankingDashboardData> _dashboardData;

  @override
  void initState() {
    super.initState();
    _dashboardData = _loadDashboardData();
  }

  Future<_BankingDashboardData> _loadDashboardData() async {
    final results = await Future.wait<dynamic>([
      _api.getBankingInstitutionStats(),
      _api.listBankingInstitutions(limit: 5),
    ]);
    final institutionsResult = results[1] as Map<String, dynamic>;
    final rows = institutionsResult['rows'];
    if (rows is! List<dynamic>) throw const FormatException('NDSEP banking institution response did not include rows');
    return _BankingDashboardData(stats: results[0] as Map<String, dynamic>, institutions: rows);
  }

  Future<void> _refresh() async {
    setState(() => _dashboardData = _loadDashboardData());
    await _dashboardData;
  }

  int _asInt(dynamic value) => value is num ? value.toInt() : int.tryParse('${value ?? 0}') ?? 0;
  String _percentage(dynamic value) => value is num ? '${value.toStringAsFixed(1)}%' : '${double.tryParse('${value ?? 0}')?.toStringAsFixed(1) ?? '0.0'}%';

  void _showCollection(String title, Future<List<dynamic>> Function() load) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: double.maxFinite,
          child: FutureBuilder<List<dynamic>>(
            future: load(),
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));
              }
              if (snapshot.hasError) return Text('Authoritative NDSEP banking data is unavailable: ${snapshot.error}');
              final rows = snapshot.data ?? const [];
              if (rows.isEmpty) return const Text('No records are currently available from the NDSEP banking service.');
              return ListView.separated(
                shrinkWrap: true,
                itemCount: rows.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (_, index) {
                  final row = rows[index] as Map<dynamic, dynamic>;
                  final primary = row['name'] ?? row['full_name'] ?? row['message_ref'] ?? row['alert_ref'] ?? row['report_name'] ?? row['reference_id'] ?? 'Record #${row['id'] ?? index + 1}';
                  final secondary = row['status'] ?? row['risk_rating'] ?? row['message_type'] ?? row['category'] ?? '';
                  return ListTile(title: Text('$primary'), subtitle: secondary == '' ? null : Text('$secondary'));
                },
              );
            },
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Banking Services'), backgroundColor: Colors.white, foregroundColor: Colors.black87, elevation: 0),
      body: FutureBuilder<_BankingDashboardData>(
        future: _dashboardData,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) {
            return Center(child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('The authoritative NDSEP banking service is unavailable. No local or fabricated dashboard values are shown.', textAlign: TextAlign.center),
                const SizedBox(height: 12),
                ElevatedButton(onPressed: _refresh, child: const Text('Retry')),
              ]),
            ));
          }

          final data = snapshot.requireData;
          final stats = data.stats;
          final actions = <_BankingAction>[
            _BankingAction('KYC Management', _api.listKycRecords),
            _BankingAction('AML Cases', _api.listAmlCases),
            _BankingAction('SWIFT Transactions', _api.listSwiftMessages),
            _BankingAction('Fraud Alerts', _api.listFraudAlerts),
            _BankingAction('CBN Reports', _api.listCbnReports),
            _BankingAction('Correspondent Banks', _api.listCorrespondentBanks),
            _BankingAction('Watchlist Screening', _api.listBankingWatchlist),
            _BankingAction('Payments Monitor', _api.listBankingPayments),
          ];

          return RefreshIndicator(
            onRefresh: _refresh,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('CBN-Regulated Institution Monitoring', style: TextStyle(color: Colors.grey[600], fontSize: 14)),
                const SizedBox(height: 16),
                Row(children: [
                  _StatCard('Institutions', '${_asInt(stats['total'])}', Colors.blue),
                  const SizedBox(width: 8),
                  _StatCard('Licensed', '${_asInt(stats['licensed'])}', Colors.green),
                  const SizedBox(width: 8),
                  _StatCard('Suspended', '${_asInt(stats['suspended'])}', Colors.red),
                  const SizedBox(width: 8),
                  _StatCard('Avg Score', _percentage(stats['avg_compliance']), Colors.blue),
                ]),
                const SizedBox(height: 24),
                const Text('Quick Actions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                ...actions.map((action) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Card(child: ListTile(title: Text(action.name), trailing: const Icon(Icons.chevron_right), onTap: () => _showCollection(action.name, action.load))),
                )),
                const SizedBox(height: 16),
                const Text('Institutions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                if (data.institutions.isEmpty)
                  const Text('No institutions are currently available from the NDSEP banking service.')
                else
                  ...data.institutions.map((item) {
                    final row = item as Map<dynamic, dynamic>;
                    return Card(child: ListTile(
                      title: Text('${row['name'] ?? 'Unnamed institution'}'),
                      subtitle: Text('${row['license_type'] ?? 'Unspecified'} • ${row['status'] ?? 'Unknown'}'),
                    ));
                  }),
              ]),
            ),
          );
        },
      ),
    );
  }
}

class _BankingDashboardData {
  final Map<String, dynamic> stats;
  final List<dynamic> institutions;
  const _BankingDashboardData({required this.stats, required this.institutions});
}

class _BankingAction {
  final String name;
  final Future<List<dynamic>> Function() load;
  const _BankingAction(this.name, this.load);
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatCard(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) => Expanded(
    child: Card(child: Padding(
      padding: const EdgeInsets.all(10),
      child: Column(children: [
        Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: color)),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(fontSize: 10, color: Colors.grey[500]), textAlign: TextAlign.center),
      ]),
    )),
  );
}
