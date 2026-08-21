import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

const String _apiUrl = String.fromEnvironment('NDSEP_API_URL', defaultValue: 'https://ndsep.nitda.gov.ng');

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override State<LoginScreen> createState() => _LoginScreenState();
}
class _LoginScreenState extends State<LoginScreen> {
  bool _loading = false;
  Future<void> _login() async {
    setState(() => _loading = true);
    final url = Uri.parse('$_apiUrl/api/oauth/login?redirect_uri=ndsep://auth/callback');
    if (await canLaunchUrl(url)) await launchUrl(url, mode: LaunchMode.externalApplication);
    setState(() => _loading = false);
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFF0A0E1A),
    body: SafeArea(child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Container(width: 80, height: 80, decoration: BoxDecoration(color: const Color(0xFF00D4FF20), borderRadius: BorderRadius.circular(40), border: Border.all(color: const Color(0xFF00D4FF))),
          child: const Center(child: Text('NG', style: TextStyle(color: Color(0xFF00D4FF), fontSize: 28, fontWeight: FontWeight.w900)))),
        const SizedBox(height: 24),
        const Text('NDSEP', style: TextStyle(color: Color(0xFFF1F5F9), fontSize: 36, fontWeight: FontWeight.w900, letterSpacing: 4)),
        const SizedBox(height: 8),
        const Text('National Data Sovereignty\nEnforcement Platform', style: TextStyle(color: Color(0xFF64748B), fontSize: 14, height: 1.6), textAlign: TextAlign.center),
        const SizedBox(height: 48),
        SizedBox(width: double.infinity, child: ElevatedButton(
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF00D4FF), foregroundColor: const Color(0xFF0A0E1A), padding: const EdgeInsets.symmetric(vertical: 16), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          onPressed: _loading ? null : _login,
          child: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF0A0E1A))) : const Text('Sign In with NITDA SSO', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
        )),
        const SizedBox(height: 16),
        const Text('Access restricted to authorised NITDA officers\nand registered data controllers.', style: TextStyle(color: Color(0xFF475569), fontSize: 11, height: 1.6), textAlign: TextAlign.center),
      ]),
    )),
  );
}
