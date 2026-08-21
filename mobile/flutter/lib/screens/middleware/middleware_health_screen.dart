import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class MiddlewareHealthScreen extends StatefulWidget {
  const MiddlewareHealthScreen({super.key});
  @override
  State<MiddlewareHealthScreen> createState() => _MiddlewareHealthScreenState();
}

class _MiddlewareHealthScreenState extends State<MiddlewareHealthScreen> {
  Map<String, dynamic>? _health;
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await ApiService.instance.get('/api/middleware/health');
      setState(() { _health = data; _loading = false; });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'healthy': return Colors.green;
      case 'degraded': return Colors.orange;
      case 'unhealthy': return Colors.red;
      default: return Colors.grey;
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'healthy': return Icons.check_circle;
      case 'degraded': return Icons.warning;
      case 'unhealthy': return Icons.error;
      default: return Icons.help;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Middleware Health'), actions: [
        IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _health == null
              ? const Center(child: Text('Health data unavailable'))
              : ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    Card(
                      color: _statusColor(_health!['overall'] ?? 'unknown').withOpacity(0.1),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(children: [
                          Icon(_statusIcon(_health!['overall'] ?? ''), size: 40, color: _statusColor(_health!['overall'] ?? '')),
                          const SizedBox(width: 12),
                          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('Overall Status', style: Theme.of(context).textTheme.titleMedium),
                            Text((_health!['overall'] ?? 'Unknown').toUpperCase(),
                              style: TextStyle(fontWeight: FontWeight.bold, color: _statusColor(_health!['overall'] ?? ''))),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    ...(_health!['services'] as List<dynamic>? ?? []).map((service) => Card(
                      child: ListTile(
                        leading: Icon(_statusIcon(service['status'] ?? ''), color: _statusColor(service['status'] ?? '')),
                        title: Text(service['name'] ?? ''),
                        subtitle: Text('Latency: ${service['latencyMs'] ?? 0}ms'),
                        trailing: Chip(
                          label: Text(service['status'] ?? '', style: const TextStyle(fontSize: 10, color: Colors.white)),
                          backgroundColor: _statusColor(service['status'] ?? ''),
                        ),
                      ),
                    )),
                  ],
                ),
    );
  }
}
