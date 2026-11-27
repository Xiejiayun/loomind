ALTER TABLE mindmaps ADD COLUMN viewers_can_comment INTEGER NOT NULL DEFAULT 0 CHECK (viewers_can_comment IN (0, 1));

CREATE TABLE mindmap_review_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mindmap_id TEXT NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  sheet_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  topic_title TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX mindmap_review_threads_map ON mindmap_review_threads (mindmap_id, id);

CREATE TABLE mindmap_review_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES mindmap_review_threads(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX mindmap_review_replies_thread ON mindmap_review_replies (thread_id, id);
