import {
  createRichText,
  findTopicLocation,
  richTextToPlainText,
  type SyncAdapter,
} from "@mindmap/core";
import type { AiTopicNode, DeepPartial } from "./schema.js";

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
): void {
  if (!partialRoot) return;

  const walk = (
    node: DeepPartial<AiTopicNode> | undefined,
    nodeId: string,
    parentId: string | null,
    path: string,
  ) => {
    if (!node) return;
    const doc = adapter.getDocument();
    const sheet = doc.sheets.find((s) => s.id === sheetId);
    if (!sheet) return;

    const existing = findTopicLocation(sheet, nodeId);
    const titleStr = node.title?.trim();

    if (!existing && parentId) {
      adapter.applyCommand(
        {
          type: "topic/addChild",
          sheetId,
          parentId,
          newId: nodeId,
          title: createRichText(titleStr || "思考中..."),
        },
        { coalesceKey: `ai-stream:${idPrefix}` },
      );
    } else if (existing && titleStr && richTextToPlainText(existing.topic.title) !== titleStr) {
      adapter.applyCommand(
        {
          type: "topic/setTitle",
          sheetId,
          topicId: nodeId,
          title: createRichText(titleStr),
        },
        { coalesceKey: `ai-stream:${idPrefix}:${nodeId}` },
      );
    }

    if (node.subtitle && existing && existing.topic.subtitle !== node.subtitle) {
      adapter.applyCommand(
        { type: "topic/setSubtitle", sheetId, topicId: nodeId, subtitle: node.subtitle },
        { coalesceKey: `ai-stream:${idPrefix}` },
      );
    }

    if (node.task && existing && existing.topic.task?.status !== node.task) {
      adapter.applyCommand(
        { type: "topic/toggleTask", sheetId, topicId: nodeId, status: node.task },
        { coalesceKey: `ai-stream:${idPrefix}` },
      );
    }

    if (node.labels && node.labels.length > 0 && existing) {
      const clean = node.labels.filter((l): l is string => typeof l === "string" && l.length > 0);
      if (clean.length > 0 && JSON.stringify(existing.topic.labels ?? []) !== JSON.stringify(clean)) {
        adapter.applyCommand(
          { type: "topic/setLabels", sheetId, topicId: nodeId, labels: clean },
          { coalesceKey: `ai-stream:${idPrefix}` },
        );
      }
    }

    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      const childPath = `${path}-${i}`;
      const childId = `${idPrefix}-${childPath}`;
      walk(child, childId, nodeId, childPath);
    }
  };

  walk(partialRoot, targetRootId, null, "0");
}
