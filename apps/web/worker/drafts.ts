import { MindmapDocumentSchema, validateDocumentInvariants } from "@mindmap/core/model";
import { DRAFT_LIMIT, DRAFT_SIZE_ERROR, LIVE_HEADER, MAP_ID, MAX_CHECKPOINT_B64, OWNER_HEADER, mapTitle, type CloudDraft, type MindmapSummary } from "../src/drafts/shared.js";
import { assembleCheckpoint, checkpointQuery, parseCheckpoint, replaceCheckpoint } from "./checkpoints.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { packDocument, pruneBlocks, unpackDocument, writeBlocks } from "./document-storage.js";
import { database, mapAccessSql, mindmapPermission, visibleMindmap, visibleMindmapQuery, workspaceRole, type Access } from "./permissions.js";
import { knownRevision, snapshotResponse } from "./snapshot-response.js";

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
    if (request.headers.has(LIVE_HEADER)) {
      const [head, parts] = await db.batch([visibleMindmapQuery(db, subject, id), checkpointQuery(db, subject, id)]);
      const row = head.results[0] as { revision: number; document: string } | undefined;
      return json(row ? { revision: row.revision, document: await unpackDocument(db, id, row.document), checkpoint: assembleCheckpoint(parts.results as { room: string; cursor: number; payload: string }[]) } : { revision: 0, document: null });
    }
    const known = knownRevision(request);
    const row = await visibleMindmap(db, subject, id, known);
    // Unknown and inaccessible IDs are indistinguishable to the existing create-on-first-save client.
    return row ? snapshotResponse(db, id, row, known) : json({ revision: 0, document: null } satisfies CloudDraft);
  }

  if (request.method === "DELETE") {
    const results = await db.batch([
      db.prepare("DELETE FROM mindmap_ai_messages WHERE mindmap_id = ? AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND owner = ?)").bind(id, id, subject),
      db.prepare("DELETE FROM mindmap_crdt_updates WHERE mindmap_id = ? AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND owner = ?)").bind(id, id, subject),
      db.prepare("DELETE FROM mindmap_presence WHERE mindmap_id = ? AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND owner = ?)").bind(id, id, subject),
      db.prepare("DELETE FROM mindmap_revisions WHERE mindmap_id = ? AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND owner = ?)").bind(id, id, subject),
      db.prepare("DELETE FROM share_invites WHERE type = 'mindmap' AND resource_id = ? AND created_by = ?").bind(id, subject),
      db.prepare("DELETE FROM mindmaps WHERE id = ? AND owner = ?").bind(id, subject),
    ]);
    if (!results[5].meta.changes) throw new HttpError(404, "导图不存在或无权删除。");
    return json({ deleted: true });
  }

  const match = /^"(0|[1-9]\d{0,14})"$/.exec(request.headers.get("If-Match") ?? "");
  if (!match) throw new HttpError(428, "请先读取云端版本。");
  const revision = Number(match[1]);
  const requestedWorkspace = request.headers.get(workspaceHeader);
  if (requestedWorkspace !== null && (!MAP_ID.test(requestedWorkspace) || revision !== 0)) {
    throw new HttpError(400, "仅新建导图时可指定有效的工作空间 ID。");
  }
  if (requestedWorkspace !== null) {
    const role = await workspaceRole(db, subject, requestedWorkspace);
    if (role !== "owner" && role !== "editor") throw new HttpError(403, "没有在该工作空间新建导图的权限。");
  } else if (revision !== 0) {
    const permit = await mindmapPermission(db, subject, id);
    if (permit && permit.access !== "owner" && permit.access !== "editor") throw new HttpError(403, "没有编辑该导图的权限。");
  }
  const live = request.headers.get(LIVE_HEADER);
  if (live !== null && live !== "1" && live !== "seed") throw new HttpError(400, "协作快照请求无效。");
  const input = await readJson(request, live ? DRAFT_LIMIT + MAX_CHECKPOINT_B64 + 1024 : DRAFT_LIMIT, DRAFT_SIZE_ERROR);
  const checkpoint = live ? parseCheckpoint((input as { checkpoint?: unknown } | null)?.checkpoint) : undefined;
  const token = crypto.randomUUID();
  if ((revision === 0 || live === "seed") && checkpoint && checkpoint.cursor !== 0) throw new HttpError(422, "初始协作快照的游标必须为零。");
  if (live === "seed" && checkpoint) {
    const [claimed] = await db.batch([db.prepare(`UPDATE mindmaps AS m SET checkpoint_token = ? WHERE m.id = ? AND m.revision = ?
      AND ${mapAccessSql(true)} AND NOT EXISTS (SELECT 1 FROM mindmap_live_parts WHERE mindmap_id = m.id AND part = 0 AND revision = m.revision)`)
      .bind(token, id, revision, subject, subject, subject, subject), ...replaceCheckpoint(db, id, token, checkpoint)]);
    if (!claimed.meta.changes) throw new HttpError(409, "请重新读取协作快照。");
    return json({ revision, room: checkpoint.room });
  }
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

  const { stored, blocks, indexTitle } = await packDocument(document, title);
  let save: D1PreparedStatement;
  if (revision === 0 && requestedWorkspace !== null) {
    save = db.prepare(`
      INSERT INTO mindmaps (id, owner, title, revision, document, save_token, checkpoint_token, workspace_id)
      SELECT ?, ?, ?, 1, ?, ?, ?, w.id
      FROM workspaces w
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.subject = ?
      WHERE w.id = ? AND (w.owner = ? OR wm.role = 'editor')
      ON CONFLICT(id) DO NOTHING
    `).bind(id, subject, indexTitle, stored, token, token, subject, requestedWorkspace, subject);
  } else if (revision === 0) {
    save = db.prepare("INSERT INTO mindmaps (id, owner, title, revision, document, save_token, checkpoint_token) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(id, subject, indexTitle, stored, token, token);
  } else {
    save = db.prepare(`
      UPDATE mindmaps AS m SET document = ?, title = ?, save_token = ?, checkpoint_token = ?, revision = revision + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE m.id = ? AND m.revision = ? AND ${mapAccessSql(true)} AND (? IS NULL OR EXISTS (
        SELECT 1 FROM mindmap_live_parts part WHERE part.mindmap_id = m.id AND part.part = 0 AND part.revision = m.revision AND part.room = ?
          AND (? <= part.cursor OR EXISTS (SELECT 1 FROM mindmap_crdt_updates u WHERE u.mindmap_id = m.id AND u.room = part.room AND u.seq >= ?))
      ))
    `).bind(stored, indexTitle, token, token, id, revision, subject, subject, subject, subject,
      checkpoint?.room ?? null, checkpoint?.room ?? null, checkpoint?.cursor ?? 0, checkpoint?.cursor ?? 0);
  }
  const nextRevision = revision + 1;
  // Only the successful compare-and-swap sets this token; a stale writer changes nothing in the batch.
  const [result] = await db.batch([
    save, ...writeBlocks(db, id, token, blocks), ...replaceCheckpoint(db, id, token, checkpoint),
    db.prepare(`INSERT INTO mindmap_revisions (mindmap_id, revision, title, document, saved_by)
      SELECT id, revision, title, document, ? FROM mindmaps WHERE id = ? AND save_token = ?`).bind(subject, id, token),
    ...(nextRevision > MAX_REVISIONS_PER_MAP ? [
      db.prepare(`DELETE FROM mindmap_revisions WHERE mindmap_id = ? AND revision NOT IN (
          SELECT revision FROM mindmap_revisions WHERE mindmap_id = ? ORDER BY revision DESC LIMIT ?
        ) AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND save_token = ?)`)
        .bind(id, id, MAX_REVISIONS_PER_MAP, id, token),
      pruneBlocks(db, id, token),
    ] : []),
  ]);
  if (!result.meta.changes) throw new HttpError(409, "另一处已修改云端草稿，未覆盖任何云端内容。");
  return json({ revision: nextRevision, ...(checkpoint && { room: checkpoint.room }) });
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
  if (revParam && !/^[1-9]\d{0,14}$/.test(revParam)) throw new HttpError(400, "版本号无效。");
  const { results } = await db.prepare(`
    WITH visible AS (
      SELECT m.id, m.revision, m.title, m.owner AS savedBy, m.updated_at AS createdAt ${revParam ? ", m.document" : ""}
      FROM mindmaps m WHERE m.id = ? AND ${mapAccessSql()}
    ), versions AS (
      SELECT r.revision, r.title, r.saved_by AS savedBy, r.created_at AS createdAt ${revParam ? ", r.document" : ""}
      FROM mindmap_revisions r JOIN visible m ON m.id = r.mindmap_id
      UNION ALL
      SELECT m.revision, m.title, m.savedBy, m.createdAt ${revParam ? ", m.document" : ""}
      FROM visible m WHERE NOT EXISTS (SELECT 1 FROM mindmap_revisions r WHERE r.mindmap_id = m.id AND r.revision = m.revision)
    )
    SELECT * FROM versions ${revParam ? "WHERE revision = ?" : ""} ORDER BY revision DESC LIMIT ?
  `).bind(id, subject, subject, subject, subject, ...(revParam ? [Number(revParam), 1] : [MAX_REVISIONS_PER_MAP]))
    .all<StoredRevisionSummary & { document: string }>();
  if (!results.length) throw new HttpError(404, "导图或历史版本不可用。");
  if (!revParam) return json(results);
  const entry = results[0];
  return json({ ...entry, document: await unpackDocument(db, id, entry.document) });
}
