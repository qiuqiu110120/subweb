PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  username      TEXT NOT NULL,
  avatar_url    TEXT NOT NULL DEFAULT '',
  trust_level   INTEGER NOT NULL DEFAULT 0 CHECK (trust_level >= 0),
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  traffic_bytes   INTEGER NOT NULL CHECK (traffic_bytes > 0),
  traffic_label   TEXT NOT NULL,
  duration_months INTEGER NOT NULL DEFAULT 1 CHECK (duration_months > 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS allocations (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uuid          TEXT NOT NULL UNIQUE,
  sub_token     TEXT NOT NULL UNIQUE,
  quota_bytes   INTEGER NOT NULL CHECK (quota_bytes > 0),
  used_bytes    INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  product_id    TEXT REFERENCES products(id),
  product_name  TEXT NOT NULL,
  claimed_at    INTEGER,
  expires_at    INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_active_user
  ON allocations(user_id) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_allocations_user ON allocations(user_id);

CREATE TABLE IF NOT EXISTS traffic_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allocation_id   TEXT NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  uplink_delta    INTEGER NOT NULL DEFAULT 0 CHECK (uplink_delta >= 0),
  downlink_delta  INTEGER NOT NULL DEFAULT 0 CHECK (downlink_delta >= 0),
  recorded_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traffic_allocation_time
  ON traffic_logs(allocation_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id),
  order_type    TEXT NOT NULL CHECK (order_type IN ('purchase', 'renewal', 'upgrade')),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'refunded')),
  payment_url   TEXT,
  created_at    INTEGER NOT NULL,
  paid_at       INTEGER,
  expires_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_orders_user_time ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  product_id    TEXT REFERENCES products(id),
  used_by       TEXT REFERENCES users(id),
  used_at       INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    INTEGER NOT NULL
);

-- Nodes and check-ins are required by blueprint phases 4 and 5.
CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL,
  port        INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  protocol    TEXT NOT NULL DEFAULT 'vless',
  network     TEXT NOT NULL DEFAULT 'ws',
  security    TEXT NOT NULL DEFAULT 'tls',
  path        TEXT NOT NULL DEFAULT '/',
  sni         TEXT NOT NULL DEFAULT '',
  public_key  TEXT NOT NULL DEFAULT '',
  short_id    TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL DEFAULT 'chrome',
  flow        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date  TEXT NOT NULL,
  bonus_bytes   INTEGER NOT NULL CHECK (bonus_bytes > 0),
  created_at    INTEGER NOT NULL,
  UNIQUE(user_id, checkin_date)
);

INSERT OR IGNORE INTO products
  (id, name, price_cents, traffic_bytes, traffic_label, duration_months, sort_order, is_active)
VALUES
  ('starter-50', '50GB 月度套餐', 990, 53687091200, '50GB', 1, 1, 1),
  ('standard-200', '200GB 月度套餐', 1990, 214748364800, '200GB', 1, 2, 1),
  ('pro-500', '500GB 月度套餐', 3990, 536870912000, '500GB', 1, 3, 1),
  ('max-1024', '1024GB 月度套餐', 6990, 1099511627776, '1024GB', 1, 4, 1);
