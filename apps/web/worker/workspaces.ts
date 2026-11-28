import { MAP_ID, OWNER_HEADER } from "../src/drafts/shared.js";
import { PERSONAL, SHARED, type WorkspaceSummary } from "../src/workspace-groups.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { database, workspaceRole } from "./permissions.js";
import { workspaceTemplates } from "./workspace-templates.js";

async function visibleWorkspaces(db: D1Database, subject: string) {
  const rows = await db.prepare(`
    SELECT w.id, w.name, w.created_at AS createdAt,
      CASE WHEN w.owner = ? THEN 'owner' ELSE wm.role END AS role
    FROM workspaces w
    LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.subject = ?
    WHERE w.owner = ? OR w.id IN (SELECT workspace_id FROM workspace_members WHERE subject = ?)
    ORDER BY w.created_at DESC, w.id
  `).bind(subject, subject, subject, subject).all<WorkspaceSummary>();
  return rows.results;
}

export async function handleWorkspace(request: Request, env: Env, subject: string | undefined, path: string): Promise<Response> {
  if (!subject) throw new HttpError(401, "请先登录后访问工作空间。");
  const db = database(env);
  const templateRoute = /^\/api\/workspaces\/([^/]+)\/templates(?:\/([^/]+)(?:\/(copies))?)?$/.exec(path);
  if (templateRoute) return workspaceTemplates(request, env, db, subject, templateRoute[1], templateRoute[2], templateRoute[3]);
  if (path === "/api/workspaces/order") {
    if (request.headers.get(OWNER_HEADER) !== subject) throw new HttpError(403, "账号已切换，请刷新页面后重试。");
    if (request.method === "GET") {
      const saved = await db.prepare("SELECT space_order FROM workspace_sidebar_orders WHERE subject = ?").bind(subject).first<string>("space_order");
      return json(saved ? JSON.parse(saved) : []);
    }
    if (request.method !== "PUT") return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, PUT" });
    requireOrigin(request, env);
    const order = await readJson(request, 64 * 1024, "工作区排序过长。");
    if (!Array.isArray(order) || !order.includes(PERSONAL) || !order.includes(SHARED) || new Set(order).size !== order.length ||
        !order.every((id) => typeof id === "string" && (id === PERSONAL || id === SHARED || MAP_ID.test(id)))) {
      throw new HttpError(400, "工作区排序无效。");
    }
    const allowed = new Set([PERSONAL, SHARED, ...(await visibleWorkspaces(db, subject)).map((space) => space.id)]);
    if (order.some((id) => !allowed.has(id))) throw new HttpError(409, "工作区列表已更改，请刷新后重试。");
    await db.prepare(`INSERT INTO workspace_sidebar_orders (subject, space_order) VALUES (?, ?)
      ON CONFLICT(subject) DO UPDATE SET space_order = excluded.space_order`).bind(subject, JSON.stringify(order)).run();
    return json(order);
  }
  if (path === "/api/workspaces") {
    if (request.method === "GET") return json(await visibleWorkspaces(db, subject));
    if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, POST" });
    requireOrigin(request, env);
    const input = await readJson(request, 1024, "工作空间名称过长。");
    const name = input && typeof input === "object" && !Array.isArray(input) && "name" in input && typeof input.name === "string"
      ? input.name.trim() : "";
    if (!name || [...name].length > 80 || new TextEncoder().encode(name).length > 240 || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw new HttpError(400, "工作空间名称须为 1 至 80 个字符。");
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.prepare("INSERT INTO workspaces (id, owner, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, subject, name, createdAt).run();
    return json({ id, name, role: "owner", createdAt } satisfies WorkspaceSummary, 201);
  }

  const match = /^\/api\/workspaces\/([^/]+)\/mindmaps$/.exec(path);
  if (!match) return json({ error: "接口不存在。" }, 404);
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, [], { Allow: "POST" });
  requireOrigin(request, env);
  const workspaceId = match[1];
  if (!MAP_ID.test(workspaceId)) throw new HttpError(400, "工作空间 ID 无效。");
  const input = await readJson(request, 2048, "请求过大。");
  const mindmapId = input && typeof input === "object" && !Array.isArray(input) && "mindmapId" in input ? input.mindmapId : null;
  if (typeof mindmapId !== "string" || !MAP_ID.test(mindmapId)) throw new HttpError(400, "导图 ID 无效。");
  const role = await workspaceRole(db, subject, workspaceId);
  if (role !== "owner" && role !== "editor") throw new HttpError(403, "没有向该工作空间添加导图的权限。");
  const result = await db.prepare(`
    UPDATE mindmaps SET workspace_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND owner = ? AND EXISTS (
      SELECT 1 FROM workspaces w
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.subject = ?
      WHERE w.id = ? AND (w.owner = ? OR wm.role = 'editor')
    )
  `).bind(workspaceId, mindmapId, subject, subject, workspaceId, subject).run();
  if (!result.meta.changes) throw new HttpError(404, "导图不存在或无权移动。");
  return json({ id: mindmapId, workspaceId });
}
