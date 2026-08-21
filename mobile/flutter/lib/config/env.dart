/// NDSEP Mobile — Environment Configuration
class AppConfig {
  static const String appName = 'NDSEP';
  static const String appVersion = '1.0.0';
  
  static String get apiBaseUrl {
    const isDebug = bool.fromEnvironment('dart.vm.product') == false;
    return isDebug
        ? 'http://10.0.2.2:3000'  // Android emulator → host
        : 'https://api.ndsep.gov.ng';
  }
  
  static const Duration apiTimeout = Duration(seconds: 30);
  static const bool biometricEnabled = true;
  static const bool pushNotificationsEnabled = true;
  static const bool offlineModeEnabled = true;
  static const int maxOfflineQueue = 100;
}
