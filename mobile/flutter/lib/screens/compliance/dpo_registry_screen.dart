import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class DpoRegistryScreen extends StatefulWidget {
  const DpoRegistryScreen({super.key});
  @override
  State<DpoRegistryScreen> createState() => _DpoRegistryScreenState();
}

class _DpoRegistryScreenState extends State<DpoRegistryScreen> {
  List<dynamic> _appointments = [];
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await ApiService.instance.get('/api/trpc/dpoAppointments.list');
      setState(() { _appointments = data['result']?['data'] ?? []; _loading = false; });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('DPO Registry')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _appointments.isEmpty
              ? const Center(child: Text('No DPO appointments found'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    itemCount: _appointments.length,
                    itemBuilder: (context, index) {
                      final dpo = _appointments[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: ListTile(
                          leading: const CircleAvatar(child: Icon(Icons.person)),
                          title: Text(dpo['dpoName'] ?? 'Unknown'),
                          subtitle: Text(dpo['email'] ?? ''),
                          trailing: Text(dpo['status'] ?? ''),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
