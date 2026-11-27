CREATE TABLE IF NOT EXISTS mindmap_ai_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  mindmap_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (mindmap_id, id)
);

CREATE INDEX IF NOT EXISTS mindmap_ai_messages_map_seq
  ON mindmap_ai_messages (mindmap_id, seq ASC);
