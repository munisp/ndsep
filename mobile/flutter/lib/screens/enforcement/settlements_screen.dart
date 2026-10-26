/// NDSEP Flutter — Settlement Workflows Screen
/// settlementWorkflow.listSettlements + settlementWorkflow.getSettlement
/// (terms, approvals, instalments with ledger posting status).
library;

import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class SettlementsScreen extends StatefulWidget {
  const SettlementsScreen({super.key});

  @override
  State<SettlementsScreen> createState() => _SettlementsScreenState();
}

class _SettlementsScreenState extends State<SettlementsScreen> {
  final _api = ApiService();

  static const _statuses = ['proposal', 'counter', 'agreement', 'approval', 'active', 'fulfilled', 'defaulted', 'void'];
  static const _statusColors = {
    'proposal': Color(0xFF3B82F6),
    'counter': Color(0xFFA78BFA),
    'agreement': Color(0xFF06B6D4),
    'approval': Color(0xFFF59E0B),
    'active': Color(0xFF22C55E),
    'fulfilled': Color(0xFF10B981),
    'defaulted': Color(0xFFEF4444),
    'void': Color(0xFF64748B),
  };

  String? _statusFilter;
  List<dynamic> _settlements = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final rows = await _api.listSettlements(status: _statusFilter);
      setState(() { _settlements = rows; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settlements', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: Column(children: [
        SizedBox(height: 46, child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          children: [null, ..._statuses].map((s) {
            final active = _statusFilter == s;
            final color = s == null ? const Color(0xFF00D4FF) : (_statusColors[s] ?? const Color(0xFF64748B));
            return Padding(padding: const EdgeInsets.only(right: 8), child: FilterChip(
              label: Text(s ?? 'All', style: TextStyle(fontSize: 11, color: active ? Colors.white : const Color(0xFF94A3B8))),
              selected: active,
              onSelected: (_) { setState(() => _statusFilter = s); _load(); },
              backgroundColor: const Color(0xFF0F172A),
              selectedColor: color.withOpacity(0.35),
              side: BorderSide(color: active ? color : const Color(0xFF1E293B)),
            ));
          }).toList(),
        )),
        Expanded(child: _buildBody()),
      ]),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('Error: $_error', style: const TextStyle(color: Color(0xFFEF4444))),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: _load, child: const Text('Retry')),
      ]));
    }
    if (_settlements.isEmpty) {
      return const Center(child: Text('No settlements match the current filter', style: TextStyle(color: Color(0xFF64748B))));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
        itemCount: _settlements.length,
        itemBuilder: (_, i) {
          final s = _settlements[i] as Map;
          final status = s['status']?.toString() ?? 'proposal';
          final sc = _statusColors[status] ?? const Color(0xFF64748B);
          final original = double.tryParse(s['original_amount']?.toString() ?? '0') ?? 0;
          final reduction = double.tryParse(s['reduction_amount']?.toString() ?? '0') ?? 0;
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
            child: ListTile(
              onTap: () => _showDetail(s['id'] as int),
              title: Text(s['settlement_ref']?.toString() ?? 'Settlement #${s['id']}',
                  style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600, fontFamily: 'monospace')),
              subtitle: Padding(padding: const EdgeInsets.only(top: 4), child: Text(
                'Case ${s['case_ref'] ?? '—'} • fine ${s['fine_reference'] ?? '—'} • org #${s['org_id'] ?? '?'}\n'
                'NGN ${original.toStringAsFixed(0)}${reduction > 0 ? ' (−${reduction.toStringAsFixed(0)})' : ''}',
                style: const TextStyle(color: Color(0xFF64748B), fontSize: 11))),
              isThreeLine: true,
              trailing: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                child: Text(status.toUpperCase(), style: TextStyle(color: sc, fontSize: 9, fontWeight: FontWeight.w700)),
              ),
            ),
          );
        },
      ),
    );
  }

  void _showDetail(int settlementId) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.8,
        expand: false,
        builder: (context, scrollController) => FutureBuilder<Map<String, dynamic>>(
          future: _api.getSettlement(settlementId),
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
            }
            if (snapshot.hasError) {
              return Center(child: Padding(padding: const EdgeInsets.all(24),
                  child: Text('Error: ${snapshot.error}', style: const TextStyle(color: Color(0xFFEF4444)))));
            }
            final data = snapshot.data!;
            final settlement = (data['settlement'] as Map?) ?? {};
            final terms = (data['terms'] as List?) ?? [];
            final approvals = (data['approvals'] as List?) ?? [];
            final instalments = (data['instalments'] as List?) ?? [];
            final status = settlement['status']?.toString() ?? '';
            final sc = _statusColors[status] ?? const Color(0xFF64748B);
            return ListView(controller: scrollController, padding: const EdgeInsets.all(16), children: [
              Row(children: [
                Expanded(child: Text(settlement['settlement_ref']?.toString() ?? 'Settlement #$settlementId',
                    style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 16, fontWeight: FontWeight.w800, fontFamily: 'monospace'))),
                Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                  child: Text(status.toUpperCase(), style: TextStyle(color: sc, fontSize: 11, fontWeight: FontWeight.w700))),
              ]),
              const SizedBox(height: 12),
              if (terms.isNotEmpty) ...[
                const Text('Latest terms', style: TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                ...terms.take(1).map((t) {
                  final term = t as Map;
                  final obligations = (term['non_monetary_obligations'] as List?) ?? [];
                  return Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFF0A0E1A), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFF1E293B))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${term['currency'] ?? 'NGN'} ${term['monetary_amount'] ?? 0}${term['is_counter'] == true ? ' (counter-proposal)' : ''}',
                          style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 18, fontWeight: FontWeight.w800)),
                      Text('v${term['version']} • proposed by ${term['proposed_by'] ?? '—'} • ${term['proposed_at']?.toString().substring(0, 16) ?? ''}',
                          style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                      if (obligations.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        ...obligations.map((o) => Text('• $o', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12))),
                      ],
                      if (term['confidentiality_flag'] == true)
                        const Padding(padding: EdgeInsets.only(top: 6),
                            child: Text('Confidential — see transparency rationale', style: TextStyle(color: Color(0xFFF59E0B), fontSize: 11))),
                    ]),
                  );
                }),
              ],
              if (approvals.isNotEmpty) ...[
                const SizedBox(height: 14),
                const Text('Approvals', style: TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                ...approvals.map((a) {
                  final ap = a as Map;
                  final decision = ap['decision']?.toString() ?? 'pending';
                  final dc = decision == 'approved' ? const Color(0xFF22C55E) : decision == 'rejected' ? const Color(0xFFEF4444) : const Color(0xFFF59E0B);
                  return ListTile(dense: true, contentPadding: EdgeInsets.zero,
                    leading: Icon(decision == 'approved' ? Icons.check_circle : decision == 'rejected' ? Icons.cancel : Icons.hourglass_top, color: dc, size: 18),
                    title: Text('${ap['approver'] ?? '—'} (level ${ap['approval_level'] ?? '?'})', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 12)),
                    subtitle: Text('$decision • ${ap['decided_at']?.toString().substring(0, 16) ?? '—'}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                  );
                }),
              ],
              if (instalments.isNotEmpty) ...[
                const SizedBox(height: 14),
                const Text('Instalments', style: TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                ...instalments.map((inst) {
                  final row = inst as Map;
                  final ist = row['status']?.toString() ?? 'pending';
                  final ic = ist == 'paid' ? const Color(0xFF22C55E) : ist == 'defaulted' ? const Color(0xFFEF4444) : const Color(0xFFF59E0B);
                  final ledger = row['ledger_post_status']?.toString() ?? 'unposted';
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: const Color(0xFF0A0E1A), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFF1E293B))),
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('#${row['seq']} • ${row['currency'] ?? 'NGN'} ${row['amount'] ?? 0}',
                            style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600)),
                        Text('due ${row['due_date']?.toString().substring(0, 10) ?? '—'} • ledger: $ledger',
                            style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                      ])),
                      Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(color: ic.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                        child: Text(ist.toUpperCase(), style: TextStyle(color: ic, fontSize: 9, fontWeight: FontWeight.w700))),
                    ]),
                  );
                }),
              ],
              if (terms.isEmpty && approvals.isEmpty && instalments.isEmpty)
                const Padding(padding: EdgeInsets.only(top: 12),
                    child: Text('No terms, approvals or instalments recorded yet.', style: TextStyle(color: Color(0xFF64748B), fontSize: 12))),
            ]);
          },
        ),
      ),
    );
  }
}
