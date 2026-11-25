import { MAP_ID } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { database } from "./permissions.js";

type ShareType = "workspace" | "mindmap";
type ShareRole = "viewer" | "editor";
type Invitation = {
  id: string;
  type: ShareType;
  resourceId: string;
  role: ShareRole;
  name: string;
  createdBy: string;
  expiresAt: number;
};

const invitationTtl = 7 * 24 * 60 * 60 * 1000;
const tokenPattern = /^[0-9a-f]{64}$/;
const noReferrer = { "Referrer-Policy": "no-referrer" };

function parseResource(type: unknown, resourceId: unknown): { type: ShareType; resourceId: string } {
  if ((type !== "workspace" && type !== "mindmap") || typeof resourceId !== "string" || !MAP_ID.test(resourceId)) {
    throw new HttpError(400, "分享资源无效。");
  }
  return { type, resourceId };
}

async function requireResourceOwner(db: D1Database, type: ShareType, resourceId: string, subject: string) {
  const query = type === "workspace"
    ? "SELECT name FROM workspaces WHERE id = ? AND owner = ?"
    : "SELECT title AS name FROM mindmaps WHERE id = ? AND owner = ?";
  const resource = await db.prepare(query).bind(resourceId, subject).first<{ name: string }>();
  if (!resource) throw new HttpError(404, "资源不存在或无权分享。");
  return resource;
}

async function tokenHash(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function activeInvitation(db: D1Database, token: string): Promise<Invitation> {
  if (!tokenPattern.test(token)) throw new HttpError(404, "邀请不存在或已过期。");
  const row = await db.prepare(`
    SELECT i.id, i.type, i.resource_id AS resourceId, i.role, i.created_by AS createdBy,
      i.expires_at AS expiresAt, COALESCE(w.name, m.title) AS name
    FROM share_invites i
    LEFT JOIN workspaces w ON i.type = 'workspace' AND w.id = i.resource_id AND w.owner = i.created_by
    LEFT JOIN mindmaps m ON i.type = 'mindmap' AND m.id = i.resource_id AND m.owner = i.created_by
    WHERE i.token_hash = ? AND i.revoked_at IS NULL AND i.expires_at > ?
      AND ((i.type = 'workspace' AND w.id IS NOT NULL) OR (i.type = 'mindmap' AND m.id IS NOT NULL))
  `).bind(await tokenHash(token), Date.now()).first<Invitation>();
  if (!row) throw new HttpError(404, "邀请不存在或已过期。");
  return row;
}

export async function handleShare(request: Request, env: Env, subject: string | undefined, path: string): Promise<Response> {
  if (!subject) throw new HttpError(401, "请先登录后管理分享。");
  const db = database(env);
  if (path === "/api/shares") {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const { type, resourceId } = parseResource(url.searchParams.get("type"), url.searchParams.get("resourceId"));
      await requireResourceOwner(db, type, resourceId, subject);
      const rows = await db.prepare(`
        SELECT id, role, created_at AS createdAt, expires_at AS expiresAt
        FROM share_invites
        WHERE type = ? AND resource_id = ? AND created_by = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC, id
      `).bind(type, resourceId, subject, Date.now())
        .all<{ id: string; role: ShareRole; createdAt: string; expiresAt: number }>();
      return json(rows.results.map((row) => ({ ...row, type, resourceId, expiresAt: new Date(row.expiresAt).toISOString() })));
    }
    if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, POST" });
    requireOrigin(request, env);
    const input = await readJson(request, 2048, "分享请求过大。");
    if (!input || typeof input !== "object" || Array.isArray(input) || !("type" in input) || !("resourceId" in input)) {
      throw new HttpError(400, "分享资源无效。");
    }
    const { type, resourceId } = parseResource(input.type, input.resourceId);
    if (!("role" in input) || (input.role !== "viewer" && input.role !== "editor")) throw new HttpError(400, "分享权限无效。");
    await requireResourceOwner(db, type, resourceId, subject);
    const id = crypto.randomUUID();
    const token = makeToken();
    const expiresAt = Date.now() + invitationTtl;
    await db.prepare(`
      INSERT INTO share_invites (id, token_hash, type, resource_id, role, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, await tokenHash(token), type, resourceId, input.role, subject, expiresAt).run();
    return json({ id, token, role: input.role, expiresAt: new Date(expiresAt).toISOString() }, 201);
  }

  const match = /^\/api\/shares\/([^/]+)$/.exec(path);
  if (!match) return json({ error: "接口不存在。" }, 404);
  if (request.method !== "DELETE") return json({ error: "请求方法不支持。" }, 405, [], { Allow: "DELETE" });
  requireOrigin(request, env);
  if (!MAP_ID.test(match[1])) throw new HttpError(400, "邀请 ID 无效。");
  const result = await db.prepare(`
    UPDATE share_invites SET revoked_at = ?
    WHERE id = ? AND created_by = ? AND revoked_at IS NULL AND (
      (type = 'workspace' AND EXISTS (SELECT 1 FROM workspaces WHERE id = resource_id AND owner = ?)) OR
      (type = 'mindmap' AND EXISTS (SELECT 1 FROM mindmaps WHERE id = resource_id AND owner = ?))
    )
  `).bind(Date.now(), match[1], subject, subject, subject).run();
  if (!result.meta.changes) throw new HttpError(404, "邀请不存在或无权撤销。");
  return json({ revoked: true });
}

export async function handleInvite(request: Request, env: Env, subject: string | undefined, path: string): Promise<Response> {
  const match = /^\/api\/invites\/([^/]+)(\/accept)?$/.exec(path);
  if (!match) return json({ error: "接口不存在。" }, 404);
  const accepting = Boolean(match[2]);
  const allowed = accepting ? "POST" : "GET";
  if (request.method !== allowed) return json({ error: "请求方法不支持。" }, 405, [], { Allow: allowed });
  if (accepting) {
    if (!subject) throw new HttpError(401, "请先登录后接受邀请。");
    requireOrigin(request, env);
  }
  const db = database(env);
  const token = match[1];
  const invite = await activeInvitation(db, token);
  if (!accepting) {
    return json({ type: invite.type, id: invite.resourceId, name: invite.name, role: invite.role,
      expiresAt: new Date(invite.expiresAt).toISOString() }, 200, [], noReferrer);
  }
  if (invite.createdBy !== subject) {
    const query = invite.type === "workspace" ? `
      INSERT INTO workspace_members (workspace_id, subject, role)
      SELECT i.resource_id, ?, i.role FROM share_invites i
      JOIN workspaces w ON w.id = i.resource_id AND w.owner = i.created_by
      WHERE i.id = ? AND i.token_hash = ? AND i.type = 'workspace'
        AND i.revoked_at IS NULL AND i.expires_at > ?
      ON CONFLICT(workspace_id, subject) DO UPDATE SET role =
        CASE WHEN workspace_members.role = 'editor' OR excluded.role = 'editor' THEN 'editor' ELSE 'viewer' END
    ` : `
      INSERT INTO mindmap_members (mindmap_id, subject, role)
      SELECT i.resource_id, ?, i.role FROM share_invites i
      JOIN mindmaps m ON m.id = i.resource_id AND m.owner = i.created_by
      WHERE i.id = ? AND i.token_hash = ? AND i.type = 'mindmap'
        AND i.revoked_at IS NULL AND i.expires_at > ?
      ON CONFLICT(mindmap_id, subject) DO UPDATE SET role =
        CASE WHEN mindmap_members.role = 'editor' OR excluded.role = 'editor' THEN 'editor' ELSE 'viewer' END
    `;
    const result = await db.prepare(query).bind(subject, invite.id, await tokenHash(token), Date.now()).run();
    if (!result.meta.changes) throw new HttpError(404, "邀请不存在或已过期。");
  }
  return json({ accepted: true, type: invite.type, id: invite.resourceId }, 200, [], noReferrer);
}
