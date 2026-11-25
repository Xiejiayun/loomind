import { MindmapDocumentSchema, validateDocumentInvariants } from "@mindmap/core/model";
import { DRAFT_LIMIT, DRAFT_SIZE_ERROR, MAP_ID, OWNER_HEADER, mapTitle, type CloudDraft, type MindmapSummary } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";

export async function handleDraft(request: Request, env: Env, subject: string | undefined, id?: string) {
  if (!["GET", "PUT"].includes(request.method)) return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, PUT" });
  if (!subject) throw new HttpError(401, "登录已过期，请重新登录后同步。");
  if (request.headers.get(OWNER_HEADER) !== subject) throw new HttpError(403, "账号已切换，请刷新页面后重试。");
  if (request.method === "PUT") requireOrigin(request, env);
  if (!env.DB) throw new HttpError(503, "云存储尚未连接。");
  if (id && !MAP_ID.test(id)) throw new HttpError(400, "导图 ID 无效。");
  if (!id && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, title, updated_at AS updatedAt FROM mindmaps WHERE owner = ? ORDER BY updated_at DESC")
      .bind(subject).all<MindmapSummary>();
    return json(rows.results);
  }
  if (!id) throw new HttpError(405, "请求方法不支持。");
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT revision, document FROM mindmaps WHERE owner = ? AND id = ?").bind(subject, id)
      .first<{ revision: number; document: string }>();
    return json(row ? { revision: row.revision, document: JSON.parse(row.document) } : { revision: 0, document: null } satisfies CloudDraft);
  }
  const match = /^"(0|[1-9]\d{0,14})"$/.exec(request.headers.get("If-Match") ?? "");
  if (!match) throw new HttpError(428, "请先读取云端版本。");
  const revision = Number(match[1]);
  const input = await readJson(request, DRAFT_LIMIT, DRAFT_SIZE_ERROR);
  let document;
  let title;
  try {
    const parsed = MindmapDocumentSchema.safeParse(input);
    if (!parsed.success || validateDocumentInvariants(parsed.data).length) throw new HttpError(422, "导图格式无效，未写入云端。");
    document = JSON.stringify(parsed.data);
    title = mapTitle(parsed.data);
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(422, "导图层级过深，未写入云端。");
    throw error;
  }
  const statement = revision === 0
    ? env.DB.prepare("INSERT INTO mindmaps (id, owner, title, revision, document) VALUES (?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING").bind(id, subject, title, document)
    : env.DB.prepare("UPDATE mindmaps SET document = ?, title = ?, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE owner = ? AND id = ? AND revision = ?").bind(document, title, subject, id, revision);
  const result = await statement.run();
  if (!result.meta.changes) throw new HttpError(409, "另一处已修改云端草稿，未覆盖任何云端内容。");
  return json({ revision: revision + 1 });
}
