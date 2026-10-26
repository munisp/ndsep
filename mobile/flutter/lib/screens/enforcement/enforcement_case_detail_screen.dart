/// NDSEP Flutter — Enforcement Case Detail Screen
/// enforcementCases.list (row lookup — the router has no by-id get) +
/// enforcementCases.timeline for the status history.
library;

import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class EnforcementCaseDetailScreen extends StatelessWidget {
  final int caseId;
  const EnforcementCaseDetailScreen({super.key, required this.caseId});

  static const _statusColors = {
    'open': Color(0xFFEF4444),
    'under_investigation': Color(0xFFF59E0B),
    'notice_issued': Color(0xFF3B82F6),
    'escalated_to_ndpc': Color(0xFFA78BFA),
    'escalated_to_nitda': Color(0xFFA78BFA),
    'settled': Color(0xFF22C55E),
    'closed': Color(0xFF64748B),
  };

  Future<_CaseDetail> _load() async {
    final api = ApiService();
    final results = await Future.wait<dynamic>([
      api.listEnforcementCases(limit: 200),
      api.getEnforcementCaseTimeline(caseId),
    ]);
    final cases = results[0] as List<dynamic>;
    final match = cases.cast<Map>().where((c) => c['id'] == caseId).toList();
    if (match.isEmpty) throw Exception('Enforcement case #$caseId not found');
    return _CaseDetail(caseRow: match.first, timeline: results[1] as List<dynamic>);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Case #$caseId', style: const TextStyle(fontWeight: FontWeight.w800))),
      body: FutureBuilder<_CaseDetail>(
        future: _load(),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
          }
          if (snapshot.hasError) {
            return Center(child: Text('Error: ${snapshot.error}', style: const TextStyle(color: Color(0xFFEF4444))));
          }
          final c = snapshot.data!.caseRow;
          final timeline = snapshot.data!.timeline;
          final status = c['status']?.toString() ?? 'open';
          final sc = _statusColors[status] ?? const Color(0xFF64748B);
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF1E293B))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Expanded(child: Text(c['case_reference']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 13, fontFamily: 'monospace'))),
                  Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                    child: Text(status.replaceAll('_', ' ').toUpperCase(), style: TextStyle(color: sc, fontSize: 11, fontWeight: FontWeight.w700))),
                ]),
                const SizedBox(height: 12),
                Text(c['org_name']?.toString() ?? '', style: const TextStyle(color: Color(0xFF00D4FF), fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text(c['escalation_reason']?.toString() ?? 'Penalty escalation', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                const SizedBox(height: 16),
                const Divider(color: Color(0xFF1E293B)),
                _row('Penalty', '#${c['penalty_id'] ?? '—'} • ${c['currency'] ?? 'NGN'} ${c['amount'] ?? '—'} (${c['payment_status'] ?? '—'})'),
                _row('Assigned officer', c['officer_name']?.toString() ?? 'Unassigned'),
                _row('Overdue days', '${c['overdue_days'] ?? 0}'),
                _row('NDPC ref', c['nitda_reference_number']?.toString() ?? c['ndpc_reference_number']?.toString() ?? '—'),
                _row('Opened', c['opened_at']?.toString().substring(0, 16) ?? '—'),
                if (c['resolved_at'] != null) _row('Resolved', c['resolved_at'].toString().substring(0, 16)),
                if (c['resolution_notes'] != null) _row('Resolution', c['resolution_notes'].toString()),
              ]),
            ),
            const SizedBox(height: 16),
            const Text('Status timeline', style: TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            if (timeline.isEmpty)
              const Text('No timeline entries recorded yet.', style: TextStyle(color: Color(0xFF64748B), fontSize: 12))
            else
              ...timeline.map((t) {
                final e = t as Map;
                final to = e['to_status']?.toString();
                final color = _statusColors[to] ?? const Color(0xFF64748B);
                return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Column(children: [
                    Container(width: 10, height: 10, margin: const EdgeInsets.only(top: 4), decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                    Container(width: 2, height: 34, color: const Color(0xFF1E293B)),
                  ]),
                  const SizedBox(width: 10),
                  Expanded(child: Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${e['from_status'] ?? '∅'} → ${e['to_status'] ?? '∅'}',
                          style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 12, fontWeight: FontWeight.w600)),
                      if (e['note'] != null)
                        Text(e['note'].toString(), style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                      Text('${e['changed_by_name'] ?? ''} • ${e['created_at']?.toString().substring(0, 16) ?? ''}',
                          style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                    ]),
                  )),
                ]);
              }),
          ]);
        },
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 13)),
      Flexible(child: Text(value, style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600), textAlign: TextAlign.end)),
    ]),
  );
}

class _CaseDetail {
  final Map caseRow;
  final List<dynamic> timeline;
  const _CaseDetail({required this.caseRow, required this.timeline});
}
