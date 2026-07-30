export interface SiteSettings {
  siteName: string;
  siteDescription: string;
  registrationEnabled: boolean;
  registrationQuotaGb: number;
  checkinBonusMb: number;
  statsPollIntervalSeconds: number;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteName: "ProxySubscription",
  siteDescription: "高速稳定的代理订阅服务平台",
  registrationEnabled: true,
  registrationQuotaGb: 50,
  checkinBonusMb: 100,
  statsPollIntervalSeconds: 10,
};

const SETTING_DEFAULTS: Record<string, string> = {
  site_name: DEFAULT_SITE_SETTINGS.siteName,
  site_description: DEFAULT_SITE_SETTINGS.siteDescription,
  registration_enabled: "1",
  registration_quota_gb: String(DEFAULT_SITE_SETTINGS.registrationQuotaGb),
  checkin_bonus_mb: String(DEFAULT_SITE_SETTINGS.checkinBonusMb),
  stats_poll_interval_seconds: String(DEFAULT_SITE_SETTINGS.statsPollIntervalSeconds),
};

export async function ensureSiteSettingsSchema(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  const timestamp = Math.floor(Date.now() / 1000);
  await db.batch(Object.entries(SETTING_DEFAULTS).map(([key, value]) => db.prepare(
    "INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)",
  ).bind(key, value, timestamp)));
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export async function getSiteSettings(db: D1Database): Promise<SiteSettings> {
  try {
    const result = await db.prepare("SELECT key, value FROM site_settings").all<{ key: string; value: string }>();
    const values = Object.fromEntries(result.results.map((row) => [row.key, row.value]));
    return {
      siteName: values.site_name?.trim() || DEFAULT_SITE_SETTINGS.siteName,
      siteDescription: values.site_description?.trim() || DEFAULT_SITE_SETTINGS.siteDescription,
      registrationEnabled: values.registration_enabled !== "0",
      registrationQuotaGb: boundedNumber(values.registration_quota_gb, DEFAULT_SITE_SETTINGS.registrationQuotaGb, 1, 102400),
      checkinBonusMb: boundedNumber(values.checkin_bonus_mb, DEFAULT_SITE_SETTINGS.checkinBonusMb, 1, 10240),
      statsPollIntervalSeconds: boundedNumber(values.stats_poll_interval_seconds, DEFAULT_SITE_SETTINGS.statsPollIntervalSeconds, 5, 300),
    };
  } catch {
    return { ...DEFAULT_SITE_SETTINGS };
  }
}

export function siteSettingEntries(settings: SiteSettings): Array<[string, string]> {
  return [
    ["site_name", settings.siteName],
    ["site_description", settings.siteDescription],
    ["registration_enabled", settings.registrationEnabled ? "1" : "0"],
    ["registration_quota_gb", String(settings.registrationQuotaGb)],
    ["checkin_bonus_mb", String(settings.checkinBonusMb)],
    ["stats_poll_interval_seconds", String(settings.statsPollIntervalSeconds)],
  ];
}
