import { MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core/model";
import { getWebMessages } from "../i18n.js";
import { DRAFT_LIMIT, LIVE_HEADER, MAP_ID, OWNER_HEADER, type CloudDraft, type LiveCheckpoint, type MindmapSummary } from "./shared.js";

const DOCUMENT_TIMEOUT_MS = 60_000;

export class CloudError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

async function request(owner: string, id?: string, init?: RequestInit): Promise<unknown> {
  const err = getWebMessages().errors;
  if (id && !MAP_ID.test(id)) throw new CloudError(400, err.invalidMapId);
  const response = await fetch(`/api/mindmaps${id ? `/${id}` : ""}`, {
    ...init, headers: { [OWNER_HEADER]: owner, ...init?.headers }, credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.timeout(id && (!init?.method || init.method === "PUT") ? DOCUMENT_TIMEOUT_MS : 12_000),
  }).catch(() => { throw new CloudError(0, err.cloudConnect); });
  const data: unknown = await response.json().catch(() => { throw new CloudError(503, err.cloudUnavailable); });
  const record = asRecord(data);
  if (!response.ok) throw new CloudError(response.status, typeof record?.error === "string" ? record.error : err.cloudSyncFailed);
  return data;
}

export async function listCloud(owner: string): Promise<MindmapSummary[]> {
  const data = await request(owner);
  if (!Array.isArray(data) || !data.every((item) => item && MAP_ID.test(item.id) && typeof item.title === "string" && typeof item.updatedAt === "string" &&
      (item.workspaceId === null || (typeof item.workspaceId === "string" && MAP_ID.test(item.workspaceId))) &&
      ["owner", "editor", "viewer"].includes(item.access))) {
    throw new CloudError(502, getWebMessages().errors.cloudListInvalid);
  }
  return data as MindmapSummary[];
}

export async function readCloud(owner: string, id: string, live = false): Promise<CloudDraft> {
  return parseCloudDraft(await request(owner, id, live ? { headers: { [LIVE_HEADER]: "1" } } : undefined));
}

function parseCloudDraft(data: unknown): CloudDraft {
  const record = asRecord(data);
  if (record?.revision === 0 && record.document === null) return data as CloudDraft;
  if (!record || typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 1 || !MindmapDocumentSchema.safeParse(record.document).success) {
    throw new CloudError(502, getWebMessages().errors.cloudDraftInvalid);
  }
  return data as CloudDraft;
}

export async function seedCloud(owner: string, id: string, revision: number, checkpoint: LiveCheckpoint) {
  const data = await request(owner, id, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": `"${revision}"`, [LIVE_HEADER]: "seed" }, body: JSON.stringify({ checkpoint }) });
  const record = asRecord(data);
  if (record?.revision !== revision || record.room !== checkpoint.room) throw new CloudError(502, getWebMessages().errors.cloudNoAck);
}

export type ViewAccess = { owner: string } | { token: string };

export async function readViewSnapshot(id: string, access: ViewAccess, revision: number, signal: AbortSignal) {
  const member = "owner" in access;
  if (!MAP_ID.test(id) || (!member && !access.token)) throw new CloudError(404, getWebMessages().editorWorkspace.mapUnavailable);
  const headers = new Headers(member ? { [OWNER_HEADER]: access.owner } : { Authorization: `Bearer ${access.token}` });
  if (revision) headers.set("If-None-Match", `"${revision}"`);
  const response = await fetch(`/api/${member ? "mindmaps" : "public-maps"}/${id}`, {
    headers, credentials: member ? "same-origin" : "omit", cache: "no-store", referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(DOCUMENT_TIMEOUT_MS)]),
  });
  if (response.status === 304 && revision) return null;
  if (!response.ok) throw new CloudError(response.status, getWebMessages().editorWorkspace.readSharedError);
  const snapshot = parseCloudDraft(await response.json());
  if (!snapshot.document) throw new CloudError(404, getWebMessages().editorWorkspace.mapUnavailable);
  return { revision: snapshot.revision, document: snapshot.document };
}

export async function writeCloud(owner: string, id: string, revision: number, document: MindmapDocument, workspaceId?: string | null, checkpoint?: LiveCheckpoint): Promise<number> {
  const body = JSON.stringify(document);
  if (new Blob([body]).size > DRAFT_LIMIT) throw new CloudError(413, getWebMessages().errors.draftSizeLimit);
  const headers: Record<string, string> = { "Content-Type": "application/json", "If-Match": `"${revision}"` };
  if (checkpoint) headers[LIVE_HEADER] = "1";
  if (revision === 0 && workspaceId) headers["X-Loomind-Workspace"] = workspaceId;
  const data = await request(owner, id, { method: "PUT", headers, body: checkpoint ? JSON.stringify({ ...document, checkpoint }) : body });
  const record = asRecord(data);
  if (!record || record.revision !== revision + 1 || (checkpoint && record.room !== checkpoint.room)) throw new CloudError(502, getWebMessages().errors.cloudNoAck);
  return record.revision;
}

export async function deleteCloud(owner: string, id: string): Promise<void> {
  await request(owner, id, { method: "DELETE" });
}

export interface MindmapRevisionSummary {
  revision: number;
  title: string;
  savedBy: string;
  createdAt: string;
}

export interface MindmapRevisionSnapshot extends MindmapRevisionSummary {
  document: MindmapDocument;
}

export async function listRevisions(owner: string, id: string): Promise<MindmapRevisionSummary[]> {
  if (!MAP_ID.test(id)) throw new CloudError(400, getWebMessages().errors.invalidMapId);
  const err = getWebMessages().errors;
  const response = await fetch(`/api/mindmaps/${id}/revisions`, {
    headers: { [OWNER_HEADER]: owner },
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new CloudError(0, err.cloudConnect); });
  const data: unknown = await response.json().catch(() => { throw new CloudError(503, err.cloudUnavailable); });
  if (!response.ok) {
    const rec = asRecord(data);
    throw new CloudError(response.status, typeof rec?.error === "string" ? rec.error : err.cloudSyncFailed);
  }
  if (!Array.isArray(data) || !data.every((item) => item && typeof item.revision === "number" && typeof item.title === "string" && typeof item.createdAt === "string")) {
    throw new CloudError(502, err.cloudListInvalid);
  }
  return data as MindmapRevisionSummary[];
}

export async function readRevision(owner: string, id: string, revision: number): Promise<MindmapRevisionSnapshot> {
  if (!MAP_ID.test(id)) throw new CloudError(400, getWebMessages().errors.invalidMapId);
  const err = getWebMessages().errors;
  const response = await fetch(`/api/mindmaps/${id}/revisions/${revision}`, {
    headers: { [OWNER_HEADER]: owner },
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS),
  }).catch(() => { throw new CloudError(0, err.cloudConnect); });
  const data: unknown = await response.json().catch(() => { throw new CloudError(503, err.cloudUnavailable); });
  const rec = asRecord(data);
  if (!response.ok) {
    throw new CloudError(response.status, typeof rec?.error === "string" ? rec.error : err.cloudSyncFailed);
  }
  if (!rec || typeof rec.revision !== "number" || typeof rec.title !== "string" || typeof rec.createdAt !== "string" || !MindmapDocumentSchema.safeParse(rec.document).success) {
    throw new CloudError(502, err.cloudDraftInvalid);
  }
  return data as MindmapRevisionSnapshot;
}
