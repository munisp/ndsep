/// NDSEP Flutter — Data Sovereignty Screen
/// Hosting declarations + verification verdicts + sovereignty scoring:
///   hostingVerification.listVerdicts / .declarationVerdict / .stats
///   dataSovereignty.listDeclarations / .scoreRegister / .sectorHeatMap
library;

import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class DataSovereigntyScreen extends StatefulWidget {
  const DataSovereigntyScreen({super.key});

  @override
  State<DataSovereigntyScreen> createState() => _DataSovereigntyScreenState();
}

class _DataSovereigntyScreenState extends State<DataSovereigntyScreen> with SingleTickerProviderStateMixin {
  final _api = ApiService();
  late final TabController _tabs = TabController(length: 3, vsync: this);

  static const _verdictColors = {
    'compliant': Color(0xFF22C55E),
    'violation': Color(0xFFEF4444),
    'unverified': Color(0xFFF59E0B),
  };

  static const _tierColors = {
    'sovereign_ready': Color(0xFF22C55E),
    'on_track': Color(0xFF06B6D4),
    'at_risk': Color(0xFFF59E0B),
    'critical': Color(0xFFEF4444),
    'non_compliant': Color(0xFFDC2626),
  };

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Data Sovereignty', style: TextStyle(fontWeight: FontWeight.w800)),
        leading: Builder(builder: (ctx) => IconButton(icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(ctx).openDrawer())),
        bottom: TabBar(
          controller: _tabs,
          labelColor: const Color(0xFF00D4FF),
          unselectedLabelColor: const Color(0xFF64748B),
          indicatorColor: const Color(0xFF00D4FF),
          tabs: const [Tab(text: 'Verdicts'), Tab(text: 'Scores'), Tab(text: 'Sectors')],
        ),
      ),
      body: TabBarView(controller: _tabs, children: [
        _VerdictsTab(api: _api, verdictColors: _verdictColors),
        _ScoresTab(api: _api, tierColors: _tierColors),
        _SectorsTab(api: _api),
      ]),
    );
  }
}

// ─── Verdicts tab: hosting verification queue ────────────────────────────────
class _VerdictsTab extends StatefulWidget {
  final ApiService api;
  final Map<String, Color> verdictColors;
  const _VerdictsTab({required this.api, required this.verdictColors});

  @override
  State<_VerdictsTab> createState() => _VerdictsTabState();
}

class _VerdictsTabState extends State<_VerdictsTab> with AutomaticKeepAliveClientMixin {
  String? _verdictFilter;
  List<dynamic> _verdicts = [];
  Map<String, dynamic>? _stats;
  bool _loading = true;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait<dynamic>([
        widget.api.listHostingVerdicts(status: _verdictFilter),
        widget.api.getHostingVerificationStats(),
      ]);
      setState(() {
        _verdicts = results[0] as List<dynamic>;
        _stats = results[1] as Map<String, dynamic>;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('Error: $_error', style: const TextStyle(color: Color(0xFFEF4444))),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: _load, child: const Text('Retry')),
      ]));
    }
    final s = _stats ?? {};
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        // Verdict distribution chips
        Wrap(spacing: 8, runSpacing: 8, children: [
          _statChip('Verified', s['declarations_verified'], const Color(0xFF00D4FF), null),
          _statChip('Compliant', s['compliant'], widget.verdictColors['compliant']!, 'compliant'),
          _statChip('Violations', s['violation'], widget.verdictColors['violation']!, 'violation'),
          _statChip('Unverified', s['unverified'], widget.verdictColors['unverified']!, 'unverified'),
          _statChip('Never verified', s['never_verified'], const Color(0xFF64748B), null),
          _statChip('Runs 24h', s['runs_24h'], const Color(0xFF94A3B8), null),
        ]),
        const SizedBox(height: 12),
        if (_verdicts.isEmpty)
          const Padding(padding: EdgeInsets.all(24), child: Center(
            child: Text('No verification verdicts match the filter', style: TextStyle(color: Color(0xFF64748B)))))
        else
          ..._verdicts.map((v) {
            final row = v as Map;
            final verdict = row['verdict']?.toString() ?? 'unverified';
            final color = widget.verdictColors[verdict] ?? const Color(0xFF64748B);
            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
              child: ListTile(
                onTap: () => _showDeclarationVerdict(row['declaration_id'] as int),
                title: Text(row['entity_name']?.toString() ?? row['entity_ref']?.toString() ?? 'Unknown entity',
                    style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Padding(padding: const EdgeInsets.only(top: 4), child: Text(
                  '${row['entity_type'] ?? ''} • hosts: ${row['host_count'] ?? 0} '
                  '(NG ${row['in_nigeria_count'] ?? 0} / out ${row['outside_nigeria_count'] ?? 0})'
                  ' • checked ${row['checked_at']?.toString().substring(0, 16) ?? 'never'}',
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 11))),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                  child: Text(verdict.toUpperCase(), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700)),
                ),
              ),
            );
          }),
      ]),
    );
  }

  Widget _statChip(String label, dynamic value, Color color, String? filter) {
    final active = filter != null && _verdictFilter == filter;
    return GestureDetector(
      onTap: filter == null ? null : () {
        setState(() => _verdictFilter = active ? null : filter);
        _load();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: active ? color.withOpacity(0.25) : const Color(0xFF0F172A),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: active ? color : const Color(0xFF1E293B)),
        ),
        child: Text('$label: ${value ?? 0}', style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
      ),
    );
  }

  void _showDeclarationVerdict(int declarationId) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        expand: false,
        builder: (context, scrollController) => FutureBuilder<Map<String, dynamic>>(
          future: widget.api.getDeclarationVerdict(declarationId),
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
            }
            if (snapshot.hasError) {
              return Center(child: Padding(padding: const EdgeInsets.all(24),
                  child: Text('Error: ${snapshot.error}', style: const TextStyle(color: Color(0xFFEF4444)))));
            }
            final data = snapshot.data!;
            final run = data['run'] as Map?;
            final hosts = (data['hosts'] as List?) ?? [];
            final note = data['note']?.toString();
            final verdict = run?['verdict']?.toString() ?? 'unverified';
            final color = widget.verdictColors[verdict] ?? const Color(0xFF64748B);
            return ListView(controller: scrollController, padding: const EdgeInsets.all(16), children: [
              Row(children: [
                Expanded(child: Text('Declaration #$declarationId', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 16, fontWeight: FontWeight.w800))),
                Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                  child: Text(verdict.toUpperCase(), style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700))),
              ]),
              if (note != null) Padding(padding: const EdgeInsets.only(top: 8),
                  child: Text(note, style: const TextStyle(color: Color(0xFFF59E0B), fontSize: 12))),
              if (run != null) ...[
                const SizedBox(height: 8),
                Text('Trigger: ${run['trigger']} • by ${run['checked_by'] ?? 'scheduler'} • ${run['checked_at']?.toString().substring(0, 16) ?? ''}',
                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
              ],
              const SizedBox(height: 12),
              const Text('Per-host evidence', style: TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              if (hosts.isEmpty)
                const Text('No host evidence recorded.', style: TextStyle(color: Color(0xFF64748B), fontSize: 12))
              else
                ...hosts.map((h) {
                  final host = h as Map;
                  final hv = host['verdict']?.toString() ?? 'unverified';
                  final hc = hv == 'in_nigeria' ? const Color(0xFF22C55E)
                      : hv == 'outside_nigeria' ? const Color(0xFFEF4444)
                      : const Color(0xFFF59E0B);
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: const Color(0xFF0A0E1A), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFF1E293B))),
                    child: Row(children: [
                      Container(width: 8, height: 8, decoration: BoxDecoration(color: hc, shape: BoxShape.circle)),
                      const SizedBox(width: 8),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(host['host']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 12, fontFamily: 'monospace')),
                        Text('${host['host_kind'] ?? ''} • ${hv.replaceAll('_', ' ')}',
                            style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                      ])),
                    ]),
                  );
                }),
            ]);
          },
        ),
      ),
    );
  }
}

// ─── Scores tab: sovereignty score register ──────────────────────────────────
class _ScoresTab extends StatefulWidget {
  final ApiService api;
  final Map<String, Color> tierColors;
  const _ScoresTab({required this.api, required this.tierColors});

  @override
  State<_ScoresTab> createState() => _ScoresTabState();
}

class _ScoresTabState extends State<_ScoresTab> with AutomaticKeepAliveClientMixin {
  String? _tierFilter;
  List<dynamic> _scores = [];
  bool _loading = true;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final rows = await widget.api.getSovereigntyScoreRegister(tier: _tierFilter);
      setState(() { _scores = rows; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('Error: $_error', style: const TextStyle(color: Color(0xFFEF4444))),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: _load, child: const Text('Retry')),
      ]));
    }
    return Column(children: [
      SizedBox(height: 46, child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        children: [null, ...widget.tierColors.keys].map((tier) {
          final active = _tierFilter == tier;
          final color = tier == null ? const Color(0xFF00D4FF) : (widget.tierColors[tier] ?? const Color(0xFF64748B));
          return Padding(padding: const EdgeInsets.only(right: 8), child: FilterChip(
            label: Text(tier?.replaceAll('_', ' ') ?? 'All', style: TextStyle(fontSize: 11, color: active ? Colors.white : const Color(0xFF94A3B8))),
            selected: active,
            onSelected: (_) { setState(() => _tierFilter = tier); _load(); },
            backgroundColor: const Color(0xFF0F172A),
            selectedColor: color.withOpacity(0.35),
            side: BorderSide(color: active ? color : const Color(0xFF1E293B)),
          ));
        }).toList(),
      )),
      Expanded(child: _scores.isEmpty
          ? const Center(child: Text('No sovereignty scores computed yet', style: TextStyle(color: Color(0xFF64748B))))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
                itemCount: _scores.length,
                itemBuilder: (_, i) {
                  final row = _scores[i] as Map;
                  final tier = row['readiness_tier']?.toString() ?? 'at_risk';
                  final color = widget.tierColors[tier] ?? const Color(0xFF64748B);
                  final score = double.tryParse(row['score']?.toString() ?? '0') ?? 0;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(row['entity_ref']?.toString() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w600, fontFamily: 'monospace'))),
                        Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                          child: Text(tier.replaceAll('_', ' ').toUpperCase(), style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w700))),
                      ]),
                      const SizedBox(height: 8),
                      ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(
                        value: (score / 100).clamp(0.0, 1.0),
                        minHeight: 6,
                        backgroundColor: const Color(0xFF1E293B),
                        valueColor: AlwaysStoppedAnimation(color),
                      )),
                      const SizedBox(height: 4),
                      Text('Score ${score.toStringAsFixed(1)} / 100 • computed ${row['computed_at']?.toString().substring(0, 16) ?? '—'}',
                          style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                    ]),
                  );
                },
              ),
            )),
    ]);
  }
}

// ─── Sectors tab: sector heat map ────────────────────────────────────────────
class _SectorsTab extends StatefulWidget {
  final ApiService api;
  const _SectorsTab({required this.api});

  @override
  State<_SectorsTab> createState() => _SectorsTabState();
}

class _SectorsTabState extends State<_SectorsTab> with AutomaticKeepAliveClientMixin {
  List<dynamic> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final rows = await widget.api.getSovereigntySectorHeatMap();
      setState(() { _rows = rows; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator(color: Color(0xFF00D4FF)));
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('Error: $_error', style: const TextStyle(color: Color(0xFFEF4444))),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: _load, child: const Text('Retry')),
      ]));
    }
    if (_rows.isEmpty) {
      return const Center(child: Text('No sector data available', style: TextStyle(color: Color(0xFF64748B))));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _rows.length,
        itemBuilder: (_, i) {
          final r = _rows[i] as Map;
          final avg = double.tryParse(r['avg_score']?.toString() ?? '');
          final color = avg == null ? const Color(0xFF64748B)
              : avg >= 80 ? const Color(0xFF22C55E)
              : avg >= 60 ? const Color(0xFF06B6D4)
              : avg >= 40 ? const Color(0xFFF59E0B)
              : const Color(0xFFEF4444);
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFF1E293B))),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(r['entity_type']?.toString().toUpperCase() ?? '', style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 13, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text('${r['entities'] ?? 0} entities (${r['in_scope_entities'] ?? 0} in scope) • ${r['open_violations'] ?? 0} open violations • ${r['at_risk_or_worse'] ?? 0} at risk+',
                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
              ])),
              const SizedBox(width: 12),
              Text(avg == null ? '—' : avg.toStringAsFixed(1), style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.w800)),
            ]),
          );
        },
      ),
    );
  }
}
