import type { MapAccess } from "./shared.js";

export const REVIEW_BODY_LIMIT = 2000;

export interface ReviewMessage { id: number; author: string; createdAt: string; body: string }
export interface ReviewThread extends ReviewMessage {
  sheetId: string; topicId: string; topicTitle: string; resolvedAt: string | null; resolvedBy: string | null;
}
interface ReviewAccess { access: MapAccess; viewersCanComment: boolean; nextCursor: number | null }
export interface ReviewList extends ReviewAccess { threads: ReviewThread[] }
export interface ReviewDetail extends ReviewAccess { thread: ReviewThread; replies: ReviewMessage[] }
