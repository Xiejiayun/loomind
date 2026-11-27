CREATE TABLE IF NOT EXISTS mindmap_crdt_updates (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  mindmap_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  update_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS mindmap_crdt_updates_map_seq
  ON mindmap_crdt_updates (mindmap_id, seq ASC);

CREATE TABLE IF NOT EXISTS mindmap_presence (
  mindmap_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  display_name TEXT NOT NULL,
  color TEXT NOT NULL,
  selected_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mindmap_id, peer_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS mindmap_presence_map_updated
  ON mindmap_presence (mindmap_id, updated_at DESC);
