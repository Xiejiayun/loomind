import { collectAllTopics, IdSchema, richTextToPlainText, type MindmapDocument } from "@mindmap/core/model";
import { REVIEW_BODY_LIMIT, type ReviewMessage, type ReviewThread } from "../src/drafts/reviews.js";
import { MAP_ID, OWNER_HEADER } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { database, mapPermissionSql, mindmapPermission, visibleMindmap } from "./permissions.js";

const columns = `id, sheet_id AS sheetId, topic_id AS topicId, topic_title AS topicTitle, body, author,
  created_at AS createdAt, resolved_at AS resolvedAt, resolved_by AS resolvedBy`;
const mayRead = "EXISTS (SELECT 1 FROM permit WHERE access IS NOT NULL)";
const mayPost = "EXISTS (SELECT 1 FROM permit WHERE access IN ('owner','editor') OR (access = 'viewer' AND viewersCanComment = 1))";
const pageSize = 40;

function numericId(raw: string) {
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new HttpError(400, "讨论编号无效。");
  return Number(raw);
}

function pageOf<T extends { id: number }>(rows: T[]) {
  return { items: rows.slice(0, pageSize), nextCursor: rows.length > pageSize ? rows[pageSize - 1].id : null };
}

async function reviewInput(request: Request) {
  const input = await readJson(request, 16_384, "评论请求过大。");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "评论请求无效。");
  return input as Record<string, unknown>;
}

function messageBody(input: Record<string, unknown>) {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > REVIEW_BODY_LIMIT) throw new HttpError(400, `评论须为 1–${REVIEW_BODY_LIMIT} 个字符。`);
  return body;
}

export async function handleNodeReviews(request: Request, env: Env, subject: string | undefined, email: unknown, mapId: string, rawId?: string) {
  if (!subject || typeof email !== "string" || !email) throw new HttpError(401, "请先登录后查看评论。");
  if (request.headers.get(OWNER_HEADER) !== subject) throw new HttpError(403, "账号已切换，请刷新页面后重试。");
  if (!MAP_ID.test(mapId)) throw new HttpError(400, "导图 ID 无效。");
  const { method } = request;
  if (!["GET", "POST", "PATCH"].includes(method)) return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, POST, PATCH" });
  if (method !== "GET") requireOrigin(request, env);
  const threadId = rawId === undefined ? null : numericId(rawId);
  const db = database(env);
  const permit = await mindmapPermission(db, subject, mapId);
  if (!permit?.access) throw new HttpError(404, "导图不存在或无权访问。");
  const guarded = (sql: string, ...args: (string | number | null)[]) =>
    db.prepare(`WITH permit AS (${mapPermissionSql}) ${sql}`).bind(subject, mapId, ...args);
  const missing = () => new HttpError(404, "讨论不存在或已移除。");

  if (method === "GET") {
    const rights = { access: permit.access, viewersCanComment: Boolean(permit.viewersCanComment) };
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    const cursor = rawCursor === null ? Number.MAX_SAFE_INTEGER : numericId(rawCursor);
    if (threadId === null) {
      const { results } = await guarded(`SELECT ${columns} FROM mindmap_review_threads WHERE mindmap_id = ?2 AND id < ?3 AND ${mayRead} ORDER BY id DESC LIMIT ?4`,
        cursor, pageSize + 1).all<ReviewThread>();
      const { items, nextCursor } = pageOf(results);
      return json({ ...rights, threads: items, nextCursor });
    }
    const thread = await guarded(`SELECT ${columns} FROM mindmap_review_threads WHERE mindmap_id = ?2 AND id = ?3 AND ${mayRead}`, threadId).first<ReviewThread>();
    if (!thread) throw missing();
    const { results } = await guarded(`SELECT id, author, body, created_at AS createdAt FROM mindmap_review_replies WHERE thread_id = ?3 AND id < ?4 AND ${mayRead} ORDER BY id DESC LIMIT ?5`,
      threadId, cursor, pageSize + 1).all<ReviewMessage>();
    const { items, nextCursor } = pageOf(results);
    return json({ ...rights, thread, replies: items, nextCursor });
  }

  if (method === "PATCH" && threadId === null) {
    if (permit.access !== "owner") throw new HttpError(403, "只有所有者可以更改评论权限。");
    const { viewersCanComment } = await reviewInput(request);
    if (typeof viewersCanComment !== "boolean") throw new HttpError(400, "评论权限设置无效。");
    const changed = await db.prepare("UPDATE mindmaps SET viewers_can_comment = ? WHERE id = ? AND owner = ? RETURNING id")
      .bind(Number(viewersCanComment), mapId, subject).first();
    if (!changed) throw missing();
    return json({ viewersCanComment });
  }
  if (method === "PATCH") {
    if (permit.access === "viewer") throw new HttpError(403, "只有编辑者和所有者可以处理讨论。");
    const { resolved } = await reviewInput(request);
    if (typeof resolved !== "boolean") throw new HttpError(400, "讨论状态无效。");
    const updated = await guarded(`UPDATE mindmap_review_threads SET
      resolved_at = CASE WHEN ?3 THEN COALESCE(resolved_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END,
      resolved_by = CASE WHEN ?3 THEN COALESCE(resolved_by, ?4) ELSE NULL END
      WHERE mindmap_id = ?2 AND id = ?5 AND EXISTS (SELECT 1 FROM permit WHERE access IN ('owner','editor')) RETURNING id`,
      Number(resolved), email, threadId).first();
    if (!updated) throw missing();
    return json(updated);
  }

  if (permit.access === "viewer" && !permit.viewersCanComment) throw new HttpError(403, "所有者尚未允许查看者发表评论。");
  const input = await reviewInput(request);
  const body = messageBody(input);
  if (threadId !== null) {
    const reply = await guarded(`INSERT INTO mindmap_review_replies(thread_id, body, author)
      SELECT id, ?3, ?4 FROM mindmap_review_threads WHERE mindmap_id = ?2 AND id = ?5 AND resolved_at IS NULL AND ${mayPost} RETURNING id`,
      body, email, threadId).first();
    if (!reply) {
      if (!await db.prepare("SELECT id FROM mindmap_review_threads WHERE id = ? AND mindmap_id = ?").bind(threadId, mapId).first()) throw missing();
      throw new HttpError(409, "讨论已解决或权限已更改，请刷新后重试。");
    }
    return json(reply, 201);
  }
  const sheetId = IdSchema.safeParse(input.sheetId);
  const topicId = IdSchema.safeParse(input.topicId);
  if (!sheetId.success || !topicId.success) throw new HttpError(400, "节点或工作表编号无效。");
  const saved = await visibleMindmap(db, subject, mapId);
  if (!saved) throw missing();
  const doc: MindmapDocument = JSON.parse(saved.document);
  const sheet = doc.sheets.find((item) => item.id === sheetId.data);
  const topic = sheet && collectAllTopics(sheet).get(topicId.data);
  if (!topic) throw new HttpError(409, "请先将该节点保存到云端，再发起讨论。");
  const created = await guarded(`INSERT INTO mindmap_review_threads(mindmap_id, sheet_id, topic_id, topic_title, body, author)
    SELECT id, ?3, ?4, ?5, ?6, ?7 FROM mindmaps WHERE id = ?2 AND revision = ?8 AND ${mayPost} RETURNING id`,
    sheet.id, topic.id, richTextToPlainText(topic.title).slice(0, 240), body, email, saved.revision).first();
  if (!created) throw new HttpError(409, "导图或权限已更改，请刷新后重试。");
  return json(created, 201);
}
