import { MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core/model";
import { DRAFT_LIMIT, DRAFT_SIZE_ERROR, MAP_ID, OWNER_HEADER, type CloudDraft, type MindmapSummary } from "./shared.js";

export class CloudError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request(owner: string, id?: string, init?: RequestInit) {
  if (id && !MAP_ID.test(id)) throw new CloudError(400, "导图 ID 无效。");
  const response = await fetch(`/api/mindmaps${id ? `/${id}` : ""}`, {
    ...init, headers: { [OWNER_HEADER]: owner, ...init?.headers }, credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new CloudError(0, "无法连接云端，请联网后重试。"); });
  const data = await response.json().catch(() => { throw new CloudError(503, "云存储暂不可用。"); });
  if (!response.ok) throw new CloudError(response.status, typeof data?.error === "string" ? data.error : "云端同步失败。");
  return data;
}

export async function listCloud(owner: string): Promise<MindmapSummary[]> {
  const data = await request(owner);
  if (!Array.isArray(data) || !data.every((item) => item && MAP_ID.test(item.id) && typeof item.title === "string" && typeof item.updatedAt === "string")) {
    throw new CloudError(502, "云端导图列表格式异常。");
  }
  return data;
}

export async function readCloud(owner: string, id: string): Promise<CloudDraft> {
  const data = await request(owner, id);
  if (data?.revision === 0 && data.document === null) return data;
  if (!Number.isSafeInteger(data?.revision) || data.revision < 1 || !MindmapDocumentSchema.safeParse(data.document).success) {
    throw new CloudError(502, "云端草稿格式异常，未替换本机内容。");
  }
  return data;
}

export async function writeCloud(owner: string, id: string, revision: number, document: MindmapDocument): Promise<number> {
  const body = JSON.stringify(document);
  if (new Blob([body]).size > DRAFT_LIMIT) throw new CloudError(413, DRAFT_SIZE_ERROR);
  const data = await request(owner, id, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": `"${revision}"` }, body });
  if (data?.revision !== revision + 1) throw new CloudError(502, "未收到云端保存确认，请重试。");
  return data.revision;
}
