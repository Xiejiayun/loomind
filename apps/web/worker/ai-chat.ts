import { MAP_ID, OWNER_HEADER } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { database, mindmapPermission, visibleMindmap } from "./permissions.js";

const MAX_CHAT_BODY = 192 * 1024;
const MAX_MESSAGES_PER_MAP = 100;
const MAX_BATCH_MESSAGES = 40;
const MAX_MSG_PAYLOAD_BYTES = 24 * 1024;
const MSG_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

interface StoredChatRow {
  id: string;
  actor: string;
  role: "user" | "assistant";
  payload: string;
  createdAt: string;
}

function sanitizeIncomingMessage(raw: unknown, actor: string): {
  id: string;
  role: "user" | "assistant";
  payload: string;
  createdAt: string;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!MSG_ID_RE.test(id)) return null;
  const role = obj.role === "user" ? "user" : obj.role === "assistant" ? "assistant" : null;
  if (!role) return null;
  const content = typeof obj.content === "string" ? obj.content.slice(0, 4_000) : "";
  const createdAt =
    typeof obj.createdAt === "string" && obj.createdAt.length <= 40
      ? obj.createdAt
      : new Date().toISOString();

  const clean: Record<string, unknown> = {
    id,
    role,
    content,
    createdAt,
    actor: typeof obj.actor === "string" && obj.actor.trim() ? obj.actor.trim().slice(0, 80) : actor,
  };

  if (typeof obj.contextLabel === "string" && obj.contextLabel.trim()) {
    clean.contextLabel = obj.contextLabel.trim().slice(0, 160);
  }
  if (obj.status === "done" || obj.status === "stopped" || obj.status === "error") {
    clean.status = obj.status;
  }
  if (obj.plan && typeof obj.plan === "object" && !Array.isArray(obj.plan)) {
    const p = obj.plan as Record<string, unknown>;
    const goal = typeof p.goal === "string" ? p.goal.trim().slice(0, 220) : "";
    const approach = typeof p.approach === "string" && p.approach.trim() ? p.approach.trim().slice(0, 280) : undefined;
    const steps = Array.isArray(p.steps)
      ? p.steps
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 120))
          .slice(0, 8)
      : [];
    if (goal || steps.length > 0) {
      clean.plan = { goal: goal || steps[0] || "", ...(approach ? { approach } : {}), steps };
    }
  }
  if (Array.isArray(obj.steps)) {
    const validPhases = new Set(["analyze", "plan", "execute", "verify"]);
    const validStatuses = new Set(["pending", "running", "done", "error"]);
    const steps = obj.steps
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object" && !Array.isArray(s)))
      .slice(0, 24)
      .map((s, idx) => {
        const sid = typeof s.id === "string" && s.id.trim() ? s.id.trim().slice(0, 80) : `s-${idx}`;
        const phase = typeof s.phase === "string" && validPhases.has(s.phase) ? s.phase : "execute";
        const status = typeof s.status === "string" && validStatuses.has(s.status) ? s.status : "done";
        const title = typeof s.title === "string" ? s.title.trim().slice(0, 160) : "";
        const detail = typeof s.detail === "string" && s.detail.trim() ? s.detail.trim().slice(0, 220) : undefined;
        const topicId = typeof s.topicId === "string" && s.topicId.trim() ? s.topicId.trim().slice(0, 120) : undefined;
        const count = typeof s.count === "number" && Number.isFinite(s.count) ? Math.max(0, Math.floor(s.count)) : undefined;
        return {
          id: sid,
          phase,
          title,
          ...(detail ? { detail } : {}),
          status,
          ...(topicId ? { topicId } : {}),
          ...(count !== undefined ? { count } : {}),
        };
      })
      .filter((s) => s.title.length > 0);
    if (steps.length > 0) clean.steps = steps;
  }
  if (obj.outcome && typeof obj.outcome === "object" && !Array.isArray(obj.outcome)) {
    const o = obj.outcome as Record<string, unknown>;
    const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, 300) : "";
    const appliedCount = typeof o.appliedCount === "number" && Number.isFinite(o.appliedCount)
      ? Math.max(0, Math.floor(o.appliedCount))
      : 0;
    const rawStats = (o.stats && typeof o.stats === "object" && !Array.isArray(o.stats) ? o.stats : {}) as Record<string, unknown>;
    const stats: Record<string, unknown> = {
      addedNodes: typeof rawStats.addedNodes === "number" && Number.isFinite(rawStats.addedNodes) ? Math.max(0, Math.floor(rawStats.addedNodes)) : 0,
      updatedNodes: typeof rawStats.updatedNodes === "number" && Number.isFinite(rawStats.updatedNodes) ? Math.max(0, Math.floor(rawStats.updatedNodes)) : 0,
    };
    if (typeof rawStats.layoutChanged === "string" && rawStats.layoutChanged.trim()) {
      stats.layoutChanged = rawStats.layoutChanged.trim().slice(0, 40);
    }
    if (typeof rawStats.paletteChanged === "string" && rawStats.paletteChanged.trim()) {
      stats.paletteChanged = rawStats.paletteChanged.trim().slice(0, 40);
    }
    if (typeof rawStats.durationMs === "number" && Number.isFinite(rawStats.durationMs)) {
      stats.durationMs = Math.max(0, Math.floor(rawStats.durationMs));
    }
    const highlights = Array.isArray(o.highlights)
      ? o.highlights
          .filter((h): h is Record<string, unknown> => Boolean(h && typeof h === "object" && !Array.isArray(h)))
          .slice(0, 8)
          .map((h) => ({
            topicId: typeof h.topicId === "string" ? h.topicId.trim().slice(0, 120) : "",
            title: typeof h.title === "string" ? h.title.trim().slice(0, 120) : "",
          }))
          .filter((h) => h.topicId && h.title)
      : [];
    clean.outcome = { summary, appliedCount, stats, highlights };
  }
  if (obj.mutation && typeof obj.mutation === "object" && !Array.isArray(obj.mutation)) {
    const m = obj.mutation as Record<string, unknown>;
    const summary = typeof m.summary === "string" ? m.summary.trim().slice(0, 260) : "";
    const targetTopicId = typeof m.targetTopicId === "string" && m.targetTopicId.trim() ? m.targetTopicId.trim().slice(0, 120) : undefined;
    if (summary) clean.mutation = { summary, ...(targetTopicId ? { targetTopicId } : {}) };
  }

  const payload = JSON.stringify(clean);
  if (payload.length > MAX_MSG_PAYLOAD_BYTES) return null;
  return { id, role, payload, createdAt };
}

export async function handleAiChat(
  request: Request,
  env: Env,
  subject: string | undefined,
  id: string,
) {
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
    return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, POST, DELETE" });
  }
  if (!subject) throw new HttpError(401, "登录已过期，请重新登录后同步。");
  if (request.headers.get(OWNER_HEADER) !== subject) throw new HttpError(403, "账号已切换，请刷新页面后重试。");
  if (request.method !== "GET") requireOrigin(request, env);
  if (!MAP_ID.test(id)) throw new HttpError(400, "导图 ID 无效。");

  const db = database(env);

  if (request.method === "GET") {
    const visible = await visibleMindmap(db, subject, id);
    if (!visible) return json({ messages: [] });
    const rows = await db.prepare(`
      SELECT id, actor, role, payload, created_at AS createdAt
      FROM mindmap_ai_messages
      WHERE mindmap_id = ?
      ORDER BY seq ASC
      LIMIT ?
    `).bind(id, MAX_MESSAGES_PER_MAP).all<StoredChatRow>();
    const messages = rows.results.flatMap((row) => {
      try {
        const parsed = JSON.parse(row.payload) as Record<string, unknown>;
        return [{ ...parsed, id: row.id, role: row.role, actor: parsed.actor ?? row.actor, createdAt: parsed.createdAt ?? row.createdAt }];
      } catch {
        return [];
      }
    });
    return json({ messages });
  }

  const permit = await mindmapPermission(db, subject, id);
  if (!permit?.access) throw new HttpError(404, "导图不存在或无权访问。");
  if (permit.access !== "owner" && permit.access !== "editor") {
    throw new HttpError(403, "只读协作者不能修改 AI 对话记录。");
  }

  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM mindmap_ai_messages WHERE mindmap_id = ?").bind(id).run();
    return json({ cleared: true });
  }

  const body = await readJson(request, MAX_CHAT_BODY, "AI 对话数据过大。");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "无效的 AI 对话请求体。");
  }
  const rawList = (body as { messages?: unknown }).messages;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new HttpError(400, "缺少要保存的消息列表。");
  }

  const sanitized = rawList
    .slice(0, MAX_BATCH_MESSAGES)
    .map((item) => sanitizeIncomingMessage(item, subject))
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (sanitized.length === 0) {
    throw new HttpError(400, "没有有效的消息可保存。");
  }

  const statements: D1PreparedStatement[] = sanitized.map((msg) =>
    db.prepare(`
      INSERT INTO mindmap_ai_messages (id, mindmap_id, actor, role, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(mindmap_id, id) DO UPDATE SET
        payload = excluded.payload
    `).bind(msg.id, id, subject, msg.role, msg.payload, msg.createdAt),
  );
  statements.push(
    db.prepare(`
      DELETE FROM mindmap_ai_messages WHERE mindmap_id = ? AND seq NOT IN (
        SELECT seq FROM mindmap_ai_messages WHERE mindmap_id = ? ORDER BY seq DESC LIMIT ?
      )
    `).bind(id, id, MAX_MESSAGES_PER_MAP),
  );

  await db.batch(statements);
  return json({ saved: sanitized.length });
}
