CREATE TABLE IF NOT EXISTS mindmaps (
  id TEXT NOT NULL PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  document TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS mindmaps_owner_updated ON mindmaps (owner, updated_at DESC);

INSERT OR IGNORE INTO mindmaps (id, owner, title, revision, document)
SELECT lower(hex(randomblob(16))), owner,
  COALESCE(json_extract(document, '$.sheets[0].title'), '未命名导图'), revision, document
FROM account_drafts;
