ALTER TABLE mindmaps ADD COLUMN save_token TEXT;

CREATE TABLE mindmap_document_blocks (
  mindmap_id TEXT NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (mindmap_id, digest)
) WITHOUT ROWID;
