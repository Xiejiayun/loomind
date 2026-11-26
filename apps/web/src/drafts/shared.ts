import type { MindmapDocument } from "@mindmap/core/model";

export const DRAFT_LIMIT = 1024 * 1024;
export const DRAFT_SIZE_ERROR = "导图超过 1 MiB，无法同步到云端。可继续在本机编辑或导出 .xmind。";
export const OWNER_HEADER = "X-Loomind-Owner";
export interface CloudDraft { revision: number; document: MindmapDocument | null }
export type MapAccess = "owner" | "editor" | "viewer";
export interface LocalDraft { revision: number; document: MindmapDocument; dirty: boolean; workspaceId?: string | null; access?: MapAccess }
export interface MindmapSummary {
  id: string;
  title: string;
  updatedAt: string;
  workspaceId: string | null;
  access: MapAccess;
  localOnly?: boolean;
  hasPendingDraft?: boolean;
}
export const MAP_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export function mapTitle(document: MindmapDocument) {
  return document.sheets.find((sheet) => sheet.id === document.activeSheetId)?.title?.trim() || "未命名导图";
}
