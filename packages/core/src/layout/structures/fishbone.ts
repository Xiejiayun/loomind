import type { MindmapTopic } from "../../model/document.js";
import { buildRoughSvgPath, fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const fishboneStructurePlugin: StructureLayoutPlugin = {
  structure: "fishbone",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const spineY = parentNode.contentBox.y + parentNode.contentBox.height / 2;
    const headLeftX = parentNode.contentBox.x;
    const tan60 = Math.tan(Math.PI / 3);
    const levelGap = ctx.skeleton.levelGap * ctx.spacingScale;
    const siblingGap = ctx.skeleton.siblingGap * ctx.spacingScale;
    const ribGapX = 40 * ctx.spacingScale;
    const subGapY = 14 * ctx.spacingScale;

    // Estimate the full bounding size of any left-expanding subtree
    const estimateSubtreeSize = (t: MindmapTopic): { width: number; height: number } => {
      const m = ctx.measurements.get(t.id)!;
      if (t.collapsed || t.children.length === 0) {
        return { width: m.width, height: m.height };
      }
      const kidSizes = t.children.map(estimateSubtreeSize);
      const maxKidW = Math.max(...kidSizes.map((s) => s.width));
      const totalKidH =
        kidSizes.reduce((acc, s) => acc + s.height, 0) + (kidSizes.length - 1) * siblingGap;
      return {
        width: m.width + levelGap + maxKidW,
        height: Math.max(m.height, totalKidH),
      };
    };

    // Pre-compute required vertical rib height for upper and lower halves independently
    const calcRibRequiredHeight = (child: MindmapTopic): number => {
      if (child.collapsed || child.children.length === 0) return 110 * ctx.spacingScale;
      const heights = child.children.map((g) => estimateSubtreeSize(g).height);
      const sumH = heights.reduce((a, b) => a + b, 0) + heights.length * subGapY;
      return Math.max(120 * ctx.spacingScale, sumH + 44);
    };

    const aboveChildren = parent.children.filter((_, i) => i % 2 === 0);
    const belowChildren = parent.children.filter((_, i) => i % 2 === 1);

    const upperRibH = Math.max(120 * ctx.spacingScale, ...aboveChildren.map(calcRibRequiredHeight));
    const lowerRibH = Math.max(120 * ctx.spacingScale, ...belowChildren.map(calcRibRequiredHeight));

    let bounds = parentNode.box;
    let tailX = headLeftX - 90;

    // Layout one side (above = true or false) from right to left with dynamic horizontal clearance
    const layoutSide = (ribs: MindmapTopic[], above: boolean, ribHeight: number, startOffsetX: number) => {
      // Rightmost available X boundary for the next rib's header and its right-edge join
      let rightLimitX = headLeftX - startOffsetX;

      for (const child of ribs) {
        const m = ctx.measurements.get(child.id)!;
        const tipDx = ribHeight / tan60;

        // Ensure header right edge (tipX + m.width / 2) AND joinX stay strictly <= rightLimitX
        const joinX = Math.min(rightLimitX, rightLimitX + tipDx - m.width / 2);
        const tipX = joinX - tipDx;
        const tipY = above ? spineY - ribHeight : spineY + ribHeight;

        const nodeX = tipX - m.width / 2;
        const nodeY = above ? tipY - m.height : tipY;

        const cNode = ctx.makeLayoutNode(child, nodeX, nodeY, "left");
        ctx.nodes.set(child.id, cNode);
        bounds = unionBox(bounds, cNode.box);

        let ribLeftmostX = Math.min(nodeX, tipX);

        // Slanted primary rib (±60°) starting cleanly on the near edge of the spine (never pokes through!)
        const spineInset = 1.2;
        const ribStartY = above ? spineY - spineInset : spineY + spineInset;
        const ribStartX = joinX - spineInset / tan60;
        const ribPath = `M ${r(ribStartX)} ${r(ribStartY)} L ${r(tipX)} ${r(tipY)}`;
        const ribSeed = fnv1aSeed(`fish-rib:${child.id}`);
        ctx.edges.push({
          id: `e:${parent.id}->${child.id}`,
          fromId: parent.id,
          toId: child.id,
          kind: "fishbone-rib",
          svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(ribPath, ribSeed, true) : ribPath,
          color: cNode.accentColor,
          strokeWidth: 2.0,
          handdrawn: ctx.theme.handdrawn,
          seed: ribSeed,
        });

        // Stack secondary sub-bones vertically with exact on-rib (rx, ry) attachment
        if (!child.collapsed && child.children.length > 0) {
          const grandSizes = child.children.map((g) => ({
            topic: g,
            est: estimateSubtreeSize(g),
            m: ctx.measurements.get(g.id)!,
          }));

          let curDistFromSpine = 24;
          for (const { topic: grand, est, m: gm } of grandSizes) {
            const centerDist = curDistFromSpine + est.height / 2;
            const t = Math.min(0.88, centerDist / ribHeight);
            const rx = joinX + (tipX - joinX) * t;
            const ry = spineY + (tipY - spineY) * t;

            const gx = rx - 24 - gm.width;
            const gy = ry - gm.height / 2;

            const subBox = ctx.placeSubtree(
              grand,
              gx,
              gy,
              "left",
              grand.structure ?? "logic",
            );
            const gNode = ctx.nodes.get(grand.id)!;
            bounds = unionBox(bounds, subBox);
            ribLeftmostX = Math.min(ribLeftmostX, subBox.x);

            const subPath = `M ${r(rx)} ${r(ry)} H ${r(gNode.contentBox.x + gNode.contentBox.width)}`;
            const subSeed = fnv1aSeed(`fish-sub:${grand.id}`);
            ctx.edges.push({
              id: `e:${child.id}->${grand.id}`,
              fromId: child.id,
              toId: grand.id,
              kind: "fishbone-rib",
              svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(subPath, subSeed, true) : subPath,
              color: cNode.accentColor,
              strokeWidth: 1.5,
              handdrawn: ctx.theme.handdrawn,
              seed: subSeed,
            });

            curDistFromSpine += est.height + subGapY;
          }
        }

        tailX = Math.min(tailX, ribLeftmostX - 36, joinX - 48);
        // Next rib on this side must sit completely to the left of this rib's entire subtree
        rightLimitX = ribLeftmostX - ribGapX;
      }
    };

    layoutSide(aboveChildren, true, upperRibH, 54);
    layoutSide(belowChildren, false, lowerRibH, 96);

    // Main horizontal spine + tail fin chevron on the left + arrow pointing into fish head
    const tailFin =
      `M ${r(tailX - 18)} ${r(spineY - 22)} L ${r(tailX)} ${r(spineY)} L ${r(tailX - 18)} ${r(spineY + 22)} ` +
      `M ${r(tailX)} ${r(spineY)} H ${r(headLeftX - 4)} ` +
      `M ${r(headLeftX - 12)} ${r(spineY - 6)} L ${r(headLeftX - 2)} ${r(spineY)} L ${r(headLeftX - 12)} ${r(spineY + 6)}`;
    const spineSeed = fnv1aSeed(`fish-spine:${parent.id}`);
    ctx.edges.push({
      id: `spine:${parent.id}`,
      fromId: parent.id,
      toId: parent.children[0].id,
      kind: "timeline-spine",
      svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(tailFin, spineSeed) : tailFin,
      color: parentNode.accentColor,
      strokeWidth: 3.2,
      handdrawn: ctx.theme.handdrawn,
      seed: spineSeed,
    });

    return unionBox(bounds, {
      x: tailX - 20,
      y: spineY - 24,
      width: headLeftX - tailX + 22,
      height: 48,
    });
  },
};
