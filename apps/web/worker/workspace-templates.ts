import { MAP_ID } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { workspaceRole } from "./permissions.js";

const capacity = 50;
const access = (write: boolean) => `EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ?1 AND (w.owner = ?2 OR EXISTS (
  SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.subject = ?2 ${write ? "AND wm.role = 'editor'" : ""}
)))`;

export async function workspaceTemplates(request: Request, env: Env, db: D1Database, subject: string, workspace: string, template?: string, copies?: string) {
  if (!MAP_ID.test(workspace) || (template && !MAP_ID.test(template))) throw new HttpError(404, "模板不存在。");
  const methods = !template ? ["GET", "POST"] : copies ? ["POST"] : ["DELETE"];
  if (!methods.includes(request.method)) return json({ error: "请求方法不支持。" }, 405, [], { Allow: methods.join(", ") });
  const role = await workspaceRole(db, subject, workspace);
  if (!role) throw new HttpError(404, "工作空间不存在或无权访问。");
  if (request.method === "GET") {
    const list = await db.prepare(`SELECT id, substr(title, 1, 120) AS title, created_at AS createdAt FROM workspace_templates
      WHERE workspace_id = ?1 AND ${access(false)} ORDER BY created_at DESC, id`).bind(workspace, subject).all();
    return json(list.results);
  }
  requireOrigin(request, env);
  if (role === "viewer") throw new HttpError(403, "只有该工作空间的编辑者可以管理模板或创建副本。");
  if (request.method === "DELETE") {
    const result = await db.prepare(`DELETE FROM workspace_templates WHERE workspace_id = ?1 AND id = ?3 AND ${access(true)}`)
      .bind(workspace, subject, template).run();
    if (!result.meta.changes) throw new HttpError(404, "模板不存在。");
    return json({ deleted: true });
  }

  const id = crypto.randomUUID();
  if (!template) {
    const input = await readJson(request, 1024, "请求过大。");
    const source = input && typeof input === "object" && "mindmapId" in input ? input.mindmapId : null;
    if (typeof source !== "string" || !MAP_ID.test(source)) throw new HttpError(400, "无效的来源导图。");
    const [saved] = await db.batch([
      db.prepare(`INSERT INTO workspace_templates (id, workspace_id, title, document)
        SELECT ?4, m.workspace_id, m.title, m.document FROM mindmaps m WHERE m.workspace_id = ?1 AND m.id = ?3 AND ${access(true)}
        AND (SELECT count(*) FROM workspace_templates WHERE workspace_id = ?1) < ?5`).bind(workspace, subject, source, id, capacity),
      db.prepare(`INSERT INTO workspace_template_blocks (template_id, digest, content)
        SELECT DISTINCT t.id, part.value, block.content FROM workspace_templates t,
          json_each(CASE WHEN substr(t.document, 1, 1) = '[' THEN t.document ELSE '[]' END) AS part
        LEFT JOIN mindmap_document_blocks block ON block.mindmap_id = ? AND block.digest = part.value
        WHERE t.id = ?`).bind(source, id),
    ]);
    if (!saved.meta.changes) {
      const count = await db.prepare(`SELECT count(*) AS count FROM workspace_templates WHERE workspace_id = ?1 AND ${access(true)}`).bind(workspace, subject).first<number>("count");
      if (count === capacity) throw new HttpError(409, "工作空间已保存 50 个模板，请先删除旧模板。");
      throw new HttpError(404, "未找到该工作空间内已保存的导图。");
    }
    return json({ id }, 201);
  }

  const token = crypto.randomUUID();
  const [created] = await db.batch<{ title: string }>([
    db.prepare(`INSERT INTO mindmaps (id, owner, title, revision, document, workspace_id, save_token)
      SELECT ?4, ?2, title, 1, document, workspace_id, ?5 FROM workspace_templates WHERE workspace_id = ?1 AND id = ?3 AND ${access(true)}
      RETURNING substr(title, 1, 120) AS title`).bind(workspace, subject, template, id, token),
    db.prepare(`INSERT INTO mindmap_document_blocks (mindmap_id, digest, content)
      SELECT DISTINCT m.id, part.value, block.content FROM mindmaps m,
        json_each(CASE WHEN substr(m.document, 1, 1) = '[' THEN m.document ELSE '[]' END) AS part
      LEFT JOIN workspace_template_blocks block ON block.template_id = ? AND block.digest = part.value
      WHERE m.id = ? AND m.save_token = ?`).bind(template, id, token),
    db.prepare(`INSERT INTO mindmap_revisions (mindmap_id, revision, title, document, saved_by)
      SELECT id, revision, title, document, owner FROM mindmaps WHERE id = ? AND save_token = ?`).bind(id, token),
  ]);
  if (!created.results.length) throw new HttpError(404, "模板不存在或无权创建副本。");
  return json({ id, title: created.results[0].title, workspaceId: workspace }, 201);
}
