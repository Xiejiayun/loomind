import type { MindmapDocument } from "@mindmap/core/model";
import { unpackDocument } from "./document-storage.js";
import { json } from "./http.js";

export function knownRevision(request: Request) {
  const match = /^"([1-9]\d{0,14})"$/.exec(request.headers.get("If-None-Match") ?? "");
  return match ? Number(match[1]) : 0;
}

export async function snapshotResponse(db: D1Database, id: string, row: { revision: number; document: string }, known: number, project?: (doc: MindmapDocument) => MindmapDocument) {
  const headers = { ETag: `"${row.revision}"`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (row.revision === known) return new Response(null, { status: 304, headers });
  const doc = await unpackDocument(db, id, row.document);
  return json({ revision: row.revision, document: project ? project(doc) : doc }, 200, [], headers);
}
