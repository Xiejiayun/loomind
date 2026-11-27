import { getWebMessages } from "./i18n.js";
import type { WebpageSource } from "./webpage-contract.js";

export type Access = "owner" | "editor" | "viewer";
export interface WorkspaceSummary { id: string; name: string; role: Access; createdAt: string }
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
export const createWorkspace = (name: string) => send<WorkspaceSummary>("/api/workspaces", { name });
export const moveMindmap = (workspaceId: string, mindmapId: string) => send<{ workspaceId: string }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/mindmaps`, { mindmapId });
export const createShare = (type: "workspace" | "mindmap", resourceId: string, role: "viewer" | "editor") =>
  send<CreatedShare>("/api/shares", { type, resourceId, role });
export const listShares = (type: "workspace" | "mindmap", resourceId: string) =>
  request<ShareSummary[]>(`/api/shares?type=${type}&resourceId=${encodeURIComponent(resourceId)}`);
export const revokeShare = (id: string) => request<{ revoked: boolean }>(`/api/shares/${encodeURIComponent(id)}`, { method: "DELETE" });
export const previewInvite = (token: string) => request<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`);
export const acceptInvite = (token: string) => send<{ type: "workspace" | "mindmap"; id: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, {});
