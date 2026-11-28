ALTER TABLE mindmaps ADD COLUMN checkpoint_token TEXT;

ALTER TABLE mindmap_crdt_updates ADD COLUMN room TEXT;

CREATE TABLE mindmap_live_parts (
  mindmap_id TEXT NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  token TEXT NOT NULL,
  revision INTEGER NOT NULL,
  room TEXT NOT NULL,
  cursor INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (mindmap_id, part)
) WITHOUT ROWID;
