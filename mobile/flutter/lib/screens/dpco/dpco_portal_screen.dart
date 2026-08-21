import 'package:flutter/material.dart';

import '../../services/api_service.dart';

class DpcoPortalScreen extends StatefulWidget {
  const DpcoPortalScreen({super.key});

  @override
  State<DpcoPortalScreen> createState() => _DpcoPortalScreenState();
}

class _DpcoPortalScreenState extends State<DpcoPortalScreen> {
  final ApiService _api = ApiService();
  late Future<_DpcoPortalData> _portalData;

  @override
  void initState() {
    super.initState();
    _portalData = _loadPortalData();
  }

  Future<_DpcoPortalData> _loadPortalData() async {
    final results = await Future.wait<dynamic>([
      _api.getDpcoDashboardStats(),
      _api.listDpcoAuditEngagements(),
    ]);
    return _DpcoPortalData(
      stats: results[0] as Map<String, dynamic>,
      engagements: results[1] as List<dynamic>,
    );
  }

  Future<void> _refresh() async {
    setState(() => _portalData = _loadPortalData());
    await _portalData;
  }

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
              if (snapshot.hasError) {
                return Text('Authoritative NDSEP data is unavailable: ${snapshot.error}');
              }
              final rows = snapshot.data ?? const [];
              if (rows.isEmpty) return const Text('No records are currently available from the NDSEP service.');
              return ListView.separated(
                shrinkWrap: true,
                itemCount: rows.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (_, index) {
                  final row = rows[index] as Map<dynamic, dynamic>;
                  final titleValue = row['name'] ?? row['organization_name'] ?? row['title'] ?? row['reference_number'] ?? 'Record #${row['id'] ?? index + 1}';
                  final subtitleValue = row['status'] ?? row['current_stage'] ?? row['engagement_type'] ?? row['type'] ?? '';
                  return ListTile(title: Text('$titleValue'), subtitle: subtitleValue == '' ? null : Text('$subtitleValue'));
                },
              );
            },
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
      ),
    );
  }

  int _asInt(dynamic value) => value is num ? value.toInt() : int.tryParse('${value ?? 0}') ?? 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('DPCO Operations Portal'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
      ),
      body: FutureBuilder<_DpcoPortalData>(
        future: _portalData,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Text('The authoritative DPCO service is unavailable. No local or fabricated dashboard data is shown.', textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  ElevatedButton(onPressed: _refresh, child: const Text('Retry')),
                ]),
              ),
            );
          }

          final data = snapshot.requireData;
          final stats = data.stats;
          final functions = <_DpcoFunction>[
            _DpcoFunction('DPCO Registry', 'Licensed organisations', Icons.business, _api.listDpcoOrganisations),
            _DpcoFunction('Client Portfolio', 'Engagement clients', Icons.people, _api.listDpcoClients),
            _DpcoFunction('Audit Workspace', 'Compliance audit engagements', Icons.assignment, _api.listDpcoAuditEngagements),
            _DpcoFunction('Verification Statements', 'Compliance verification records', Icons.verified, _api.listDpcoVerificationStatements),
            _DpcoFunction('Training Sessions', 'DPCO training records', Icons.school, _api.listDpcoTrainingSessions),
            _DpcoFunction('Policy Drafts', 'Data protection policy work', Icons.description, _api.listDpcoPolicyDrafts),
          ];

          return RefreshIndicator(
            onRefresh: _refresh,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Data Protection Compliance Organisation Management', style: TextStyle(color: Colors.grey[600], fontSize: 14)),
                  const SizedBox(height: 16),
                  Row(children: [
                    _StatCard('Licensed DPCOs', '${_asInt(stats['totalDpcos'])}', Colors.blue),
                    const SizedBox(width: 8),
                    _StatCard('Active Clients', '${_asInt(stats['activeClients'])}', Colors.green),
                  ]),
                  const SizedBox(height: 8),
                  Row(children: [
                    _StatCard('Pending CARs', '${_asInt(stats['pendingCars'])}', Colors.orange),
                    const SizedBox(width: 8),
                    _StatCard('Training', '${_asInt(stats['trainingSessions'])}', Colors.purple),
                  ]),
                  const SizedBox(height: 24),
                  const Text('DPCO Functions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 12),
                  ...functions.map((item) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Card(child: ListTile(
                      leading: Icon(item.icon, color: Colors.blue),
                      title: Text(item.name),
                      subtitle: Text(item.description, style: TextStyle(color: Colors.grey[500], fontSize: 12)),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _showCollection(item.name, item.load),
                    )),
                  )),
                  const SizedBox(height: 16),
                  const Text('Recent Audit Engagements', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  if (data.engagements.isEmpty)
                    const Text('No audit engagements are currently available from the NDSEP service.')
                  else
                    ...data.engagements.take(5).map((item) {
                      final row = item as Map<dynamic, dynamic>;
                      final title = row['organization_name'] ?? row['client_name'] ?? 'Engagement #${row['id']}';
                      final status = row['current_stage'] ?? row['status'] ?? 'Unknown status';
                      final type = row['engagement_type'] ?? 'audit';
                      return Card(child: ListTile(title: Text('$title'), subtitle: Text('$status • $type')));
                    }),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _DpcoPortalData {
  final Map<String, dynamic> stats;
  final List<dynamic> engagements;
  const _DpcoPortalData({required this.stats, required this.engagements});
}

class _DpcoFunction {
  final String name;
  final String description;
  final IconData icon;
  final Future<List<dynamic>> Function() load;
  const _DpcoFunction(this.name, this.description, this.icon, this.load);
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatCard(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) => Expanded(
    child: Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(children: [
        Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color)),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(fontSize: 11, color: Colors.grey[500]), textAlign: TextAlign.center),
      ]),
    )),
  );
}
