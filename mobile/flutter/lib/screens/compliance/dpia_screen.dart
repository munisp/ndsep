import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class DpiaScreen extends StatefulWidget {
  const DpiaScreen({super.key});
  @override
  State<DpiaScreen> createState() => _DpiaScreenState();
}

class _DpiaScreenState extends State<DpiaScreen> {
  List<dynamic> _assessments = [];
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      // Real path: dpia.list (the dpiaAssessments.* namespace is not mounted)
      final data = await ApiService().query<List<dynamic>>(
        'dpia.list', {'limit': 50}, (j) => j as List<dynamic>);
      setState(() { _assessments = data; _loading = false; });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('DPIA Assessments')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _assessments.isEmpty
              ? const Center(child: Text('No DPIA assessments found'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    itemCount: _assessments.length,
                    itemBuilder: (context, index) {
                      final a = _assessments[index];
                      // dpia.list returns raw SQL rows (snake_case)
                      final risk = a['dpia_risk_level']?.toString() ?? a['riskLevel']?.toString() ?? 'Unknown';
                      final status = a['dpia_status']?.toString() ?? a['status']?.toString() ?? '';
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: ListTile(
                          leading: const Icon(Icons.assessment),
                          title: Text(a['title'] ?? 'Unnamed'),
                          subtitle: Text('Risk: $risk - $status'),
                          trailing: Chip(label: Text(status)),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
