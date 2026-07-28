-- D1 Database Schema for ProxySubscription

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    uuid TEXT UNIQUE NOT NULL,
    avatar TEXT DEFAULT '',
    trust_level INTEGER DEFAULT 1,
    traffic_limit BIGINT DEFAULT 53687091200,  -- 50GB default
    traffic_used BIGINT DEFAULT 0,
    traffic_upload BIGINT DEFAULT 0,
    traffic_download BIGINT DEFAULT 0,
    status TEXT DEFAULT 'active',  -- active, suspended, banned
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    traffic_gb INTEGER NOT NULL,
    duration_days INTEGER NOT NULL,
    price_cents INTEGER NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    package_id INTEGER REFERENCES packages(id),
    product_name TEXT NOT NULL,
    traffic_limit BIGINT NOT NULL,
    status TEXT DEFAULT 'active',  -- active, expired, cancelled
    start_date TEXT DEFAULT (datetime('now')),
    end_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    package_id INTEGER REFERENCES packages(id),
    order_type TEXT NOT NULL DEFAULT 'purchase',  -- purchase, renew, upgrade
    amount_cents INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',  -- pending, paid, cancelled, refunded
    payment_method TEXT DEFAULT 'mock',
    created_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT DEFAULT 'vless',
    transport TEXT DEFAULT 'ws',
    path TEXT DEFAULT '/',
    security TEXT DEFAULT 'none',
    network TEXT DEFAULT 'ws',
    service_name TEXT DEFAULT '',
    public_key TEXT DEFAULT '',
    short_id TEXT DEFAULT '',
    flow TEXT DEFAULT '',
    sni TEXT DEFAULT '',
    fingerprint TEXT DEFAULT '',
    alpn TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redeem_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    package_id INTEGER REFERENCES packages(id),
    created_by INTEGER REFERENCES users(id),
    used_by INTEGER REFERENCES users(id),
    used_at TEXT,
    is_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS traffic_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    node_id INTEGER REFERENCES nodes(id),
    upload BIGINT DEFAULT 0,
    download BIGINT DEFAULT 0,
    recorded_at TEXT DEFAULT (datetime('now'))
);

-- Default packages
INSERT OR IGNORE INTO packages (id, name, traffic_gb, duration_days, price_cents, description, sort_order) VALUES
    (1, '50GB 月度套餐', 50, 30, 990, '适合轻度使用', 1),
    (2, '200GB 月度套餐', 200, 30, 1990, '适合中度使用', 2),
    (3, '500GB 月度套餐', 500, 30, 3990, '适合重度使用', 3),
    (4, '1024GB 月度套餐', 1024, 30, 6990, '适合超大流量', 4);
