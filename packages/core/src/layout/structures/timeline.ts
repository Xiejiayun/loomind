import type { MindmapTopic } from "../../model/document.js";
import { buildRoughSvgPath, fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const timelineStructurePlugin: StructureLayoutPlugin = {
  structure: "timeline",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const spineY = parentNode.contentBox.y + parentNode.contentBox.height / 2;
    const gapX = 36 * ctx.spacingScale;
    const armY = 34 * ctx.spacingScale;
    let cursorX = parentNode.box.x + parentNode.box.width + gapX;
    let bounds = parentNode.box;
    let lastAnchorX = parentNode.contentBox.x + parentNode.contentBox.width;

    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      const above = i % 2 === 0;
      const m = ctx.measurements.get(child.id)!;

      const childY = above ? spineY - armY - m.height : spineY + armY;
      const subBox = ctx.placeSubtree(
        child,
        cursorX,
        childY,
        "right",
        child.structure ?? "indented",
      );
      const cNode = ctx.nodes.get(child.id)!;
      const stemX = cNode.contentBox.x + Math.min(24, cNode.contentBox.width / 2);
      const targetY = above
        ? cNode.contentBox.y + cNode.contentBox.height
        : cNode.contentBox.y;

      const stemPath = `M ${r(stemX)} ${r(spineY)} V ${r(targetY)}`;
      const seed = fnv1aSeed(`tl-stem:${child.id}`);
      ctx.edges.push({
        id: `e:${parent.id}->${child.id}`,
        fromId: parent.id,
        toId: child.id,
        kind: "elbow",
        svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(stemPath, seed) : stemPath,
        color: cNode.accentColor,
        strokeWidth: 2,
        handdrawn: ctx.theme.handdrawn,
        seed,
      });

      lastAnchorX = Math.max(lastAnchorX, stemX + 16);
      bounds = unionBox(bounds, subBox);
      cursorX = Math.max(cursorX + m.width, subBox.x + subBox.width) + gapX;
    }

    // Main horizontal timeline spine
    const spineStartX = parentNode.contentBox.x + parentNode.contentBox.width;
    const spinePath = `M ${r(spineStartX)} ${r(spineY)} H ${r(lastAnchorX)}`;
    const spineSeed = fnv1aSeed(`tl-spine:${parent.id}`);
    ctx.edges.push({
      id: `spine:${parent.id}`,
      fromId: parent.id,
      toId: parent.children[parent.children.length - 1].id,
      kind: "timeline-spine",
      svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(spinePath, spineSeed) : spinePath,
      color: parentNode.accentColor,
      strokeWidth: 4,
      handdrawn: ctx.theme.handdrawn,
      seed: spineSeed,
    });

    return bounds;
  },
};
