import {
  createRichText,
  findTopicLocation,
  richTextToPlainText,
  type SyncAdapter,
} from "@mindmap/core";
import { AI_LIMITS } from "./protocol.js";
import type { AiTopicNode, DeepPartial } from "./schema.js";

export interface ReconcileOptions {
  coalesceKey?: string;
  maxNodes?: number;
  maxDepth?: number;
  maxChildrenPerNode?: number;
}

/**
 * Reconciles a streaming partial AI tree against the live document via
 * deterministic path IDs (e.g. `ai-0-1-2`), emitting only incremental
 * `topic/addChild` / `topic/setTitle` commands for live typewriter-like growth.
 */
export function reconcileStreamingTree(
  adapter: SyncAdapter,
  sheetId: string,
  targetRootId: string,
  partialRoot: DeepPartial<AiTopicNode> | undefined,
  idPrefix = "ai",
  options?: ReconcileOptions,
): void {
  if (!partialRoot) return;

  const coalesceKey = options?.coalesceKey ?? `ai-stream:${idPrefix}`;
  const maxNodes = options?.maxNodes ?? AI_LIMITS.MAX_NODES;
  const maxDepth = options?.maxDepth ?? AI_LIMITS.MAX_DEPTH;
  const maxChildren = options?.maxChildrenPerNode ?? AI_LIMITS.MAX_CHILDREN_PER_NODE;
  let visited = 0;

  const walk = (
    node: DeepPartial<AiTopicNode> | undefined,
    nodeId: string,
    parentId: string | null,
    path: string,
    depth: number,
  ) => {
    if (!node || visited >= maxNodes || depth > maxDepth) return;
    visited += 1;

    const doc = adapter.getDocument();
    const sheet = doc.sheets.find((s) => s.id === sheetId);
    if (!sheet) return;

    const existing = findTopicLocation(sheet, nodeId);
    const titleStr = node.title?.trim().slice(0, AI_LIMITS.MAX_TITLE_CHARS);

    if (!existing && parentId) {
      adapter.applyCommand(
        {
          type: "topic/addChild",
          sheetId,
          parentId,
          newId: nodeId,
          title: createRichText(titleStr || "思考中..."),
        },
        { coalesceKey },
      );
    } else if (existing && titleStr && richTextToPlainText(existing.topic.title) !== titleStr) {
      adapter.applyCommand(
        {
          type: "topic/setTitle",
          sheetId,
          topicId: nodeId,
          title: createRichText(titleStr),
        },
        { coalesceKey },
      );
    }

    const updatedDoc = adapter.getDocument();
    const updatedSheet = updatedDoc.sheets.find((s) => s.id === sheetId);
    const current = updatedSheet ? findTopicLocation(updatedSheet, nodeId) : null;

    if (node.subtitle && current) {
      const cleanSub = node.subtitle.trim().slice(0, AI_LIMITS.MAX_SUBTITLE_CHARS);
      if (cleanSub && current.topic.subtitle !== cleanSub) {
        adapter.applyCommand(
          { type: "topic/setSubtitle", sheetId, topicId: nodeId, subtitle: cleanSub },
          { coalesceKey },
        );
      }
    }

    if ((node.task === "todo" || node.task === "done") && current && current.topic.task?.status !== node.task) {
      adapter.applyCommand(
        { type: "topic/toggleTask", sheetId, topicId: nodeId, status: node.task },
        { coalesceKey },
      );
    }

    if (node.labels && node.labels.length > 0 && current) {
      const clean = node.labels
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        .map((l) => l.trim().slice(0, AI_LIMITS.MAX_LABEL_CHARS))
        .slice(0, AI_LIMITS.MAX_LABELS);
      if (clean.length > 0 && JSON.stringify(current.topic.labels ?? []) !== JSON.stringify(clean)) {
        adapter.applyCommand(
          { type: "topic/setLabels", sheetId, topicId: nodeId, labels: clean },
          { coalesceKey },
        );
      }
    }

    const children = (node.children ?? []).slice(0, maxChildren);
    for (let i = 0; i < children.length; i++) {
      if (visited >= maxNodes) break;
      const child = children[i];
      if (!child) continue;
      const childPath = `${path}-${i}`;
      const childId = `${idPrefix}-${childPath}`;
      walk(child, childId, nodeId, childPath, depth + 1);
    }
  };

  walk(partialRoot, targetRootId, null, "0", 0);
}
