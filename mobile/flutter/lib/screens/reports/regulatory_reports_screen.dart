import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';

class RegulatoryReportsScreen extends ConsumerStatefulWidget {
  const RegulatoryReportsScreen({super.key});
  @override
  ConsumerState<RegulatoryReportsScreen> createState() => _RegulatoryReportsScreenState();
}

class _RegulatoryReportsScreenState extends ConsumerState<RegulatoryReportsScreen> {
  String _reportType = 'violations';
  String _frequency = 'monthly';
  bool _isGenerating = false;
  bool _isScheduling = false;
  String? _lastReportId;

  final _reportTypes = [
    {'key': 'violations', 'label': 'Violations', 'icon': Icons.warning_amber},
    {'key': 'penalties', 'label': 'Penalties', 'icon': Icons.monetization_on},
    {'key': 'compliance_scores', 'label': 'Scores', 'icon': Icons.bar_chart},
    {'key': 'full_audit', 'label': 'Full Audit', 'icon': Icons.description},
    {'key': 'executive_summary', 'label': 'Executive', 'icon': Icons.summarize},
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Regulatory Reports', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Report Type', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          SizedBox(height: 80, child: ListView(scrollDirection: Axis.horizontal, children: _reportTypes.map((rt) =>
            GestureDetector(
              onTap: () => setState(() => _reportType = rt['key'] as String),
              child: Container(
                width: 90, margin: const EdgeInsets.only(right: 10),
                decoration: BoxDecoration(
                  color: _reportType == rt['key'] ? const Color(0xFF1E40AF) : const Color(0xFF1F2937),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: _reportType == rt['key'] ? const Color(0xFF3B82F6) : const Color(0xFF374151)),
                ),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(rt['icon'] as IconData, color: _reportType == rt['key'] ? const Color(0xFF93C5FD) : Colors.grey, size: 24),
                  const SizedBox(height: 4),
                  Text(rt['label'] as String, style: TextStyle(color: _reportType == rt['key'] ? const Color(0xFF93C5FD) : Colors.grey, fontSize: 11), textAlign: TextAlign.center),
                ]),
              ),
            )
          ).toList())),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF3B82F6), padding: const EdgeInsets.symmetric(vertical: 12)),
              onPressed: _isGenerating ? null : () async {
                setState(() => _isGenerating = true);
                try {
                  final result = await ApiService().generateReport(reportType: _reportType);
                  setState(() { _lastReportId = result['reportId']?.toString(); _isGenerating = false; });
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Report generated: ${result['reportId']}')));
                } catch (e) {
                  setState(() => _isGenerating = false);
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
                }
              },
              icon: _isGenerating ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.bar_chart),
              label: Text(_isGenerating ? 'Generating...' : 'Generate'),
            )),
            const SizedBox(width: 10),
            Expanded(child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF7C3AED), padding: const EdgeInsets.symmetric(vertical: 12)),
              onPressed: _isScheduling ? null : () async {
                setState(() => _isScheduling = true);
                try {
                  final result = await ApiService().scheduleReport(reportType: _reportType, frequency: _frequency);
                  setState(() => _isScheduling = false);
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Scheduled: ${result['scheduleId']}')));
                } catch (e) {
                  setState(() => _isScheduling = false);
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
                }
              },
              icon: const Icon(Icons.schedule),
              label: Text(_isScheduling ? 'Scheduling...' : 'Schedule'),
            )),
          ]),
          const SizedBox(height: 12),
          const Text('Frequency', style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: ['daily', 'weekly', 'monthly', 'quarterly'].map((f) =>
            ChoiceChip(label: Text(f), selected: _frequency == f, onSelected: (_) => setState(() => _frequency = f), selectedColor: const Color(0xFF7C3AED))
          ).toList()),
          if (_lastReportId != null) ...[
            const SizedBox(height: 20),
            Container(padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: const Color(0xFF1F2937), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF374151))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Last Generated Report', style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Text(_lastReportId!, style: const TextStyle(color: Color(0xFF60A5FA), fontFamily: 'monospace', fontSize: 14)),
              ])),
          ],
        ]),
      ),
    );
  }
}
