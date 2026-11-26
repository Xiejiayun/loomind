import { MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core/model";
import { getWebMessages } from "../i18n.js";
import { DRAFT_LIMIT, MAP_ID, OWNER_HEADER, type CloudDraft, type MindmapSummary } from "./shared.js";

export class CloudError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request(owner: string, id?: string, init?: RequestInit) {
  const err = getWebMessages().errors;
  if (id && !MAP_ID.test(id)) throw new CloudError(400, err.invalidMapId);
  const response = await fetch(`/api/mindmaps${id ? `/${id}` : ""}`, {
    ...init, headers: { [OWNER_HEADER]: owner, ...init?.headers }, credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new CloudError(0, err.cloudConnect); });
  const data = await response.json().catch(() => { throw new CloudError(503, err.cloudUnavailable); });
  if (!response.ok) throw new CloudError(response.status, typeof data?.error === "string" ? data.error : err.cloudSyncFailed);
  return data;
}

export async function listCloud(owner: string): Promise<MindmapSummary[]> {
  const data = await request(owner);
  if (!Array.isArray(data) || !data.every((item) => item && MAP_ID.test(item.id) && typeof item.title === "string" && typeof item.updatedAt === "string" &&
      (item.workspaceId === null || (typeof item.workspaceId === "string" && MAP_ID.test(item.workspaceId))) &&
      ["owner", "editor", "viewer"].includes(item.access))) {
    throw new CloudError(502, getWebMessages().errors.cloudListInvalid);
  }
  return data;
}

export async function readCloud(owner: string, id: string): Promise<CloudDraft> {
  const data = await request(owner, id);
  if (data?.revision === 0 && data.document === null) return data;
  if (!Number.isSafeInteger(data?.revision) || data.revision < 1 || !MindmapDocumentSchema.safeParse(data.document).success) {
    throw new CloudError(502, getWebMessages().errors.cloudDraftInvalid);
  }
  return data;
}

export async function writeCloud(owner: string, id: string, revision: number, document: MindmapDocument, workspaceId?: string | null): Promise<number> {
  const body = JSON.stringify(document);
  if (new Blob([body]).size > DRAFT_LIMIT) throw new CloudError(413, getWebMessages().errors.draftSizeLimit);
  const headers: Record<string, string> = { "Content-Type": "application/json", "If-Match": `"${revision}"` };
  if (revision === 0 && workspaceId) headers["X-Loomind-Workspace"] = workspaceId;
  const data = await request(owner, id, { method: "PUT", headers, body });
  if (data?.revision !== revision + 1) throw new CloudError(502, getWebMessages().errors.cloudNoAck);
  return data.revision;
}

export async function deleteCloud(owner: string, id: string): Promise<void> {
  await request(owner, id, { method: "DELETE" });
}
