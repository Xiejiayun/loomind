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
    const gapX = 40 * ctx.spacingScale;
    const armY = 34 * ctx.spacingScale;
    const itemGapY = 10 * ctx.spacingScale;

    const estimateIndentedHeight = (t: MindmapTopic): number => {
      const m = ctx.measurements.get(t.id)!;
      if (t.collapsed || t.children.length === 0) return m.height;
      return (
        m.height +
        t.children.reduce((acc, c) => acc + itemGapY + estimateIndentedHeight(c), 0)
      );
    };

    let cursorX = parentNode.box.x + parentNode.box.width + gapX;
    let bounds = parentNode.box;
    let lastAnchorX = parentNode.contentBox.x + parentNode.contentBox.width + 24;

    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      const above = i % 2 === 0;
      const m = ctx.measurements.get(child.id)!;
      const fullSubtreeH = estimateIndentedHeight(child);

      // Place upper branches so the ENTIRE subtree clears the horizontal spine cleanly!
      const childY = above ? spineY - armY - fullSubtreeH : spineY + armY;
      const subBox = ctx.placeSubtree(
        child,
        cursorX,
        childY,
        "right",
        child.structure ?? "indented",
      );
      const cNode = ctx.nodes.get(child.id)!;
      // Align stemX with indented.ts trunkX (cNode.x + 14) so upper stems run seamlessly
      // from the spine all the way up into cNode with zero gap and zero card crossing!
      const stemX =
        child.children.length > 0 && !child.collapsed
          ? cNode.contentBox.x + 14
          : cNode.contentBox.x + Math.min(20, cNode.contentBox.width / 2);
      const spineInset = 1.2;
      const stemStartY = above ? spineY - spineInset : spineY + spineInset;
      const targetY = above
        ? cNode.contentBox.y + cNode.contentBox.height
        : cNode.contentBox.y;

      const stemPath = `M ${r(stemX)} ${r(stemStartY)} V ${r(targetY)}`;
      const seed = fnv1aSeed(`tl-stem:${child.id}`);
      ctx.edges.push({
        id: `e:${parent.id}->${child.id}`,
        fromId: parent.id,
        toId: child.id,
        kind: "elbow",
        svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(stemPath, seed, true) : stemPath,
        color: cNode.accentColor,
        strokeWidth: 2,
        handdrawn: ctx.theme.handdrawn,
        seed,
      });

      // Milestone dot on spine
      const dotR = 4.5;
      const dotPath = `M ${r(stemX - dotR)} ${r(spineY)} A ${dotR} ${dotR} 0 1 0 ${r(stemX + dotR)} ${r(spineY)} A ${dotR} ${dotR} 0 1 0 ${r(stemX - dotR)} ${r(spineY)} Z`;
      ctx.edges.push({
        id: `tl-dot:${child.id}`,
        fromId: parent.id,
        toId: child.id,
        kind: "tapered",
        svgPath: dotPath,
        fillPath: dotPath,
        color: cNode.accentColor,
        strokeWidth: 1,
        handdrawn: false,
        seed,
      });

      lastAnchorX = Math.max(lastAnchorX, stemX + 28);
      bounds = unionBox(bounds, subBox);
      cursorX = Math.max(cursorX + m.width, subBox.x + subBox.width) + gapX;
    }

    // Main horizontal timeline spine with subtle right arrow chevron
    const spineStartX = parentNode.contentBox.x + parentNode.contentBox.width;
    const spinePath =
      `M ${r(spineStartX)} ${r(spineY)} H ${r(lastAnchorX)} ` +
      `M ${r(lastAnchorX - 8)} ${r(spineY - 6)} L ${r(lastAnchorX)} ${r(spineY)} L ${r(lastAnchorX - 8)} ${r(spineY + 6)}`;
    const spineSeed = fnv1aSeed(`tl-spine:${parent.id}`);
    ctx.edges.push({
      id: `spine:${parent.id}`,
      fromId: parent.id,
      toId: parent.children[parent.children.length - 1].id,
      kind: "timeline-spine",
      svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(spinePath, spineSeed, true) : spinePath,
      color: parentNode.accentColor,
      strokeWidth: 3.5,
      handdrawn: ctx.theme.handdrawn,
      seed: spineSeed,
    });

    return unionBox(bounds, { x: spineStartX, y: spineY - 8, width: lastAnchorX - spineStartX + 4, height: 16 });
  },
};
