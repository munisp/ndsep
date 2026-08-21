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
      final data = await ApiService.instance.get('/api/trpc/dpiaAssessments.list');
      setState(() { _assessments = data['result']?['data'] ?? []; _loading = false; });
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
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: ListTile(
                          leading: const Icon(Icons.assessment),
                          title: Text(a['title'] ?? 'Unnamed'),
                          subtitle: Text('Risk: ${a['riskLevel'] ?? 'Unknown'} - ${a['status'] ?? ''}'),
                          trailing: Chip(label: Text(a['status'] ?? '')),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
