CREATE TABLE workspace_templates (
  id TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  document TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE INDEX workspace_templates_listing ON workspace_templates (workspace_id, created_at DESC, id);

CREATE TABLE workspace_template_blocks (
  template_id TEXT NOT NULL REFERENCES workspace_templates(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (template_id, digest)
) WITHOUT ROWID;
