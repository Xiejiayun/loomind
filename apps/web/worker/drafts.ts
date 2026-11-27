import { MindmapDocumentSchema, validateDocumentInvariants } from "@mindmap/core/model";
import { DRAFT_LIMIT, DRAFT_SIZE_ERROR, MAP_ID, OWNER_HEADER, mapTitle, type CloudDraft, type MindmapSummary } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { database, mindmapPermission, visibleMindmap, workspaceRole, type Access } from "./permissions.js";

const workspaceHeader = "X-Loomind-Workspace";
const MAX_REVISIONS_PER_MAP = 20;
type ListedMindmap = MindmapSummary & { workspaceId: string | null; access: Access };

export interface StoredRevisionSummary {
  revision: number;
  title: string;
  savedBy: string;
  createdAt: string;
}

export async function handleDraft(request: Request, env: Env, subject: string | undefined, id?: string) {
  const allowed = id ? "GET, PUT, DELETE" : "GET";
  if (!allowed.split(", ").includes(request.method)) return json({ error: "请求方法不支持。" }, 405, [], { Allow: allowed });
  if (!subject) throw new HttpError(401, "登录已过期，请重新登录后同步。");
  // This header only detects a stale browser account; every permission decision uses the signed session subject.
  if (request.headers.get(OWNER_HEADER) !== subject) throw new HttpError(403, "账号已切换，请刷新页面后重试。");
  if (request.method !== "GET") requireOrigin(request, env);
  const db = database(env);
  if (id && !MAP_ID.test(id)) throw new HttpError(400, "导图 ID 无效。");

  if (!id) {
    const rows = await db.prepare(`
      SELECT m.id, m.title, m.updated_at AS updatedAt, m.workspace_id AS workspaceId,
        CASE
          WHEN m.owner = ? THEN 'owner'
          WHEN w.owner = ? OR wm.role = 'editor' OR mm.role = 'editor' THEN 'editor'
          ELSE 'viewer'
        END AS access
      FROM mindmaps m
      LEFT JOIN workspaces w ON w.id = m.workspace_id
      LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.subject = ?
      LEFT JOIN mindmap_members mm ON mm.mindmap_id = m.id AND mm.subject = ?
      WHERE m.owner = ? OR m.workspace_id IN (
        SELECT id FROM workspaces WHERE owner = ?
        UNION SELECT workspace_id FROM workspace_members WHERE subject = ?
      ) OR m.id IN (SELECT mindmap_id FROM mindmap_members WHERE subject = ?)
      ORDER BY m.updated_at DESC, m.id
    `).bind(subject, subject, subject, subject, subject, subject, subject, subject).all<ListedMindmap>();
    return json(rows.results);
  }

  if (request.method === "GET") {
    const row = await visibleMindmap(db, subject, id);
    // Unknown and inaccessible IDs are indistinguishable to the existing create-on-first-save client.
    return json(row ? { revision: row.revision, document: JSON.parse(row.document) } : { revision: 0, document: null } satisfies CloudDraft);
  }

  if (request.method === "DELETE") {
    const results = await db.batch([
      db.prepare("DELETE FROM mindmap_crdt_updates WHERE mindmap_id = ? AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND owner = ?)").bind(id, id, subject),
      db.prepare("DELETE FROM mindmap_presence WHERE mindmap_id = ? AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND owner = ?)").bind(id, id, subject),
      db.prepare("DELETE FROM mindmap_revisions WHERE mindmap_id = ? AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND owner = ?)").bind(id, id, subject),
      db.prepare("DELETE FROM share_invites WHERE type = 'mindmap' AND resource_id = ? AND created_by = ?").bind(id, subject),
      db.prepare("DELETE FROM mindmaps WHERE id = ? AND owner = ?").bind(id, subject),
    ]);
    if (!results[4].meta.changes) throw new HttpError(404, "导图不存在或无权删除。");
    return json({ deleted: true });
  }

  const match = /^"(0|[1-9]\d{0,14})"$/.exec(request.headers.get("If-Match") ?? "");
  if (!match) throw new HttpError(428, "请先读取云端版本。");
  const revision = Number(match[1]);
  const requestedWorkspace = request.headers.get(workspaceHeader);
  if (requestedWorkspace !== null && (!MAP_ID.test(requestedWorkspace) || revision !== 0)) {
    throw new HttpError(400, "仅新建导图时可指定有效的工作空间 ID。");
  }
  const input = await readJson(request, DRAFT_LIMIT, DRAFT_SIZE_ERROR);
  let document: string;
  let title: string;
  try {
    const parsed = MindmapDocumentSchema.safeParse(input);
    if (!parsed.success || validateDocumentInvariants(parsed.data).length) throw new HttpError(422, "导图格式无效，未写入云端。");
    document = JSON.stringify(parsed.data);
    title = mapTitle(parsed.data);
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(422, "导图层级过深，未写入云端。");
    throw error;
  }

  let result: D1Result;
  if (revision === 0 && requestedWorkspace !== null) {
    const role = await workspaceRole(db, subject, requestedWorkspace);
    if (role !== "owner" && role !== "editor") throw new HttpError(403, "没有在该工作空间新建导图的权限。");
    result = await db.prepare(`
      INSERT INTO mindmaps (id, owner, title, revision, document, workspace_id)
      SELECT ?, ?, ?, 1, ?, w.id
      FROM workspaces w
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.subject = ?
      WHERE w.id = ? AND (w.owner = ? OR wm.role = 'editor')
      ON CONFLICT(id) DO NOTHING
    `).bind(id, subject, title, document, subject, requestedWorkspace, subject).run();
  } else if (revision === 0) {
    result = await db.prepare("INSERT INTO mindmaps (id, owner, title, revision, document) VALUES (?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING")
      .bind(id, subject, title, document).run();
  } else {
    const permit = await mindmapPermission(db, subject, id);
    if (permit && permit.access !== "owner" && permit.access !== "editor") throw new HttpError(403, "没有编辑该导图的权限。");
    result = await db.prepare(`
      UPDATE mindmaps SET document = ?, title = ?, revision = revision + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND revision = ? AND (
        owner = ? OR EXISTS (
          SELECT 1 FROM workspaces w
          LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.subject = ?
          WHERE w.id = mindmaps.workspace_id AND (w.owner = ? OR wm.role = 'editor')
        ) OR EXISTS (
          SELECT 1 FROM mindmap_members mm
          WHERE mm.mindmap_id = mindmaps.id AND mm.subject = ? AND mm.role = 'editor'
        )
      )
    `).bind(document, title, id, revision, subject, subject, subject, subject).run();
  }
  if (!result.meta.changes) throw new HttpError(409, "另一处已修改云端草稿，未覆盖任何云端内容。");
  const nextRevision = revision + 1;
  await db.batch([
    db.prepare(
      "INSERT OR REPLACE INTO mindmap_revisions (mindmap_id, revision, title, document, saved_by) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, nextRevision, title, document, subject),
    db.prepare(
      `DELETE FROM mindmap_revisions WHERE mindmap_id = ? AND revision NOT IN (
        SELECT revision FROM mindmap_revisions WHERE mindmap_id = ? ORDER BY revision DESC LIMIT ?
      )`,
    ).bind(id, id, MAX_REVISIONS_PER_MAP),
  ]);
  return json({ revision: nextRevision });
}

export async function handleRevisions(
  request: Request,
  env: Env,
  subject: string | undefined,
  id: string,
  revParam?: string,
) {
  if (request.method !== "GET") return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET" });
  if (!subject) throw new HttpError(401, "登录已过期，请重新登录后同步。");
  if (request.headers.get(OWNER_HEADER) !== subject) throw new HttpError(403, "账号已切换，请刷新页面后重试。");
  if (!MAP_ID.test(id)) throw new HttpError(400, "导图 ID 无效。");

  const db = database(env);
  const current = await visibleMindmap(db, subject, id);
  if (!current) throw new HttpError(404, "导图不存在或无权访问。");

  if (!revParam) {
    const rows = await db.prepare(`
      SELECT revision, title, saved_by AS savedBy, created_at AS createdAt
      FROM mindmap_revisions
      WHERE mindmap_id = ?
      ORDER BY revision DESC
      LIMIT ?
    `).bind(id, MAX_REVISIONS_PER_MAP).all<StoredRevisionSummary>();

    if (rows.results.length > 0) {
      return json(rows.results);
    }

    // Legacy fallback for mindmaps saved before 0006_mindmap_revisions
    const meta = await db.prepare("SELECT title, owner, updated_at AS updatedAt FROM mindmaps WHERE id = ?")
      .bind(id).first<{ title: string; owner: string; updatedAt: string }>();
    if (!meta) return json([]);
    return json([{
      revision: current.revision,
      title: meta.title,
      savedBy: meta.owner,
      createdAt: meta.updatedAt,
    } satisfies StoredRevisionSummary]);
  }

  if (!/^[1-9]\d{0,14}$/.test(revParam)) throw new HttpError(400, "版本号无效。");
  const targetRevision = Number(revParam);
  const entry = await db.prepare(`
    SELECT revision, title, saved_by AS savedBy, created_at AS createdAt, document
    FROM mindmap_revisions
    WHERE mindmap_id = ? AND revision = ?
  `).bind(id, targetRevision).first<StoredRevisionSummary & { document: string }>();

  if (entry) {
    return json({
      revision: entry.revision,
      title: entry.title,
      savedBy: entry.savedBy,
      createdAt: entry.createdAt,
      document: JSON.parse(entry.document),
    });
  }

  if (targetRevision === current.revision) {
    const meta = await db.prepare("SELECT title, owner, updated_at AS updatedAt FROM mindmaps WHERE id = ?")
      .bind(id).first<{ title: string; owner: string; updatedAt: string }>();
    if (meta) {
      return json({
        revision: current.revision,
        title: meta.title,
        savedBy: meta.owner,
        createdAt: meta.updatedAt,
        document: JSON.parse(current.document),
      });
    }
  }

  throw new HttpError(404, "历史版本不存在或已过期。");
}
