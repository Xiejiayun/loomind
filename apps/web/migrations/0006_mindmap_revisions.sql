CREATE TABLE IF NOT EXISTS mindmap_revisions (
  mindmap_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL,
  document TEXT NOT NULL,
  saved_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (mindmap_id, revision)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS mindmap_revisions_lookup
  ON mindmap_revisions (mindmap_id, revision DESC);
