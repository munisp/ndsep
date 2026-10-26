/// NDSEP Flutter — Public Complaints Screen
/// Staff triage queue over the publicComplaints router:
///   publicComplaints.list / .get (status timeline) / .stats / .trackComplaint
library;

import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class ComplaintsScreen extends StatefulWidget {
  const ComplaintsScreen({super.key});

  @override
  State<ComplaintsScreen> createState() => _ComplaintsScreenState();
}

class _ComplaintsScreenState extends State<ComplaintsScreen> {
  final _api = ApiService();

  static const _statuses = ['received', 'acknowledged', 'under_review', 'linked_to_case', 'resolved', 'closed'];
  static const _categories = ['consent', 'breach', 'cross_border', 'dark_pattern', 'excessive_collection', 'minors', 'other'];

  static const _statusColors = {
    'received': Color(0xFF3B82F6),
    'acknowledged': Color(0xFF06B6D4),
    'under_review': Color(0xFFF59E0B),
    'linked_to_case': Color(0xFFA78BFA),
    'resolved': Color(0xFF22C55E),
    'closed': Color(0xFF64748B),
  };

  String? _statusFilter;
  String? _categoryFilter;
  bool _slaBreachedOnly = false;
  bool _unassignedOnly = false;

  List<dynamic> _complaints = [];
  Map<String, dynamic>? _stats;
  int _total = 0;
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
      final results = await Future.wait<dynamic>([
        _api.listComplaints(
          status: _statusFilter,
          category: _categoryFilter,
          slaBreachedOnly: _slaBreachedOnly,
          unassignedOnly: _unassignedOnly,
          limit: 50,
        ),
        _api.getComplaintStats(),
      ]);
      final page = results[0] as Map<String, dynamic>;
      setState(() {
        _complaints = (page['data'] as List?) ?? [];
        _total = (page['total'] as num?)?.toInt() ?? _complaints.length;
        _stats = results[1] as Map<String, dynamic>;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Color _slaColor(String? state) {
    switch (state) {
      case 'breached': return const Color(0xFFEF4444);
      case 'within_sla': return const Color(0xFFF59E0B);
      case 'met': return const Color(0xFF22C55E);
      default: return const Color(0xFF64748B);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Public Complaints', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        actions: [
          IconButton(
            tooltip: 'Track by reference code',
            icon: const Icon(Icons.travel_explore_outlined),
            onPressed: _showTrackDialog,
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: Column(children: [
        if (_stats != null) _buildStatsRow(_stats!),
        _buildFilters(),
        Expanded(child: _buildBody()),
      ]),
    );
  }

  Widget _buildStatsRow(Map<String, dynamic> s) {
    Widget cell(String label, dynamic value, Color color) => Expanded(
      child: Column(children: [
        Text('${value ?? 0}', style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w800)),
        Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 10), textAlign: TextAlign.center),
      ]),
    );
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
      child: Row(children: [
        cell('Total', s['total'], const Color(0xFFF1F5F9)),
        cell('Received 7d', s['received_last_7d'], const Color(0xFF3B82F6)),
        cell('Under review', s['under_review'], const Color(0xFFF59E0B)),
        cell('SLA breached', s['ack_sla_breached'], const Color(0xFFEF4444)),
        cell('Resolved', s['resolved'], const Color(0xFF22C55E)),
      ]),
    );
  }

  Widget _buildFilters() {
    return SizedBox(
      height: 46,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        children: [
          _filterChip('All', _statusFilter == null && _categoryFilter == null && !_slaBreachedOnly && !_unassignedOnly, () {
            setState(() { _statusFilter = null; _categoryFilter = null; _slaBreachedOnly = false; _unassignedOnly = false; });
            _load();
          }),
          _filterChip('SLA breached', _slaBreachedOnly, () {
            setState(() => _slaBreachedOnly = !_slaBreachedOnly);
            _load();
          }, color: const Color(0xFFEF4444)),
          _filterChip('Unassigned', _unassignedOnly, () {
            setState(() => _unassignedOnly = !_unassignedOnly);
            _load();
          }),
          ..._statuses.map((s) => _filterChip(s.replaceAll('_', ' '), _statusFilter == s, () {
            setState(() => _statusFilter = _statusFilter == s ? null : s);
            _load();
          }, color: _statusColors[s])),
          ..._categories.map((cat) => _filterChip('cat: ${cat.replaceAll('_', ' ')}', _categoryFilter == cat, () {
            setState(() => _categoryFilter = _categoryFilter == cat ? null : cat);
            _load();
          }, color: const Color(0xFF06B6D4))),
        ],
      ),
    );
  }

  Widget _filterChip(String label, bool active, VoidCallback onTap, {Color? color}) {
    const accent = Color(0xFF00D4FF);
    final c = color ?? accent;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label, style: TextStyle(fontSize: 11, color: active ? Colors.white : const Color(0xFF94A3B8))),
        selected: active,
        onSelected: (_) => onTap(),
        backgroundColor: const Color(0xFF0F172A),
        selectedColor: c.withOpacity(0.35),
        side: BorderSide(color: active ? c : const Color(0xFF1E293B)),
      ),
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
    if (_complaints.isEmpty) {
      return const Center(child: Text('No complaints match the current filters', style: TextStyle(color: Color(0xFF64748B))));
    }
    final totalCount = _total;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
        itemCount: _complaints.length + 1,
        itemBuilder: (_, i) {
          if (i == 0) {
            return Padding(padding: const EdgeInsets.only(bottom: 8),
                child: Text('$totalCount complaint${totalCount == 1 ? '' : 's'}',
                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)));
          }
          final c = _complaints[i - 1] as Map;
          final status = c['status']?.toString() ?? 'received';
          final sc = _statusColors[status] ?? const Color(0xFF64748B);
          final sla = c['ack_sla_state']?.toString();
          final slaHrs = c['ack_sla_hours_remaining'];
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
            child: ListTile(
              onTap: () => _showDetail(c['id'] as int),
              title: Text(c['subject']?.toString() ?? '(no subject)',
                  style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600),
                  maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '${c['reference_code'] ?? ''} • ${c['category'] ?? ''} • ${c['controller_name'] ?? 'unknown controller'}'
                  '${c['state'] != null ? ' • ${c['state']}' : ''}',
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                ),
              ),
              trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                  child: Text(status.replaceAll('_', ' ').toUpperCase(), style: TextStyle(color: sc, fontSize: 9, fontWeight: FontWeight.w700)),
                ),
                if (sla != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    sla == 'within_sla' && slaHrs != null ? 'SLA ${slaHrs}h left' : 'SLA ${sla.replaceAll('_', ' ')}',
                    style: TextStyle(color: _slaColor(sla), fontSize: 9, fontWeight: FontWeight.w600),
                  ),
                ],
              ]),
            ),
          );
        },
      ),
    );
  }

  Future<void> _showDetail(int id) async {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        expand: false,
        builder: (context, scrollController) => FutureBuilder<Map<String, dynamic>>(
          future: _api.getComplaint(id),
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
            }
            if (snapshot.hasError) {
              return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('Error: ${snapshot.error}', style: const TextStyle(color: Color(0xFFEF4444)))));
            }
            final c = snapshot.data!;
            final events = (c['events'] as List?) ?? [];
            final attachments = (c['attachments'] as List?) ?? [];
            final status = c['status']?.toString() ?? '';
            final sc = _statusColors[status] ?? const Color(0xFF64748B);
            return ListView(controller: scrollController, padding: const EdgeInsets.all(16), children: [
              Row(children: [
                Expanded(child: Text(c['reference_code']?.toString() ?? '', style: const TextStyle(color: Color(0xFF64748B), fontFamily: 'monospace', fontSize: 12))),
                Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: sc.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                  child: Text(status.replaceAll('_', ' ').toUpperCase(), style: TextStyle(color: sc, fontSize: 11, fontWeight: FontWeight.w700))),
              ]),
              const SizedBox(height: 8),
              Text(c['subject']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              _row('Category', c['category']?.toString() ?? '—'),
              _row('Controller', c['controller_name']?.toString() ?? c['controller_registration_ref']?.toString() ?? '—'),
              _row('Location', [c['state'], c['lga']].where((v) => v != null).join(' • ').isEmpty ? '—' : [c['state'], c['lga']].where((v) => v != null).join(' • ')),
              _row('Received', c['received_at']?.toString().substring(0, 16) ?? '—'),
              _row('Ack SLA', '${c['ack_sla_state'] ?? '—'} (due ${c['ack_sla_due_at']?.toString().substring(0, 16) ?? '—'})'),
              _row('Assigned officer', c['assigned_officer_id']?.toString() ?? 'Unassigned'),
              _row('Complainant', c['is_anonymous'] == true ? 'Anonymous' : (c['complainant_name']?.toString() ?? '—')),
              if (c['enforcement_case_id'] != null) _row('Linked case', '${c['enforcement_case_id']}'),
              const SizedBox(height: 12),
              Text(c['description']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
              if (attachments.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('Attachments (${attachments.length})', style: const TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700)),
                ...attachments.map((a) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.attachment, size: 16, color: Color(0xFF64748B)),
                  title: Text(a['filename']?.toString() ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                  subtitle: Text('vault: ${a['vault_status'] ?? 'n/a'}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                )),
              ],
              const SizedBox(height: 16),
              const Text('Status timeline', style: TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              if (events.isEmpty)
                const Text('No timeline events recorded yet.', style: TextStyle(color: Color(0xFF64748B), fontSize: 12))
              else
                ...events.map((e) => _timelineTile(e as Map)),
            ]);
          },
        ),
      ),
    );
  }

  Widget _timelineTile(Map e) {
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
          Text(
            '${e['event_type'] ?? ''}${e['from_status'] != null || e['to_status'] != null ? ' — ${e['from_status'] ?? '∅'} → ${e['to_status'] ?? '∅'}' : ''}',
            style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 12, fontWeight: FontWeight.w600),
          ),
          Text('${e['actor'] ?? ''} • ${e['created_at']?.toString().substring(0, 16) ?? ''}',
              style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
        ]),
      )),
    ]);
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(children: [
      SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12))),
      Expanded(child: Text(value, style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 12))),
    ]),
  );

  void _showTrackDialog() {
    final refCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        title: const Text('Track a complaint', style: TextStyle(color: Color(0xFFF1F5F9))),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: refCtrl, style: const TextStyle(color: Color(0xFFF1F5F9)),
              decoration: const InputDecoration(labelText: 'Reference code (NDPC-CMP-YYYY-NNNNNN)')),
          const SizedBox(height: 8),
          TextField(controller: emailCtrl, style: const TextStyle(color: Color(0xFFF1F5F9)),
              decoration: const InputDecoration(labelText: 'Complainant email (if provided at submission)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              try {
                final view = await _api.trackComplaint(
                  referenceCode: refCtrl.text.trim(),
                  complainantEmail: emailCtrl.text.trim(),
                );
                if (!mounted) return;
                showDialog(context: context, builder: (context) => AlertDialog(
                  backgroundColor: const Color(0xFF0F172A),
                  title: Text(view['reference_code']?.toString() ?? 'Complaint', style: const TextStyle(color: Color(0xFFF1F5F9))),
                  content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Status: ${view['status'] ?? '—'}', style: const TextStyle(color: Color(0xFF00D4FF))),
                    Text('Category: ${view['category'] ?? '—'}', style: const TextStyle(color: Color(0xFF94A3B8))),
                    Text('Received: ${view['received_at']?.toString().substring(0, 16) ?? '—'}', style: const TextStyle(color: Color(0xFF94A3B8))),
                    Text('Ack SLA: ${view['ack_sla_state'] ?? '—'}', style: const TextStyle(color: Color(0xFF94A3B8))),
                  ]),
                  actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
                ));
              } catch (e) {
                if (!mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
              }
            },
            child: const Text('Track'),
          ),
        ],
      ),
    );
  }
}
