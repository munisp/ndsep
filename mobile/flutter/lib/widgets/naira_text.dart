import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class NairaText extends StatelessWidget {
  final double amount;
  final TextStyle? style;
  final bool compact;

  const NairaText({
    super.key,
    required this.amount,
    this.style,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final formatter = compact
        ? NumberFormat.compact(locale: 'en_NG')
        : NumberFormat('#,##0.00', 'en_NG');
    
    return Text(
      '\u20A6${formatter.format(amount)}',
      style: style,
    );
  }
}
