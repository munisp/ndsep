import 'package:flutter/material.dart';

class NdsepTheme {
  static const Color primary = Color(0xFF006338);
  static const Color primaryDark = Color(0xFF004D2B);
  static const Color primaryLight = Color(0xFFE8F5E9);
  static const Color accent = Color(0xFF009951);
  static const Color background = Color(0xFFFFFFFF);
  static const Color surface = Color(0xFFF8F9FA);
  static const Color textPrimary = Color(0xFF1A1A1A);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color error = Color(0xFFDC2626);
  static const Color warning = Color(0xFFF59E0B);
  static const Color success = Color(0xFF10B981);
  static const Color border = Color(0xFFE5E7EB);

  static ThemeData get lightTheme => ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: primary,
      primary: primary,
      secondary: accent,
      error: error,
      surface: surface,
    ),
    scaffoldBackgroundColor: background,
    appBarTheme: const AppBarTheme(
      backgroundColor: primary,
      foregroundColor: Colors.white,
      elevation: 0,
    ),
    cardTheme: CardTheme(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      ),
    ),
  );

  static Color statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'compliant':
      case 'licensed':
      case 'active':
        return success;
      case 'non_compliant':
      case 'suspended':
      case 'critical':
        return error;
      case 'under_review':
      case 'provisional':
      case 'pending':
        return warning;
      case 'remediation':
        return const Color(0xFF3B82F6);
      default:
        return textSecondary;
    }
  }

  static Color riskColor(String level) {
    switch (level.toLowerCase()) {
      case 'low': return success;
      case 'medium': return warning;
      case 'high': return error;
      case 'critical': return const Color(0xFF7C2D12);
      default: return textSecondary;
    }
  }
}
