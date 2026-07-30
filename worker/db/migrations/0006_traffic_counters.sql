CREATE TABLE IF NOT EXISTS traffic_counters (
  allocation_id TEXT NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  reporter_id   TEXT NOT NULL,
  uplink_bytes  INTEGER NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
  downlink_bytes INTEGER NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (allocation_id, reporter_id)
);
