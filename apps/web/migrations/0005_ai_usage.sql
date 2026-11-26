CREATE TABLE IF NOT EXISTS ai_usage_daily (
  bucket_key TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'pro')),
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (bucket_key, day_utc, tier)
) WITHOUT ROWID;
