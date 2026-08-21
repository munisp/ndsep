-- Canonical storage for authenticated native-mobile push device registrations.
-- Web Push subscriptions remain in push_subscriptions; native device tokens must
-- not be overloaded into the incompatible endpoint/p256dh/auth contract.
CREATE TABLE IF NOT EXISTS mobile_push_devices (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform VARCHAR(32) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_user ON mobile_push_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_platform ON mobile_push_devices(platform, updated_at DESC);
