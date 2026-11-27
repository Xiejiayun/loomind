import { MAP_ID, MAX_CHECKPOINT_B64, type LiveCheckpoint } from "../src/drafts/shared.js";
import { HttpError } from "./http.js";
import { mapAccessSql } from "./permissions.js";

const BLOCK = 384 * 1024;

export function parseCheckpoint(value: unknown): LiveCheckpoint {
  const data = value as Partial<LiveCheckpoint> | null;
  if (!data || typeof data.room !== "string" || !MAP_ID.test(data.room) || typeof data.cursor !== "number" || !Number.isSafeInteger(data.cursor) || data.cursor < 0 || typeof data.snapshot !== "string" || !data.snapshot.length) throw new HttpError(422, "协作快照格式无效。");
  if (data.snapshot.length > MAX_CHECKPOINT_B64) throw new HttpError(413, "协作快照超过大小限制。");
  if (data.snapshot.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.snapshot)) throw new HttpError(422, "协作快照编码无效。");
  return { room: data.room, snapshot: data.snapshot, cursor: data.cursor };
}

export function replaceCheckpoint(db: D1Database, id: string, token: string, checkpoint?: LiveCheckpoint) {
  const statements = [db.prepare(`DELETE FROM mindmap_live_parts WHERE mindmap_id = ? AND EXISTS (
    SELECT 1 FROM mindmaps WHERE id = ? AND checkpoint_token = ?)`).bind(id, id, token)];
  if (checkpoint) {
    for (let offset = 0; offset < checkpoint.snapshot.length; offset += BLOCK) {
      statements.push(db.prepare(`INSERT INTO mindmap_live_parts (mindmap_id, part, token, room, cursor, payload, revision)
        SELECT id, ?, ?, ?, ?, ?, revision FROM mindmaps WHERE id = ? AND checkpoint_token = ?`)
        .bind(offset / BLOCK, token, checkpoint.room, checkpoint.cursor, checkpoint.snapshot.slice(offset, offset + BLOCK), id, token));
    }
  }
  return statements;
}

export function checkpointQuery(db: D1Database, subject: string, id: string) {
  return db.prepare(`SELECT part.room, part.cursor, part.payload FROM mindmap_live_parts AS part
    JOIN mindmaps m ON m.id = part.mindmap_id AND m.checkpoint_token = part.token AND m.revision = part.revision
    WHERE m.id = ? AND ${mapAccessSql()} ORDER BY part.part`).bind(id, subject, subject, subject, subject);
}

export function assembleCheckpoint(rows: { room: string; cursor: number; payload: string }[]): LiveCheckpoint | null {
  return rows.length ? { room: rows[0].room, cursor: rows[0].cursor, snapshot: rows.map((row) => row.payload).join("") } : null;
}
