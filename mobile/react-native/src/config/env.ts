/**
 * NDSEP Mobile — Environment Configuration
 * Set API_BASE_URL to your NDSEP backend instance.
 */
export const ENV = {
  API_BASE_URL: __DEV__
    ? 'http://10.0.2.2:3000'  // Android emulator → host machine
    : 'https://api.ndsep.gov.ng',
  API_TIMEOUT: 30000,
  APP_VERSION: '1.0.0',
  BIOMETRIC_ENABLED: true,
  PUSH_NOTIFICATIONS_ENABLED: true,
  OFFLINE_MODE_ENABLED: true,
  MAX_OFFLINE_QUEUE: 100,
};

export const COLORS = {
  primary: '#006338',
  primaryDark: '#004D2B',
  primaryLight: '#E8F5E9',
  accent: '#009951',
  background: '#FFFFFF',
  surface: '#F8F9FA',
  text: '#1A1A1A',
  textSecondary: '#6B7280',
  error: '#DC2626',
  warning: '#F59E0B',
  success: '#10B981',
  border: '#E5E7EB',
};

export const NIGERIAN_THEME = {
  statusColors: {
    compliant: '#10B981',
    non_compliant: '#DC2626',
    under_review: '#F59E0B',
    remediation: '#3B82F6',
    licensed: '#10B981',
    suspended: '#DC2626',
    provisional: '#F59E0B',
  },
  riskColors: {
    low: '#10B981',
    medium: '#F59E0B',
    high: '#DC2626',
    critical: '#7C2D12',
  },
};
