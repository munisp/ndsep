import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class ConsentManagementScreen extends StatefulWidget {
  const ConsentManagementScreen({super.key});

  @override
  State<ConsentManagementScreen> createState() => _ConsentManagementScreenState();
}

class _ConsentManagementScreenState extends State<ConsentManagementScreen> {
  List<dynamic> _records = [];
  bool _loading = true;
  String? _error;

  static const _lawfulBases = [
    'consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests',
  ];

  @override
  void initState() {
    super.initState();
    _loadRecords();
  }

  Future<void> _loadRecords() async {
    try {
      setState(() { _loading = true; _error = null; });
      // Real path: consentRecords.list -> {data, total} (snake_case rows)
      final res = await ApiService().query<Map<String, dynamic>>(
        'consentRecords.list', {'page': 1, 'limit': 50}, (j) => j as Map<String, dynamic>);
      setState(() { _records = (res['data'] as List?) ?? []; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Consent Management')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('Error: $_error', style: const TextStyle(color: Colors.red)),
                  ElevatedButton(onPressed: _loadRecords, child: const Text('Retry')),
                ]))
              : RefreshIndicator(
                  onRefresh: _loadRecords,
                  child: ListView.builder(
                    itemCount: _records.length,
                    itemBuilder: (context, index) {
                      final record = _records[index] as Map;
                      final status = record['consent_status']?.toString() ?? '';
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: ListTile(
                          leading: Icon(
                            status == 'active' ? Icons.check_circle : Icons.cancel,
                            color: status == 'active' ? Colors.green : Colors.red,
                          ),
                          title: Text(record['purpose']?.toString() ?? 'Unknown Purpose'),
                          subtitle: Text('${record['data_subject_name'] ?? ''} • ${record['lawful_basis'] ?? ''} • $status'),
                          trailing: Text(record['expires_at']?.toString().substring(0, 10) ?? ''),
                        ),
                      );
                    },
                  ),
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateDialog(),
        child: const Icon(Icons.add),
      ),
    );
  }

  void _showCreateDialog() {
    final purposeCtrl = TextEditingController();
    final subjectCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final orgIdCtrl = TextEditingController();
    String lawfulBasis = 'consent';

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New Consent Record'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: orgIdCtrl, keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Organization ID')),
          const SizedBox(height: 8),
          TextField(controller: subjectCtrl, decoration: const InputDecoration(labelText: 'Data Subject Name')),
          const SizedBox(height: 8),
          TextField(controller: emailCtrl, keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Data Subject Email')),
          const SizedBox(height: 8),
          TextField(controller: purposeCtrl, decoration: const InputDecoration(labelText: 'Purpose')),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            value: lawfulBasis,
            decoration: const InputDecoration(labelText: 'Lawful Basis'),
            items: _lawfulBases.map((b) => DropdownMenuItem(value: b, child: Text(b.replaceAll('_', ' ')))).toList(),
            onChanged: (v) => lawfulBasis = v ?? 'consent',
          ),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              final orgId = int.tryParse(orgIdCtrl.text);
              if (orgId == null || subjectCtrl.text.trim().isEmpty ||
                  !emailCtrl.text.contains('@') || purposeCtrl.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Org ID, name, valid email and purpose are required')),
                );
                return;
              }
              Navigator.pop(context);
              try {
                // Real path: consentRecords.create {organizationId, dataSubjectName,
                // dataSubjectEmail, purpose, lawfulBasis}
                await ApiService().mutate<Map<String, dynamic>>('consentRecords.create', {
                  'organizationId': orgId,
                  'dataSubjectName': subjectCtrl.text.trim(),
                  'dataSubjectEmail': emailCtrl.text.trim(),
                  'purpose': purposeCtrl.text.trim(),
                  'lawfulBasis': lawfulBasis,
                }, (j) => j as Map<String, dynamic>);
                _loadRecords();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
                }
              }
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}
