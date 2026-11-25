CREATE TABLE workspaces (
  id TEXT NOT NULL PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE INDEX workspaces_owner_created ON workspaces (owner, created_at DESC);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  PRIMARY KEY (workspace_id, subject)
) WITHOUT ROWID;

CREATE INDEX workspace_members_subject ON workspace_members (subject, workspace_id);

CREATE TABLE mindmap_members (
  mindmap_id TEXT NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  PRIMARY KEY (mindmap_id, subject)
) WITHOUT ROWID;

CREATE INDEX mindmap_members_subject ON mindmap_members (subject, mindmap_id);

ALTER TABLE mindmaps ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

CREATE INDEX mindmaps_workspace_updated ON mindmaps (workspace_id, updated_at DESC);

CREATE TABLE share_invites (
  id TEXT NOT NULL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  type TEXT NOT NULL CHECK (type IN ('workspace', 'mindmap')),
  resource_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) WITHOUT ROWID;

CREATE INDEX share_invites_resource ON share_invites (type, resource_id, expires_at DESC);
