import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class BreachIncidentsScreen extends StatefulWidget {
  const BreachIncidentsScreen({super.key});

  @override
  State<BreachIncidentsScreen> createState() => _BreachIncidentsScreenState();
}

class _BreachIncidentsScreenState extends State<BreachIncidentsScreen> {
  List<dynamic> _incidents = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadIncidents();
  }

  Future<void> _loadIncidents() async {
    try {
      setState(() { _loading = true; _error = null; });
      final data = await ApiService.instance.get('/api/trpc/breachIncidents.list');
      setState(() { _incidents = data['result']?['data'] ?? []; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Color _severityColor(String severity) {
    switch (severity.toLowerCase()) {
      case 'critical': return Colors.red;
      case 'high': return Colors.orange;
      case 'medium': return Colors.amber;
      case 'low': return Colors.green;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Breach Incidents'), actions: [
        IconButton(icon: const Icon(Icons.refresh), onPressed: _loadIncidents),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.error, size: 48, color: Colors.red),
                  const SizedBox(height: 8),
                  Text(_error!, style: const TextStyle(color: Colors.red)),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _loadIncidents, child: const Text('Retry')),
                ]))
              : _incidents.isEmpty
                  ? const Center(child: Text('No breach incidents found'))
                  : RefreshIndicator(
                      onRefresh: _loadIncidents,
                      child: ListView.builder(
                        itemCount: _incidents.length,
                        itemBuilder: (context, index) {
                          final incident = _incidents[index];
                          return Card(
                            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor: _severityColor(incident['severity'] ?? 'low'),
                                child: Text(
                                  (incident['severity'] ?? 'L')[0].toUpperCase(),
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                                ),
                              ),
                              title: Text(incident['title'] ?? 'Unnamed Incident'),
                              subtitle: Text(
                                '${incident['status'] ?? 'Unknown'} - ${incident['createdAt']?.toString().substring(0, 10) ?? ''}',
                              ),
                              trailing: Chip(
                                label: Text(incident['status'] ?? '', style: const TextStyle(fontSize: 10)),
                                backgroundColor: incident['status'] == 'resolved' ? Colors.green.shade100 : Colors.red.shade100,
                              ),
                              onTap: () => _showIncidentDetail(incident),
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

  void _showIncidentDetail(dynamic incident) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        builder: (context, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(16),
          children: [
            Text(incident['title'] ?? '', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            _detailRow('Severity', incident['severity'] ?? 'Unknown'),
            _detailRow('Status', incident['status'] ?? 'Unknown'),
            _detailRow('Affected Records', '${incident['affectedRecords'] ?? 0}'),
            _detailRow('Reported At', incident['createdAt']?.toString().substring(0, 19) ?? ''),
            const Divider(),
            Text(incident['description'] ?? 'No description available'),
          ],
        ),
      ),
    );
  }

  Widget _detailRow(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(children: [
      Text('$label: ', style: const TextStyle(fontWeight: FontWeight.bold)),
      Expanded(child: Text(value)),
    ]),
  );

  void _showCreateDialog() {
    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    String severity = 'medium';

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Report Breach Incident'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: titleCtrl, decoration: const InputDecoration(labelText: 'Title')),
          const SizedBox(height: 8),
          TextField(controller: descCtrl, decoration: const InputDecoration(labelText: 'Description'), maxLines: 3),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            value: severity,
            decoration: const InputDecoration(labelText: 'Severity'),
            items: ['critical', 'high', 'medium', 'low'].map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
            onChanged: (v) => severity = v ?? 'medium',
          ),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              await ApiService.instance.post('/api/trpc/breachIncidents.create', {
                'title': titleCtrl.text,
                'description': descCtrl.text,
                'severity': severity,
              });
              _loadIncidents();
            },
            child: const Text('Report'),
          ),
        ],
      ),
    );
  }
}
