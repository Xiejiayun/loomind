import { HttpError } from "./http.js";

export type Access = "owner" | "editor" | "viewer";

export function database(env: Env): D1Database {
  if (!env.DB) throw new HttpError(503, "云存储尚未连接。");
  return env.DB;
}

export async function workspaceRole(db: D1Database, subject: string, id: string): Promise<Access | null> {
  const row = await db.prepare(`
    SELECT CASE WHEN w.owner = ? THEN 'owner' ELSE wm.role END AS role
    FROM workspaces w
    LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.subject = ?
    WHERE w.id = ?
  `).bind(subject, subject, id).first<{ role: Access | null }>();
  return row?.role ?? null;
}

export async function mindmapPermission(db: D1Database, subject: string, id: string) {
  return db.prepare(`
    SELECT m.owner, m.workspace_id AS workspaceId,
      CASE
        WHEN m.owner = ? THEN 'owner'
        WHEN w.owner = ? OR wm.role = 'editor' OR mm.role = 'editor' THEN 'editor'
        WHEN wm.role = 'viewer' OR mm.role = 'viewer' THEN 'viewer'
        ELSE NULL
      END AS access
    FROM mindmaps m
    LEFT JOIN workspaces w ON w.id = m.workspace_id
    LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.subject = ?
    LEFT JOIN mindmap_members mm ON mm.mindmap_id = m.id AND mm.subject = ?
    WHERE m.id = ?
  `).bind(subject, subject, subject, subject, id)
    .first<{ owner: string; workspaceId: string | null; access: Access | null }>();
}

export async function visibleMindmap(db: D1Database, subject: string, id: string) {
  return db.prepare(`
    SELECT m.revision, m.document FROM mindmaps m
    WHERE m.id = ? AND (
      m.owner = ? OR EXISTS (
        SELECT 1 FROM workspaces w
        WHERE w.id = m.workspace_id AND (
          w.owner = ? OR EXISTS (
            SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.subject = ?
          )
        )
      ) OR EXISTS (
        SELECT 1 FROM mindmap_members mm WHERE mm.mindmap_id = m.id AND mm.subject = ?
      )
    )
  `).bind(id, subject, subject, subject, subject).first<{ revision: number; document: string }>();
}
