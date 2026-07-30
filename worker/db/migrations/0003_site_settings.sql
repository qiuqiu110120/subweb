CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES
  ('site_name', 'ProxySubscription', unixepoch()),
  ('site_description', '高速稳定的代理订阅服务平台', unixepoch()),
  ('registration_enabled', '1', unixepoch()),
  ('registration_quota_gb', '50', unixepoch()),
  ('checkin_bonus_mb', '100', unixepoch()),
  ('stats_poll_interval_seconds', '10', unixepoch());
