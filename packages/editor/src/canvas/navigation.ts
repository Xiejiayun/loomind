import {
  findTopicLocation,
  type CameraState,
  type LayoutNode,
  type MindmapLayoutResult,
  type MindmapSheet,
} from "@mindmap/core";

export type ArrowDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

interface Vec2 {
  x: number;
  y: number;
}

function centerOf(node: LayoutNode): Vec2 {
  return {
    x: node.contentBox.x + node.contentBox.width / 2,
    y: node.contentBox.y + node.contentBox.height / 2,
  };
}

function dirDelta(from: Vec2, to: Vec2, dir: ArrowDirection): { primary: number; perp: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  switch (dir) {
    case "ArrowRight":
      return { primary: dx, perp: dy };
    case "ArrowLeft":
      return { primary: -dx, perp: dy };
    case "ArrowDown":
      return { primary: dy, perp: dx };
    case "ArrowUp":
      return { primary: -dy, perp: dx };
  }
}

function isHorizontalDir(dir: ArrowDirection): boolean {
  return dir === "ArrowLeft" || dir === "ArrowRight";
}

function matchesSide(side: LayoutNode["side"], dir: ArrowDirection): boolean {
  return (
    (side === "right" && dir === "ArrowRight") ||
    (side === "left" && dir === "ArrowLeft") ||
    (side === "bottom" && dir === "ArrowDown") ||
    (side === "top" && dir === "ArrowUp")
  );
}

function isOppositeSide(side: LayoutNode["side"], dir: ArrowDirection): boolean {
  return (
    (side === "right" && dir === "ArrowLeft") ||
    (side === "left" && dir === "ArrowRight") ||
    (side === "bottom" && dir === "ArrowUp") ||
    (side === "top" && dir === "ArrowDown")
  );
}

/**
 * Structure-aware arrow-key navigation across all 9 mindmap layouts.
 * Priority:
 *  1. Direct parent (when moving opposite the branch expansion direction)
 *  2. Direct visible child aligned with `dir`
 *  3. Adjacent visible sibling along the sibling layout axis (vertical or horizontal)
 *  4. Spatially nearest visible node in `dir` (cross-branch, floating, matrix, fishbone, etc.)
 */
export function findNextTopicByArrow(
  sheet: MindmapSheet,
  layout: MindmapLayoutResult,
  currentId: string | undefined,
  dir: ArrowDirection,
): string | null {
  if (!currentId) {
    return layout.nodes.has(sheet.rootTopic.id)
      ? sheet.rootTopic.id
      : layout.nodes.keys().next().value ?? null;
  }

  const curNode = layout.nodes.get(currentId);
  if (!curNode) {
    return layout.nodes.has(sheet.rootTopic.id) ? sheet.rootTopic.id : null;
  }

  const curCenter = centerOf(curNode);
  const loc = findTopicLocation(sheet, currentId);

  // 1. Move to parent when pressing opposite the branch side and parent lies in that direction
  if (loc?.parent) {
    const parentNode = layout.nodes.get(loc.parent.id);
    if (parentNode) {
      const parentCenter = centerOf(parentNode);
      const { primary, perp } = dirDelta(curCenter, parentCenter, dir);
      if (isOppositeSide(curNode.side, dir) && primary > 4) {
        return loc.parent.id;
      }
      // Handle structures where parent is clearly directly in `dir` (e.g. indented ArrowUp from first child)
      if (primary > 8 && Math.abs(perp) <= primary * 0.6 && curNode.side === "center") {
        return loc.parent.id;
      }
    }
  }

  // 2. Move into visible children aligned with `dir`
  if (loc && !loc.topic.collapsed && loc.topic.children.length > 0) {
    const visibleChildren = loc.topic.children
      .map((c) => layout.nodes.get(c.id))
      .filter((n): n is LayoutNode => Boolean(n));

    if (visibleChildren.length > 0) {
      const matchingChildren = visibleChildren.filter((childNode) => {
        const { primary, perp } = dirDelta(curCenter, centerOf(childNode), dir);
        if (primary <= 8) return false;
        if (childNode.side !== "center") {
          return matchesSide(childNode.side, dir);
        }
        return primary > Math.abs(perp);
      });

      if (matchingChildren.length > 0) {
        // Pick the child most visually aligned with current node on the perpendicular axis
        let best = matchingChildren[0];
        let bestScore = Infinity;
        for (const childNode of matchingChildren) {
          const { primary, perp } = dirDelta(curCenter, centerOf(childNode), dir);
          const score = Math.abs(perp) * 2 + primary * 0.25;
          if (score < bestScore) {
            bestScore = score;
            best = childNode;
          }
        }
        return best.id;
      }
    }
  }

  // 3. Move to adjacent visible sibling along the sibling axis
  if (loc?.parent) {
    const siblings = loc.parent.children
      .map((c) => layout.nodes.get(c.id))
      .filter((n): n is LayoutNode => n !== undefined && (curNode.depth > 1 || n.side === curNode.side));

    if (siblings.length > 1) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const s of siblings) {
        const c = centerOf(s);
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      const horizontalSiblings = maxX - minX > maxY - minY;

      if (horizontalSiblings && isHorizontalDir(dir)) {
        const sorted = [...siblings].sort((a, b) => centerOf(a).x - centerOf(b).x);
        const idx = sorted.findIndex((s) => s.id === currentId);
        const nextIdx = dir === "ArrowRight" ? idx + 1 : idx - 1;
        if (idx >= 0 && nextIdx >= 0 && nextIdx < sorted.length) {
          return sorted[nextIdx].id;
        }
      } else if (!horizontalSiblings && !isHorizontalDir(dir)) {
        const sorted = [...siblings].sort((a, b) => centerOf(a).y - centerOf(b).y);
        const idx = sorted.findIndex((s) => s.id === currentId);
        const nextIdx = dir === "ArrowDown" ? idx + 1 : idx - 1;
        if (idx >= 0 && nextIdx >= 0 && nextIdx < sorted.length) {
          return sorted[nextIdx].id;
        }
      }
    }
  }

  // 4. Spatial nearest-neighbor fallback in `dir`
  let bestConeId: string | null = null;
  let bestConeScore = Infinity;
  let bestAnyId: string | null = null;
  let bestAnyScore = Infinity;

  for (const [id, node] of layout.nodes) {
    if (id === currentId) continue;
    const { primary, perp } = dirDelta(curCenter, centerOf(node), dir);
    if (primary <= 6) continue;
    const absPerp = Math.abs(perp);
    const score = primary + absPerp * 2.2;

    if (absPerp <= primary * 2.5 + 120) {
      if (score < bestConeScore) {
        bestConeScore = score;
        bestConeId = id;
      }
    }
    if (score < bestAnyScore) {
      bestAnyScore = score;
      bestAnyId = id;
    }
  }

  return bestConeId ?? bestAnyId;
}

/**
 * Computes a minimal camera pan `{ x, y }` to bring `node` inside the viewport
 * with padding, or returns `null` if the node is already fully visible.
 */
export function computePanToRevealNode(
  node: LayoutNode,
  camera: CameraState,
  viewport: { width: number; height: number },
  margin = 56,
): { x: number; y: number } | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const left = node.contentBox.x * camera.scale + camera.x;
  const right = (node.contentBox.x + node.contentBox.width) * camera.scale + camera.x;
  const top = node.contentBox.y * camera.scale + camera.y;
  const bottom = (node.contentBox.y + node.contentBox.height) * camera.scale + camera.y;

  let nextX = camera.x;
  let nextY = camera.y;

  const effMarginX = Math.min(margin, viewport.width * 0.25);
  const effMarginY = Math.min(margin, viewport.height * 0.25);

  if (left < effMarginX) {
    nextX += effMarginX - left;
  } else if (right > viewport.width - effMarginX) {
    nextX -= right - (viewport.width - effMarginX);
  }

  if (top < effMarginY) {
    nextY += effMarginY - top;
  } else if (bottom > viewport.height - effMarginY) {
    nextY -= bottom - (viewport.height - effMarginY);
  }

  if (nextX === camera.x && nextY === camera.y) return null;
  return { x: nextX, y: nextY };
}
