import {
  findTopicLocation,
  type LayoutNode,
  type MindmapLayoutResult,
  type MindmapSheet,
  type MindmapStructure,
  type MindmapTopic,
} from "@mindmap/core";

export type DropMode = "child" | "before" | "after" | "floating";
export type DropIndicatorSide = "around" | "top" | "bottom" | "left" | "right";

export interface DropTargetResolution {
  dropTargetId: string | null;
  dropMode: DropMode;
  indicatorSide: DropIndicatorSide;
}

function topicContainsId(topic: MindmapTopic, targetId: string): boolean {
  if (topic.id === targetId) return true;
  for (const child of topic.children) {
    if (topicContainsId(child, targetId)) return true;
  }
  return false;
}

export function isTopicSelfOrDescendant(sheet: MindmapSheet, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return true;
  const loc = findTopicLocation(sheet, ancestorId);
  if (!loc) return false;
  return topicContainsId(loc.topic, candidateId);
}

function findEffectiveStructure(sheet: MindmapSheet, topicId: string): MindmapStructure {
  let cursor: string | null = topicId;
  while (cursor) {
    const loc = findTopicLocation(sheet, cursor);
    if (!loc) break;
    if (loc.topic.structure) return loc.topic.structure;
    cursor = loc.parent?.id ?? null;
  }
  return sheet.structure;
}

/**
 * Determines whether the siblings of `targetId` are ordered horizontally (left/right)
 * or vertically (top/bottom), along with whether horizontal order runs right-to-left (fishbone).
 */
export function resolveSiblingDropOrientation(
  sheet: MindmapSheet,
  layout: MindmapLayoutResult,
  targetId: string,
): { axis: "horizontal" | "vertical"; reverseHorizontal: boolean } {
  const loc = findTopicLocation(sheet, targetId);
  const node = layout.nodes.get(targetId);
  if (!loc?.parent || !node) {
    return { axis: "vertical", reverseHorizontal: false };
  }

  const parentStructure = findEffectiveStructure(sheet, loc.parent.id);
  const isHorizontalStructure =
    parentStructure === "org" ||
    parentStructure === "timeline" ||
    (parentStructure === "fishbone" && node.depth === 1) ||
    node.side === "top" ||
    node.side === "bottom";

  // Verify order direction against actual sibling layout when >= 2 siblings are visible
  const siblings = loc.parent.children
    .map((c) => layout.nodes.get(c.id))
    .filter((n): n is LayoutNode => n !== undefined);

  if (siblings.length >= 2) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of siblings) {
      const cx = s.contentBox.x + s.contentBox.width / 2;
      const cy = s.contentBox.y + s.contentBox.height / 2;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    }
    const horizontalByGeometry = maxX - minX > (maxY - minY) * 1.15;
    if (isHorizontalStructure || horizontalByGeometry) {
      const firstX = siblings[0].contentBox.x + siblings[0].contentBox.width / 2;
      const lastX = siblings[siblings.length - 1].contentBox.x + siblings[siblings.length - 1].contentBox.width / 2;
      return { axis: "horizontal", reverseHorizontal: firstX > lastX };
    }
    return { axis: "vertical", reverseHorizontal: false };
  }

  return {
    axis: isHorizontalStructure ? "horizontal" : "vertical",
    reverseHorizontal: parentStructure === "fishbone" && node.depth === 1,
  };
}

/**
 * Resolves the drag-and-drop target, insertion mode (`before`/`after`/`child`/`floating`),
 * and indicator placement for a dragged topic across all 9 mindmap structures.
 */
export function resolveDropTarget(
  sheet: MindmapSheet,
  layout: MindmapLayoutResult,
  draggedTopicId: string,
  worldPoint: { x: number; y: number },
): DropTargetResolution {
  const hits = layout.spatialIndex
    .search({
      minX: worldPoint.x - 10,
      minY: worldPoint.y - 10,
      maxX: worldPoint.x + 10,
      maxY: worldPoint.y + 10,
    })
    .filter((h) => !isTopicSelfOrDescendant(sheet, draggedTopicId, h.topicId));

  if (hits.length === 0) {
    return { dropTargetId: null, dropMode: "floating", indicatorSide: "around" };
  }

  // Pick hit whose contentBox center is closest to the pointer
  let bestTargetId = hits[0].topicId;
  let bestDist = Infinity;
  for (const h of hits) {
    const n = layout.nodes.get(h.topicId);
    if (!n) continue;
    const cx = n.contentBox.x + n.contentBox.width / 2;
    const cy = n.contentBox.y + n.contentBox.height / 2;
    const d = Math.hypot(worldPoint.x - cx, worldPoint.y - cy);
    if (d < bestDist) {
      bestDist = d;
      bestTargetId = h.topicId;
    }
  }

  const targetNode = layout.nodes.get(bestTargetId);
  const targetLoc = findTopicLocation(sheet, bestTargetId);
  if (!targetNode || !targetLoc) {
    return { dropTargetId: null, dropMode: "floating", indicatorSide: "around" };
  }

  // Root, floating roots, and summary roots can only accept children (no sibling insertion)
  if (bestTargetId === sheet.rootTopic.id || !targetLoc.parent || targetLoc.isFloatingRoot || targetLoc.isSummaryRoot) {
    return { dropTargetId: bestTargetId, dropMode: "child", indicatorSide: "around" };
  }

  const { axis, reverseHorizontal } = resolveSiblingDropOrientation(sheet, layout, bestTargetId);
  const box = targetNode.contentBox;

  if (axis === "horizontal") {
    const relX = (worldPoint.x - box.x) / Math.max(1, box.width);
    if (relX < 0.25) {
      return {
        dropTargetId: bestTargetId,
        dropMode: reverseHorizontal ? "after" : "before",
        indicatorSide: "left",
      };
    }
    if (relX > 0.75) {
      return {
        dropTargetId: bestTargetId,
        dropMode: reverseHorizontal ? "before" : "after",
        indicatorSide: "right",
      };
    }
    return { dropTargetId: bestTargetId, dropMode: "child", indicatorSide: "around" };
  }

  const relY = (worldPoint.y - box.y) / Math.max(1, box.height);
  if (relY < 0.25) {
    return { dropTargetId: bestTargetId, dropMode: "before", indicatorSide: "top" };
  }
  if (relY > 0.75) {
    return { dropTargetId: bestTargetId, dropMode: "after", indicatorSide: "bottom" };
  }
  return { dropTargetId: bestTargetId, dropMode: "child", indicatorSide: "around" };
}
