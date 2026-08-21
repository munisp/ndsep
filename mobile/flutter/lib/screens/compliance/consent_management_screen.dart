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

  @override
  void initState() {
    super.initState();
    _loadRecords();
  }

  Future<void> _loadRecords() async {
    try {
      setState(() { _loading = true; _error = null; });
      final data = await ApiService.instance.get('/api/trpc/consentRecords.list');
      setState(() { _records = data['result']?['data'] ?? []; _loading = false; });
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
                      final record = _records[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: ListTile(
                          leading: Icon(
                            record['status'] == 'active' ? Icons.check_circle : Icons.cancel,
                            color: record['status'] == 'active' ? Colors.green : Colors.red,
                          ),
                          title: Text(record['purpose'] ?? 'Unknown Purpose'),
                          subtitle: Text('${record['dataSubject'] ?? ''} - ${record['status'] ?? ''}'),
                          trailing: Text(record['expiresAt']?.toString().substring(0, 10) ?? ''),
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

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New Consent Record'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: subjectCtrl, decoration: const InputDecoration(labelText: 'Data Subject')),
          const SizedBox(height: 8),
          TextField(controller: purposeCtrl, decoration: const InputDecoration(labelText: 'Purpose')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              await ApiService.instance.post('/api/trpc/consentRecords.create', {
                'dataSubject': subjectCtrl.text,
                'purpose': purposeCtrl.text,
              });
              _loadRecords();
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}
