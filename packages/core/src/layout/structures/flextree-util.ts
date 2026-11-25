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
  const underlineY = Math.round((b.y + b.height - 1) * 10) / 10;
  if (side === "left") {
    return { x: b.x, y: node.underlineMode ? underlineY : b.y + b.height / 2 };
  }
  if (side === "right") {
    return { x: b.x + b.width, y: node.underlineMode ? underlineY : b.y + b.height / 2 };
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
    // Slightly tuck endpoints into pill cards so there is never a hairline seam
    const dir = p3.x >= p0.x ? 1 : -1;
    const adjP0 = { x: p0.x - dir * 1.5, y: p0.y };
    const adjP3 = { x: p3.x + dir * 1.5, y: p3.y };
    const res = buildTaperedRibbonPath(adjP0, adjP3, 7.0, 1.8);
    svgPath = handdrawn ? buildRoughSvgPath(res.svgPath, seed) : res.svgPath;
    fillPath = handdrawn ? undefined : res.fillPath;
  } else if (kind === "elbow") {
    let raw = buildElbowPath(p0, p3, opts?.verticalFirst);
    if (childNode.underlineMode && !opts?.verticalFirst) {
      const farX =
        childNode.side === "left"
          ? childNode.contentBox.x
          : childNode.contentBox.x + childNode.contentBox.width;
      raw = `${raw} H ${Math.round(farX * 10) / 10}`;
      childNode.underlineDrawnByEdge = true;
    }
    svgPath = handdrawn ? buildRoughSvgPath(raw, seed) : raw;
  } else {
    let { svgPath: raw } = buildBezierPath(p0, p3, !opts?.verticalFirst);
    if (childNode.underlineMode && !opts?.verticalFirst) {
      const farX =
        childNode.side === "left"
          ? childNode.contentBox.x
          : childNode.contentBox.x + childNode.contentBox.width;
      raw = `${raw} H ${Math.round(farX * 10) / 10}`;
      childNode.underlineDrawnByEdge = true;
    }
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
    strokeWidth:
      childNode.underlineDrawnByEdge
        ? Math.max(1.2, childNode.strokeWidth)
        : parentNode.depth === 0
          ? 2.6
          : 1.6,
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
  const useSharedElbowBus = !opts?.skipEdges && ctx.skeleton.defaultEdgeKind === "elbow";
  const elbowGroups = new Map<string, { pNode: LayoutNode; children: LayoutNode[] }>();

  const recordElbow = (pNode: LayoutNode, cNode: LayoutNode) => {
    let group = elbowGroups.get(pNode.id);
    if (!group) {
      group = { pNode, children: [] };
      elbowGroups.set(pNode.id, group);
    }
    group.children.push(cNode);
  };

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
        if (useSharedElbowBus) {
          recordElbow(pNode, cNode);
        } else {
          const p0 = anchorForSide(pNode, dir === 1 ? "right" : "left");
          const p3 = anchorForSide(cNode, dir === 1 ? "left" : "right");
          ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx));
        }
      }
      return;
    }

    const cNode = ctx.makeLayoutNode(t, x, y, side);
    ctx.nodes.set(t.id, cNode);
    placedNodes.set(t.id, cNode);
    bounds = unionBox(bounds, cNode.box);

    if (!opts?.skipEdges) {
      if (useSharedElbowBus) {
        recordElbow(pNode, cNode);
      } else {
        const p0 = anchorForSide(pNode, dir === 1 ? "right" : "left");
        const p3 = anchorForSide(cNode, dir === 1 ? "left" : "right");
        ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx));
      }
    }
  });

  if (useSharedElbowBus) {
    const rr = (n: number) => Math.round(n * 10) / 10;
    const handdrawn = ctx.theme.handdrawn;
    for (const { pNode, children: kids } of elbowGroups.values()) {
      const p0 = anchorForSide(pNode, dir === 1 ? "right" : "left");
      if (kids.length === 1) {
        const cNode = kids[0];
        const p3 = anchorForSide(cNode, dir === 1 ? "left" : "right");
        ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx));
        continue;
      }

      const items = kids.map((cNode) => ({
        cNode,
        p3: anchorForSide(cNode, dir === 1 ? "left" : "right"),
      }));
      const targetRailX =
        dir === 1
          ? Math.min(...items.map((it) => it.p3.x))
          : Math.max(...items.map((it) => it.p3.x));
      const xm = (p0.x + targetRailX) / 2;
      const baseStroke = pNode.depth === 0 ? 2.4 : 1.6;

      // Single horizontal stem from parent to shared vertical rail
      const stemRaw = `M ${rr(p0.x)} ${rr(p0.y)} H ${rr(xm)}`;
      const stemSeed = fnv1aSeed(`elbow-stem:${pNode.id}:${dir}`);
      ctx.edges.push({
        id: `elbow-stem:${pNode.id}:${dir}`,
        fromId: pNode.id,
        toId: kids[0].id,
        kind: "elbow",
        svgPath: handdrawn ? buildRoughSvgPath(stemRaw, stemSeed) : stemRaw,
        color: pNode.depth === 0 && ctx.theme.rainbowBranches ? pNode.accentColor : kids[0].accentColor,
        strokeWidth: baseStroke,
        handdrawn,
        seed: stemSeed,
      });

      const upper = items
        .filter((it) => it.p3.y <= p0.y)
        .sort((a, b) => b.p3.y - a.p3.y);
      const lower = items
        .filter((it) => it.p3.y > p0.y)
        .sort((a, b) => a.p3.y - b.p3.y);

      const emitVerticalSide = (list: typeof items) => {
        let prevY = p0.y;
        for (const { cNode, p3 } of list) {
          let endX = p3.x;
          if (cNode.underlineMode) {
            endX =
              cNode.side === "left"
                ? cNode.contentBox.x
                : cNode.contentBox.x + cNode.contentBox.width;
            cNode.underlineDrawnByEdge = true;
          }
          const raw =
            Math.abs(p3.y - prevY) < 0.2
              ? `M ${rr(xm)} ${rr(prevY)} H ${rr(endX)}`
              : `M ${rr(xm)} ${rr(prevY)} V ${rr(p3.y)} H ${rr(endX)}`;
          const seed = fnv1aSeed(`${pNode.id}->${cNode.id}`);
          ctx.edges.push({
            id: `e:${pNode.id}->${cNode.id}`,
            fromId: pNode.id,
            toId: cNode.id,
            kind: "elbow",
            svgPath: handdrawn ? buildRoughSvgPath(raw, seed) : raw,
            color: cNode.accentColor,
            strokeWidth: cNode.underlineDrawnByEdge ? Math.max(1.2, cNode.strokeWidth) : baseStroke,
            handdrawn,
            seed,
          });
          prevY = p3.y;
        }
      };

      emitVerticalSide(upper);
      emitVerticalSide(lower);
    }
  }

  return bounds;
}
