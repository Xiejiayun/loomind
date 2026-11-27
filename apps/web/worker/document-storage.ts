import type { MindmapDocument } from "@mindmap/core/model";
import { DRAFT_LIMIT, DRAFT_SIZE_ERROR } from "../src/drafts/shared.js";
import { HttpError } from "./http.js";

const INLINE_BYTES = 1024 * 1024;
const INLINE_ROW_BUDGET = 1_900_000;
const BLOCK_CHARS = 256 * 1024;
const encoder = new TextEncoder();

export async function packDocument(text: string, title: string) {
  const blocks = new Map<string, string>();
  const bytes = encoder.encode(text).byteLength;
  if (bytes > DRAFT_LIMIT) throw new HttpError(413, DRAFT_SIZE_ERROR);
  const titleBytes = encoder.encode(title).byteLength;
  const indexTitle = titleBytes <= INLINE_BYTES ? title : title.slice(0, 512).replace(/[\uD800-\uDBFF]$/, "");
  if (bytes <= INLINE_BYTES && bytes + titleBytes <= INLINE_ROW_BUDGET) return { stored: text, blocks, indexTitle };

  const digests: string[] = [];
  // Split from the end: editing a title near the start need not rewrite the trailing image data.
  for (let end = text.length; end > 0;) {
    let start = Math.max(0, end - BLOCK_CHARS);
    if (start && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start--;
    const content = text.slice(start, end);
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(content));
    const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    digests.push(digest);
    blocks.set(digest, content);
    end = start;
  }
  return { stored: JSON.stringify(digests.reverse()), blocks, indexTitle };
}

export async function unpackDocument(db: D1Database, id: string, stored: string): Promise<MindmapDocument> {
  if (!stored.startsWith("[")) return JSON.parse(stored);
  const { results } = await db.prepare(`
    SELECT block.content FROM json_each(?) AS part
    LEFT JOIN mindmap_document_blocks AS block ON block.mindmap_id = ? AND block.digest = part.value
    ORDER BY part.key
  `).bind(stored, id).all<{ content: string | null }>();
  if (!results.length || results.some((part) => part.content === null)) throw new HttpError(503, "云端导图数据不完整，请保留本机副本并重试。");
  return JSON.parse(results.map((part) => part.content).join(""));
}

export function writeBlocks(db: D1Database, id: string, token: string, blocks: Map<string, string>) {
  return Array.from(blocks, ([digest, content]) => db.prepare(`
    INSERT INTO mindmap_document_blocks (mindmap_id, digest, content)
    SELECT id, ?, ? FROM mindmaps WHERE id = ? AND save_token = ?
    ON CONFLICT(mindmap_id, digest) DO NOTHING
  `).bind(digest, content, id, token));
}

export function pruneBlocks(db: D1Database, id: string, token: string) {
  return db.prepare(`
    DELETE FROM mindmap_document_blocks WHERE mindmap_id = ?
      AND EXISTS (SELECT 1 FROM mindmaps WHERE id = ? AND save_token = ?)
      AND digest NOT IN (
        SELECT part.value FROM mindmap_revisions AS rev,
          json_each(CASE WHEN substr(rev.document, 1, 1) = '[' THEN rev.document ELSE '[]' END) AS part
        WHERE rev.mindmap_id = ?
      )
  `).bind(id, id, token, id);
}
