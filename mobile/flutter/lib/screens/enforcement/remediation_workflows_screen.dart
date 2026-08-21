/// NDSEP Flutter — Remediation Workflows Screen
/// Mirrors React Native RemediationWorkflowsScreen
library;

import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class RemediationWorkflowsScreen extends StatefulWidget {
  const RemediationWorkflowsScreen({super.key});

  @override
  State<RemediationWorkflowsScreen> createState() => _RemediationWorkflowsScreenState();
}

class _RemediationWorkflowsScreenState extends State<RemediationWorkflowsScreen> {
  final _api = ApiService();
  String? _statusFilter;
  List<dynamic> _workflows = [];
  bool _loading = true;
  String? _error;
  bool _showCreateModal = false;

  // Create form state
  final _orgIdCtrl = TextEditingController();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _dueDateCtrl = TextEditingController();
  String _priority = 'medium';
  bool _creating = false;

  static const _statuses = ['open', 'in_progress', 'completed', 'overdue'];
  static const _priorities = ['low', 'medium', 'high', 'critical'];

  static const _priorityColors = {
    'low': Color(0xFF22c55e),
    'medium': Color(0xFFf59e0b),
    'high': Color(0xFFef4444),
    'critical': Color(0xFF7c3aed),
  };

  static const _statusColors = {
    'open': Color(0xFF3b82f6),
    'in_progress': Color(0xFFf59e0b),
    'completed': Color(0xFF22c55e),
    'overdue': Color(0xFFef4444),
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _orgIdCtrl.dispose();
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _dueDateCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await _api.listRemediationWorkflows(limit: 100, status: _statusFilter);
      setState(() { _workflows = data; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _create() async {
    if (_orgIdCtrl.text.isEmpty || _titleCtrl.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Organization ID and Title are required')),
      );
      return;
    }
    setState(() => _creating = true);
    try {
      await _api.createRemediationWorkflow(
        organizationId: int.parse(_orgIdCtrl.text),
        title: _titleCtrl.text,
        description: _descCtrl.text.isEmpty ? null : _descCtrl.text,
        priority: _priority,
        dueDate: _dueDateCtrl.text.isEmpty ? null : _dueDateCtrl.text,
      );
      setState(() { _showCreateModal = false; _creating = false; });
      _orgIdCtrl.clear(); _titleCtrl.clear(); _descCtrl.clear(); _dueDateCtrl.clear();
      _priority = 'medium';
      _load();
    } catch (e) {
      setState(() => _creating = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _complete(int id) async {
    try {
      await _api.completeRemediationWorkflow(id);
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF111827),
      appBar: AppBar(
        title: const Text('Remediation Workflows'),
        backgroundColor: const Color(0xFF111827),
        foregroundColor: const Color(0xFFF9FAFB),
        elevation: 0,
        actions: [
          TextButton(
            onPressed: () => setState(() => _showCreateModal = true),
            child: const Text('+ New', style: TextStyle(color: Color(0xFF3b82f6))),
          ),
        ],
      ),
      body: Column(
        children: [
          // Status filter chips
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [null, ..._statuses].map((s) {
                final active = _statusFilter == s;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(s ?? 'All'),
                    selected: active,
                    onSelected: (_) {
                      setState(() => _statusFilter = s);
                      _load();
                    },
                    backgroundColor: const Color(0xFF1f2937),
                    selectedColor: const Color(0xFF3b82f6),
                    labelStyle: TextStyle(
                      color: active ? Colors.white : Colors.grey[400],
                      fontSize: 12,
                    ),
                    side: BorderSide(
                      color: active ? const Color(0xFF3b82f6) : const Color(0xFF374151),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF3b82f6)))
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Error: $_error', style: const TextStyle(color: Color(0xFFef4444))),
                            const SizedBox(height: 12),
                            ElevatedButton(onPressed: _load, child: const Text('Retry')),
                          ],
                        ),
                      )
                    : _workflows.isEmpty
                        ? const Center(
                            child: Text(
                              'No remediation workflows found',
                              style: TextStyle(color: Color(0xFF6b7280), fontSize: 14),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.builder(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                              itemCount: _workflows.length,
                              itemBuilder: (context, index) {
                                final wf = _workflows[index] as Map<String, dynamic>;
                                final priority = wf['priority'] as String? ?? 'medium';
                                final status = wf['status'] as String? ?? 'open';
                                return Container(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF1f2937),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(color: const Color(0xFF374151)),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Container(
                                            width: 8, height: 8,
                                            decoration: BoxDecoration(
                                              color: _priorityColors[priority] ?? Colors.grey,
                                              shape: BoxShape.circle,
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: Text(
                                              wf['title'] as String? ?? 'Untitled',
                                              style: const TextStyle(
                                                color: Color(0xFFF9FAFB),
                                                fontSize: 15,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                            decoration: BoxDecoration(
                                              color: _statusColors[status] ?? Colors.grey,
                                              borderRadius: BorderRadius.circular(12),
                                            ),
                                            child: Text(
                                              status.replaceAll('_', ' '),
                                              style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                                            ),
                                          ),
                                        ],
                                      ),
                                      if (wf['description'] != null) ...[
                                        const SizedBox(height: 8),
                                        Text(
                                          wf['description'] as String,
                                          style: TextStyle(color: Colors.grey[400], fontSize: 13),
                                        ),
                                      ],
                                      const SizedBox(height: 8),
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Text(
                                            'Org #${wf['organizationId']}',
                                            style: TextStyle(color: Colors.grey[500], fontSize: 11),
                                          ),
                                          if (wf['dueDate'] != null)
                                            Text(
                                              'Due: ${wf['dueDate']}',
                                              style: const TextStyle(color: Color(0xFFf59e0b), fontSize: 11),
                                            ),
                                        ],
                                      ),
                                      if (status != 'completed') ...[
                                        const SizedBox(height: 8),
                                        GestureDetector(
                                          onTap: () => _complete(wf['id'] as int),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(vertical: 8),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFF064e3b),
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            alignment: Alignment.center,
                                            child: const Text(
                                              'Mark Complete',
                                              style: TextStyle(color: Color(0xFF34d399), fontSize: 13, fontWeight: FontWeight.w600),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
      // Create modal as bottom sheet
      bottomSheet: _showCreateModal
          ? Container(
              padding: const EdgeInsets.all(24),
              decoration: const BoxDecoration(
                color: Color(0xFF1f2937),
                borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
              ),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('New Remediation Workflow',
                          style: TextStyle(color: Color(0xFFF9FAFB), fontSize: 18, fontWeight: FontWeight.bold)),
                        IconButton(
                          icon: const Icon(Icons.close, color: Color(0xFF9ca3af)),
                          onPressed: () => setState(() => _showCreateModal = false),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _buildInput(_orgIdCtrl, 'Organization ID', keyboardType: TextInputType.number),
                    _buildInput(_titleCtrl, 'Title'),
                    _buildInput(_descCtrl, 'Description', maxLines: 3),
                    _buildInput(_dueDateCtrl, 'Due Date (YYYY-MM-DD)'),
                    const Text('Priority', style: TextStyle(color: Color(0xFF9ca3af), fontSize: 12)),
                    const SizedBox(height: 8),
                    Row(
                      children: _priorities.map((p) {
                        final active = _priority == p;
                        return Expanded(
                          child: GestureDetector(
                            onTap: () => setState(() => _priority = p),
                            child: Container(
                              margin: const EdgeInsets.only(right: 8),
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: BoxDecoration(
                                color: active ? (_priorityColors[p] ?? Colors.grey) : const Color(0xFF111827),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: const Color(0xFF374151)),
                              ),
                              alignment: Alignment.center,
                              child: Text(p,
                                style: TextStyle(
                                  color: active ? Colors.white : Colors.grey[400],
                                  fontSize: 12,
                                )),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => setState(() => _showCreateModal = false),
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: Color(0xFF374151)),
                              foregroundColor: const Color(0xFF9ca3af),
                            ),
                            child: const Text('Cancel'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: _creating ? null : _create,
                            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF3b82f6)),
                            child: Text(_creating ? 'Creating...' : 'Create Workflow'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                  ],
                ),
              ),
            )
          : null,
    );
  }

  Widget _buildInput(TextEditingController ctrl, String hint, {TextInputType? keyboardType, int maxLines = 1}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: ctrl,
        keyboardType: keyboardType,
        maxLines: maxLines,
        style: const TextStyle(color: Color(0xFFF9FAFB), fontSize: 14),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Color(0xFF6b7280)),
          filled: true,
          fillColor: const Color(0xFF111827),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: Color(0xFF374151)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: Color(0xFF374151)),
          ),
          contentPadding: const EdgeInsets.all(12),
        ),
      ),
    );
  }
}
