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

export interface ReconcileBranchSummary {
  topicId: string;
  title: string;
  childCount: number;
}

export interface ReconcileResult {
  addedNodes: number;
  updatedNodes: number;
  branches: ReconcileBranchSummary[];
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
): ReconcileResult {
  const empty: ReconcileResult = { addedNodes: 0, updatedNodes: 0, branches: [] };
  if (!partialRoot) return empty;

  const coalesceKey = options?.coalesceKey ?? `ai-stream:${idPrefix}`;
  const maxNodes = options?.maxNodes ?? AI_LIMITS.MAX_NODES;
  const maxDepth = options?.maxDepth ?? AI_LIMITS.MAX_DEPTH;
  const maxChildren = options?.maxChildrenPerNode ?? AI_LIMITS.MAX_CHILDREN_PER_NODE;
  let visited = 0;
  let addedNodes = 0;
  let updatedNodes = 0;
  const branches: ReconcileBranchSummary[] = [];

  const countSubtree = (node: DeepPartial<AiTopicNode> | undefined): number => {
    if (!node?.children?.length) return 0;
    let total = 0;
    for (const c of node.children) {
      if (!c) continue;
      total += 1 + countSubtree(c);
    }
    return total;
  };

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
      addedNodes += 1;
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
      updatedNodes += 1;
    }

    if (depth === 1 && titleStr) {
      branches.push({
        topicId: nodeId,
        title: titleStr,
        childCount: countSubtree(node),
      });
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
  return { addedNodes, updatedNodes, branches };
}
