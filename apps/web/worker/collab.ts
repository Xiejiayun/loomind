import { MAP_ID, OWNER_HEADER } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { canViewMindmap, database, mindmapPermission } from "./permissions.js";

const MAX_COLLAB_BODY = 256 * 1024;
const MAX_UPDATE_B64_LEN = 192 * 1024;
const MAX_UPDATES_PER_MAP = 200;
const PRESENCE_TTL_MS = 20_000;
const PRESENCE_PRUNE_MS = 60_000;
const PEER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6,8}$/;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

export interface CollabUpdateRow {
  seq: number;
  peerId: string;
  actor: string;
  updateB64: string;
}

export interface CollabPeerRecord {
  peerId: string;
  name: string;
  color: string;
  selectedTopicIds: string[];
  updatedAt: number;
}

function parsePeerRow(row: {
  peerId: string;
  displayName: string;
  color: string;
  selectedJson: string;
  updatedAt: number;
}): CollabPeerRecord {
  let selectedTopicIds: string[] = [];
  try {
    const parsed = JSON.parse(row.selectedJson) as unknown;
    if (Array.isArray(parsed)) {
      selectedTopicIds = parsed.filter((x): x is string => typeof x === "string").slice(0, 20);
    }
  } catch {
    selectedTopicIds = [];
  }
  return {
    peerId: row.peerId,
    name: row.displayName,
    color: row.color,
    selectedTopicIds,
    updatedAt: row.updatedAt,
  };
}

async function listActivePeers(db: D1Database, mapId: string, nowMs: number): Promise<CollabPeerRecord[]> {
  const cutoff = nowMs - PRESENCE_TTL_MS;
  const rows = await db.prepare(`
    SELECT peer_id AS peerId, display_name AS displayName, color, selected_json AS selectedJson, updated_at AS updatedAt
    FROM mindmap_presence
    WHERE mindmap_id = ? AND updated_at >= ?
    ORDER BY updated_at DESC
    LIMIT 24
  `).bind(mapId, cutoff).all<{
    peerId: string;
    displayName: string;
    color: string;
    selectedJson: string;
    updatedAt: number;
  }>();
  return rows.results.map(parsePeerRow);
}

export async function handleCollab(
  request: Request,
  env: Env,
  subject: string | undefined,
  id: string,
) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, POST" });
  }
  if (!subject) throw new HttpError(401, "登录已过期，请重新登录后同步。");
  if (request.headers.get(OWNER_HEADER) !== subject) throw new HttpError(403, "账号已切换，请刷新页面后重试。");
  if (request.method === "POST") requireOrigin(request, env);
  if (!MAP_ID.test(id)) throw new HttpError(400, "导图 ID 无效。");

  const db = database(env);
  const nowMs = Date.now();

  if (request.method === "GET") {
    const visible = await canViewMindmap(db, subject, id);
    if (!visible) throw new HttpError(404, "导图不存在或无权访问。");

    const url = new URL(request.url);
    const sinceRaw = url.searchParams.get("since") ?? "0";
    const since = /^\d{1,15}$/.test(sinceRaw) ? Number(sinceRaw) : 0;

    const [updatesRes, peers] = await Promise.all([
      db.prepare(`
        SELECT seq, peer_id AS peerId, actor, update_b64 AS updateB64
        FROM mindmap_crdt_updates
        WHERE mindmap_id = ? AND seq > ?
        ORDER BY seq ASC
        LIMIT 100
      `).bind(id, since).all<CollabUpdateRow>(),
      listActivePeers(db, id, nowMs),
    ]);

    const updates = updatesRes.results;
    const latestSeq = updates.length > 0 ? updates[updates.length - 1].seq : since;
    return json({ latestSeq, updates, peers });
  }

  // POST: publish CRDT delta and/or heartbeat presence
  const permit = await mindmapPermission(db, subject, id);
  if (!permit?.access) throw new HttpError(404, "导图不存在或无权访问。");

  const body = await readJson(request, MAX_COLLAB_BODY, "协作同步数据过大。");
  if (!body || typeof body !== "object") throw new HttpError(400, "协作同步请求无效。");
  const rec = body as Record<string, unknown>;

  const peerId = typeof rec.peerId === "string" ? rec.peerId.trim() : "";
  if (!PEER_ID_RE.test(peerId)) throw new HttpError(400, "无效的协作者标识。");

  const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim().slice(0, 40) : "Collaborator";
  const color = typeof rec.color === "string" && HEX_COLOR_RE.test(rec.color) ? rec.color.toUpperCase() : "#3B82F6FF";
  const selectedTopicIds = Array.isArray(rec.selectedTopicIds)
    ? rec.selectedTopicIds.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, 20)
    : [];

  const updateB64 = typeof rec.updateB64 === "string" && rec.updateB64.length > 0 ? rec.updateB64 : null;
  if (updateB64) {
    if (permit.access !== "owner" && permit.access !== "editor") {
      throw new HttpError(403, "只读协作者不能提交编辑更新。");
    }
    if (updateB64.length > MAX_UPDATE_B64_LEN || !BASE64_RE.test(updateB64)) {
      throw new HttpError(400, "无效的 CRDT 更新数据。");
    }
  }

  let seq = 0;
  if (updateB64) {
    const insertRes = await db.prepare(
      "INSERT INTO mindmap_crdt_updates (mindmap_id, peer_id, actor, update_b64) VALUES (?, ?, ?, ?)",
    ).bind(id, peerId, subject, updateB64).run();
    seq = Number(insertRes.meta.last_row_id ?? 0);
  }

  const batch: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO mindmap_presence (mindmap_id, peer_id, actor, display_name, color, selected_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mindmap_id, peer_id) DO UPDATE SET
        display_name = excluded.display_name,
        color = excluded.color,
        selected_json = excluded.selected_json,
        updated_at = excluded.updated_at
    `).bind(id, peerId, subject, name, color, JSON.stringify(selectedTopicIds), nowMs),
    db.prepare("DELETE FROM mindmap_presence WHERE mindmap_id = ? AND updated_at < ?")
      .bind(id, nowMs - PRESENCE_PRUNE_MS),
  ];

  if (updateB64) {
    batch.push(
      db.prepare(`
        DELETE FROM mindmap_crdt_updates WHERE mindmap_id = ? AND seq NOT IN (
          SELECT seq FROM mindmap_crdt_updates WHERE mindmap_id = ? ORDER BY seq DESC LIMIT ?
        )
      `).bind(id, id, MAX_UPDATES_PER_MAP),
    );
  }

  await db.batch(batch);
  const peers = await listActivePeers(db, id, nowMs);
  return json({ seq, peers });
}
