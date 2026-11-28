import { MAP_ID, OWNER_HEADER, ROOM_HEADER } from "../src/drafts/shared.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { canViewMindmap, database, mapAccessSql, mindmapPermission } from "./permissions.js";

const MAX_UPDATE_B64_LEN = 1536 * 1024;
const MAX_COLLAB_BODY = MAX_UPDATE_B64_LEN + 8 * 1024;
const MAX_UPDATES_PER_MAP = 200;
const MAX_RETAINED_B64_BYTES = MAX_UPDATES_PER_MAP * 192 * 1024;
const PRESENCE_TTL_MS = 20_000;
const PRESENCE_PRUNE_MS = 60_000;
const PEER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6,8}$/;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const CURRENT_ROOM = `(? IS NULL OR EXISTS (SELECT 1 FROM mindmap_live_parts part WHERE part.mindmap_id = m.id
  AND part.part = 0 AND part.revision = m.revision AND part.token = m.checkpoint_token AND part.room = ?))`;

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

async function listActivePeers(db: D1Database, subject: string, mapId: string, nowMs: number): Promise<CollabPeerRecord[]> {
  const cutoff = nowMs - PRESENCE_TTL_MS;
  const rows = await db.prepare(`
    SELECT peer_id AS peerId, display_name AS displayName, color, selected_json AS selectedJson, updated_at AS updatedAt
    FROM mindmap_presence
    WHERE mindmap_id = ? AND updated_at >= ? AND EXISTS (SELECT 1 FROM mindmaps m WHERE m.id = mindmap_id AND ${mapAccessSql()})
    ORDER BY updated_at DESC
    LIMIT 24
  `).bind(mapId, cutoff, subject, subject, subject, subject).all<{
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
  const room = request.headers.get(ROOM_HEADER);
  if (room !== null && !MAP_ID.test(room)) throw new HttpError(400, "无效的协作房间。");
  const permit = request.method === "POST" ? await mindmapPermission(db, subject, id) : null;
  if (!(request.method === "GET" ? await canViewMindmap(db, subject, id) : permit?.access)) throw new HttpError(404, "导图不存在或无权访问。");
  const head = room ? await db.prepare(`SELECT map.revision, part.room FROM mindmaps AS map LEFT JOIN mindmap_live_parts AS part
    ON part.mindmap_id = map.id AND part.token = map.checkpoint_token AND part.revision = map.revision AND part.part = 0 WHERE map.id = ?`).bind(id).first<{ revision: number; room: string | null }>() : null;
  if (room && room !== head?.room) throw new HttpError(409, "协作历史已更新，请同步云端版本。");

  if (request.method === "GET") {
    const url = new URL(request.url);
    const sinceRaw = url.searchParams.get("since") ?? "0";
    const since = /^\d{1,15}$/.test(sinceRaw) ? Number(sinceRaw) : 0;

    const [updatesRes, peers] = await Promise.all([
      db.prepare(`
        WITH candidates AS (
          SELECT seq, octet_length(update_b64) AS size FROM mindmap_crdt_updates
          WHERE mindmap_id = ? AND room IS ? AND seq > ? AND EXISTS (
            SELECT 1 FROM mindmaps m WHERE m.id = mindmap_id AND ${mapAccessSql()} AND ${CURRENT_ROOM})
          ORDER BY seq LIMIT 100
        ), page AS (
          SELECT seq, SUM(size) OVER (ORDER BY seq) AS bytes FROM candidates
        )
        SELECT entry.seq, entry.peer_id AS peerId, entry.actor, entry.update_b64 AS updateB64
        FROM page JOIN mindmap_crdt_updates AS entry ON entry.seq = page.seq
        WHERE page.bytes <= ? ORDER BY entry.seq
      `).bind(id, room, since, subject, subject, subject, subject, room, room, MAX_UPDATE_B64_LEN).all<CollabUpdateRow>(),
      listActivePeers(db, subject, id, nowMs),
    ]);

    const updates = updatesRes.results;
    const latestSeq = updates.length > 0 ? updates[updates.length - 1].seq : since;
    return json({ latestSeq, updates, peers, ...(head && { revision: head.revision }) });
  }

  // POST: publish CRDT delta and/or heartbeat presence
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
    if (permit?.access !== "owner" && permit?.access !== "editor") {
      throw new HttpError(403, "只读协作者不能提交编辑更新。");
    }
    if (updateB64.length > MAX_UPDATE_B64_LEN) throw new HttpError(413, "协作同步数据过大。");
    if (!BASE64_RE.test(updateB64)) {
      throw new HttpError(400, "无效的 CRDT 更新数据。");
    }
  }

  const batch: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO mindmap_presence (mindmap_id, peer_id, actor, display_name, color, selected_json, updated_at)
      SELECT m.id, ?, ?, ?, ?, ?, ? FROM mindmaps m WHERE m.id = ? AND ${mapAccessSql()}
      ON CONFLICT(mindmap_id, peer_id) DO UPDATE SET
        display_name = excluded.display_name,
        color = excluded.color,
        selected_json = excluded.selected_json,
        updated_at = excluded.updated_at
    `).bind(peerId, subject, name, color, JSON.stringify(selectedTopicIds), nowMs, id, subject, subject, subject, subject),
    db.prepare("DELETE FROM mindmap_presence WHERE mindmap_id = ? AND updated_at < ?")
      .bind(id, nowMs - PRESENCE_PRUNE_MS),
  ];

  if (updateB64) {
    batch.unshift(db.prepare(
      `INSERT INTO mindmap_crdt_updates (mindmap_id, peer_id, actor, update_b64, room) SELECT m.id, ?, ?, ?, ? FROM mindmaps m
        WHERE m.id = ? AND ${mapAccessSql(true)} AND ${CURRENT_ROOM}`,
    ).bind(peerId, subject, updateB64, room, id, subject, subject, subject, subject, room, room));
    batch.push(
      db.prepare(`
        DELETE FROM mindmap_crdt_updates WHERE mindmap_id = ? AND seq <= (
          SELECT MAX(seq) FROM (
            SELECT seq, ROW_NUMBER() OVER (ORDER BY seq DESC) AS position,
              SUM(octet_length(update_b64)) OVER (ORDER BY seq DESC) AS bytes
            FROM mindmap_crdt_updates WHERE mindmap_id = ?
          ) WHERE position > ? OR bytes > ?
        )
      `).bind(id, id, MAX_UPDATES_PER_MAP, MAX_RETAINED_B64_BYTES),
    );
  }

  const results = await db.batch(batch);
  if (updateB64 && !results[0].meta.changes) throw new HttpError(409, "协作历史已更新，请同步云端版本。");
  const seq = updateB64 ? Number(results[0].meta.last_row_id) : 0;
  const peers = await listActivePeers(db, subject, id, nowMs);
  return json({ seq, peers });
}
