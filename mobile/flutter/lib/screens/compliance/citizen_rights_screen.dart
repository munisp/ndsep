import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

final citizenRequestsProvider = FutureProvider<List<dynamic>>((ref) async => ApiService().listCitizenRequests(limit: 50));

class CitizenRightsScreen extends ConsumerStatefulWidget {
  const CitizenRightsScreen({super.key});
  @override ConsumerState<CitizenRightsScreen> createState() => _CitizenRightsScreenState();
}
class _CitizenRightsScreenState extends ConsumerState<CitizenRightsScreen> {
  bool _showForm = false;
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  String _requestType = 'access';
  final _types = ['access', 'erasure', 'portability', 'rectification', 'objection'];
  final _statusColors = {'pending': Color(0xFFF59E0B), 'processing': Color(0xFF3B82F6), 'completed': Color(0xFF22C55E), 'rejected': Color(0xFFEF4444)};

  @override
  Widget build(BuildContext context) {
    final requestsAsync = ref.watch(citizenRequestsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Citizen Rights', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        actions: [IconButton(icon: Icon(_showForm ? Icons.close : Icons.add), onPressed: () => setState(() => _showForm = !_showForm))]),
      body: Column(children: [
        if (_showForm) _buildForm(),
        Expanded(child: requestsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF))),
          error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Color(0xFFEF4444)))),
          data: (requests) => ListView.builder(
            padding: const EdgeInsets.all(12), itemCount: requests.length,
            itemBuilder: (_, i) {
              final r = requests[i] as Map;
              final sc = _statusColors[r['status']?.toString()] ?? const Color(0xFF64748B);
              return Container(
                margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                      child: Text(r['status']?.toString().toUpperCase() ?? '', style: TextStyle(color: sc, fontSize: 10, fontWeight: FontWeight.w700))),
                    const Spacer(),
                    Text(r['requestType']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                  ]),
                  const SizedBox(height: 6),
                  Text(r['citizenName']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w700)),
                  Text(r['citizenEmail']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                  const SizedBox(height: 4),
                  Text(r['description']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                ]),
              );
            },
          ),
        )),
      ]),
    );
  }

  Widget _buildForm() => Container(
    margin: const EdgeInsets.all(12), padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF1E293B))),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('New Rights Request', style: TextStyle(color: Color(0xFFF1F5F9), fontSize: 14, fontWeight: FontWeight.w700)),
      const SizedBox(height: 12),
      _input(_nameCtrl, 'Citizen Name'),
      const SizedBox(height: 8),
      _input(_emailCtrl, 'Citizen Email'),
      const SizedBox(height: 8),
      DropdownButtonFormField<String>(
        value: _requestType,
        dropdownColor: const Color(0xFF0F172A),
        style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13),
        decoration: InputDecoration(filled: true, fillColor: const Color(0xFF0A0E1A), border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF1E293B)))),
        items: _types.map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
        onChanged: (v) => setState(() => _requestType = v!),
      ),
      const SizedBox(height: 8),
      _input(_descCtrl, 'Description', maxLines: 3),
      const SizedBox(height: 12),
      SizedBox(width: double.infinity, child: ElevatedButton(
        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF00D4FF), foregroundColor: const Color(0xFF0A0E1A)),
        onPressed: () async {
          await ApiService().createCitizenRequest(requestType: _requestType, description: _descCtrl.text, citizenName: _nameCtrl.text, citizenEmail: _emailCtrl.text);
          setState(() => _showForm = false);
          ref.invalidate(citizenRequestsProvider);
        },
        child: const Text('Submit Request', style: TextStyle(fontWeight: FontWeight.w700)),
      )),
    ]),
  );

  Widget _input(TextEditingController ctrl, String hint, {int maxLines = 1}) => TextField(
    controller: ctrl, maxLines: maxLines,
    style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13),
    decoration: InputDecoration(hintText: hint, hintStyle: const TextStyle(color: Color(0xFF475569)),
      filled: true, fillColor: const Color(0xFF0A0E1A),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF1E293B)))),
  );
}
