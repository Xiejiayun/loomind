import { getWebMessages } from "./i18n.js";
import { OWNER_HEADER } from "./drafts/shared.js";
import type { ReviewDetail, ReviewList } from "./drafts/reviews.js";
import type { WebpageSource } from "./webpage-contract.js";
import type { WorkspaceSummary } from "./workspace-groups.js";

export type { WorkspaceSummary } from "./workspace-groups.js";
export interface ShareSummary { id: string; role: "editor" | "viewer"; expiresAt: string }
export interface CreatedShare extends ShareSummary { token: string }
export interface InvitePreview { type: "workspace" | "mindmap"; id: string; name: string; role: "editor" | "viewer"; expiresAt: string }

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(0, getWebMessages().errors.apiConnect);
  }
  const body = await response.json().catch(() => { throw new ApiError(502, getWebMessages().errors.apiParse); });
  if (!response.ok) throw new ApiError(response.status, typeof body?.error === "string" ? body.error : getWebMessages().errors.apiFailed);
  return body as T;
}

function send<T>(path: string, value: unknown, method = "POST") {
  return request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

export const listWorkspaces = () => request<WorkspaceSummary[]>("/api/workspaces");
export const webpageOrigins = () => request<string[]>("/api/sources/webpage");
export const readWebpage = (url: string) => send<WebpageSource>("/api/sources/webpage", { url });
export interface TeamTemplate { id: string; title: string; createdAt: string }
const templatesPath = (workspace: string) => `/api/workspaces/${encodeURIComponent(workspace)}/templates`;
export const listTeamTemplates = (workspace: string) => request<TeamTemplate[]>(templatesPath(workspace));
export const saveTeamTemplate = (workspace: string, mindmapId: string) => send<{ id: string }>(templatesPath(workspace), { mindmapId });
export const copyTeamTemplate = (workspace: string, template: string) =>
  send<{ id: string; title: string; workspaceId: string }>(`${templatesPath(workspace)}/${encodeURIComponent(template)}/copies`, {});
export const removeTeamTemplate = (workspace: string, template: string) =>
  request<{ deleted: boolean }>(`${templatesPath(workspace)}/${encodeURIComponent(template)}`, { method: "DELETE" });
export const getWorkspaceOrder = (owner: string) => request<string[]>("/api/workspaces/order", { headers: { [OWNER_HEADER]: owner } });
export const saveWorkspaceOrder = (owner: string, order: string[]) => request<string[]>("/api/workspaces/order", {
  method: "PUT", headers: { "Content-Type": "application/json", [OWNER_HEADER]: owner }, body: JSON.stringify(order),
});
export const createWorkspace = (name: string) => send<WorkspaceSummary>("/api/workspaces", { name });
export const moveMindmap = (workspaceId: string, mindmapId: string) => send<{ workspaceId: string }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/mindmaps`, { mindmapId });
export const createShare = (type: "workspace" | "mindmap", resourceId: string, role: "viewer" | "editor") =>
  send<CreatedShare>("/api/shares", { type, resourceId, role });
export const listShares = (type: "workspace" | "mindmap", resourceId: string) =>
  request<ShareSummary[]>(`/api/shares?type=${type}&resourceId=${encodeURIComponent(resourceId)}`);
export const revokeShare = (id: string) => request<{ revoked: boolean }>(`/api/shares/${encodeURIComponent(id)}`, { method: "DELETE" });
export const publicLink = (id: string, method: "GET" | "PUT" | "DELETE") =>
  request<{ token: string | null }>(`/api/mindmaps/${encodeURIComponent(id)}/public-link`, { method });
export const previewInvite = (token: string) => request<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`);
export const acceptInvite = (token: string) => send<{ type: "workspace" | "mindmap"; id: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, {});

export function nodeReviewApi(owner: string, mapId: string) {
  const path = `/api/mindmaps/${encodeURIComponent(mapId)}/comments`;
  const headers = { [OWNER_HEADER]: owner };
  const page = (cursor?: number) => cursor ? `?cursor=${cursor}` : "";
  const write = <T>(url: string, method: "POST" | "PATCH", value: object) => request<T>(url, {
    method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  return {
    list: (cursor?: number) => request<ReviewList>(path + page(cursor), { headers }),
    detail: (id: number, cursor?: number) => request<ReviewDetail>(`${path}/${id}${page(cursor)}`, { headers }),
    create: (sheetId: string, topicId: string, body: string) => write<{ id: number }>(path, "POST", { sheetId, topicId, body }),
    reply: (id: number, body: string) => write(`${path}/${id}`, "POST", { body }),
    resolve: (id: number, resolved: boolean) => write(`${path}/${id}`, "PATCH", { resolved }),
    policy: (viewersCanComment: boolean) => write(path, "PATCH", { viewersCanComment }),
  };
}
