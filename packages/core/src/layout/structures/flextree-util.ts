import { flextree } from "d3-flextree";
import type { MindmapTopic } from "../../model/document.js";
import {
  buildBezierPath,
  buildElbowPath,
  buildRoughSvgPath,
  buildTaperedRibbonPath,
  fnv1aSeed,
} from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutEdge, LayoutNode, Point } from "../types.js";

export function unionBox(a: LayoutBox, b: LayoutBox): LayoutBox {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function anchorForSide(
  node: LayoutNode,
  side: "left" | "right" | "top" | "bottom",
): Point {
  const b = node.contentBox;
  if (side === "left") {
    return { x: b.x, y: node.underlineMode ? b.y + b.height : b.y + b.height / 2 };
  }
  if (side === "right") {
    return { x: b.x + b.width, y: node.underlineMode ? b.y + b.height : b.y + b.height / 2 };
  }
  if (side === "top") {
    return { x: b.x + b.width / 2, y: b.y };
  }
  return { x: b.x + b.width / 2, y: b.y + b.height };
}

export function createStandardEdge(
  parentNode: LayoutNode,
  childNode: LayoutNode,
  p0: Point,
  p3: Point,
  ctx: LayoutBuildContext,
  opts?: { forceKind?: LayoutEdge["kind"]; verticalFirst?: boolean },
): LayoutEdge {
  const defaultKind = ctx.skeleton.defaultEdgeKind;
  const kind: LayoutEdge["kind"] =
    opts?.forceKind ??
    (defaultKind === "tapered" && parentNode.depth === 0 ? "tapered" : defaultKind === "tapered" ? "bezier" : defaultKind);

  const seed = fnv1aSeed(`${parentNode.id}->${childNode.id}`);
  const handdrawn = ctx.theme.handdrawn;
  let svgPath: string;
  let fillPath: string | undefined;

  if (kind === "tapered") {
    const res = buildTaperedRibbonPath(p0, p3, 7.0, 1.8);
    svgPath = handdrawn ? buildRoughSvgPath(res.svgPath, seed) : res.svgPath;
    fillPath = handdrawn ? undefined : res.fillPath;
  } else if (kind === "elbow") {
    const raw = buildElbowPath(p0, p3, opts?.verticalFirst);
    svgPath = handdrawn ? buildRoughSvgPath(raw, seed) : raw;
  } else {
    const { svgPath: raw } = buildBezierPath(p0, p3, !opts?.verticalFirst);
    svgPath = handdrawn ? buildRoughSvgPath(raw, seed) : raw;
  }

  return {
    id: `e:${parentNode.id}->${childNode.id}`,
    fromId: parentNode.id,
    toId: childNode.id,
    kind,
    svgPath,
    fillPath,
    color: childNode.accentColor,
    strokeWidth: parentNode.depth === 0 ? 2.6 : 1.6,
    handdrawn,
    seed,
  };
}

interface FlexDatum {
  topic: MindmapTopic;
  size: [number, number];
  children?: FlexDatum[];
}

/**
 * Lay out a one-sided horizontal tree (dir = +1 right, -1 left) using d3-flextree.
 * Stops flextree recursion whenever a child overrides `topic.structure`, delegating
 * that child's subtree back to `ctx.placeSubtree`.
 */
export function layoutHorizontalFlextree(
  parent: MindmapTopic,
  parentNode: LayoutNode,
  children: MindmapTopic[],
  dir: 1 | -1,
  ctx: LayoutBuildContext,
  opts?: { levelGap?: number; siblingGap?: number; skipEdges?: boolean },
): LayoutBox {
  if (children.length === 0) return parentNode.box;

  const levelGap = (opts?.levelGap ?? ctx.skeleton.levelGap) * ctx.spacingScale;
  const siblingGap = (opts?.siblingGap ?? ctx.skeleton.siblingGap) * ctx.spacingScale;
  const parentStructure = parent.structure ?? ctx.sheet.structure;
  const side: LayoutNode["side"] = dir === 1 ? "right" : "left";

  const buildDatum = (t: MindmapTopic, isRoot: boolean): FlexDatum => {
    const m = ctx.measurements.get(t.id)!;
    const keepFlex =
      isRoot ||
      (!t.collapsed &&
        t.children.length > 0 &&
        (!t.structure || t.structure === parentStructure || t.structure === "logic" || t.structure === "mindmap"));

    const kids = isRoot
      ? children.map((c) => buildDatum(c, false))
      : keepFlex && !t.collapsed
        ? t.children.map((c) => buildDatum(c, false))
        : undefined;

    return {
      topic: t,
      // d3-flextree uses [breadth, depth] -> for horizontal tree: [height + siblingGap, width + levelGap]
      size: [m.height + siblingGap, m.width + levelGap],
      children: kids && kids.length > 0 ? kids : undefined,
    };
  };

  const rootDatum = buildDatum(parent, true);
  const layout = flextree<FlexDatum>({
    nodeSize: (n) => n.data.size,
    spacing: () => 0,
  });

  const treeRoot = layout.hierarchy(rootDatum);
  layout(treeRoot);

  // Align flextree root with parentNode.box
  const rootCenterY = parentNode.box.y + parentNode.box.height / 2;
  const offsetY = rootCenterY - treeRoot.x;

  let bounds = parentNode.box;
  const placedNodes = new Map<string, LayoutNode>();
  placedNodes.set(parent.id, parentNode);

  treeRoot.each((node) => {
    if (node === treeRoot) return;
    const t = node.data.topic;
    const m = ctx.measurements.get(t.id)!;
    const pTopic = node.parent!.data.topic;
    const pNode = placedNodes.get(pTopic.id)!;

    const x =
      dir === 1
        ? parentNode.box.x + node.y
        : parentNode.box.x + parentNode.box.width - node.y - m.width;
    const y = node.x + offsetY - m.height / 2;

    const hasCustomStructure = Boolean(t.structure && t.structure !== parentStructure && t.structure !== "logic" && t.structure !== "mindmap");

    if (hasCustomStructure && !t.collapsed && t.children.length > 0) {
      const subBox = ctx.placeSubtree(t, x, y, side, t.structure!);
      const cNode = ctx.nodes.get(t.id)!;
      placedNodes.set(t.id, cNode);
      bounds = unionBox(bounds, subBox);
      if (!opts?.skipEdges) {
        const p0 = anchorForSide(pNode, dir === 1 ? "right" : "left");
        const p3 = anchorForSide(cNode, dir === 1 ? "left" : "right");
        ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx));
      }
      return;
    }

    const cNode = ctx.makeLayoutNode(t, x, y, side);
    ctx.nodes.set(t.id, cNode);
    placedNodes.set(t.id, cNode);
    bounds = unionBox(bounds, cNode.box);

    if (!opts?.skipEdges) {
      const p0 = anchorForSide(pNode, dir === 1 ? "right" : "left");
      const p3 = anchorForSide(cNode, dir === 1 ? "left" : "right");
      ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx));
    }
  });

  return bounds;
}
