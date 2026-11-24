import type { MindmapTopic } from "../../model/document.js";
import { buildRoughSvgPath, fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const fishboneStructurePlugin: StructureLayoutPlugin = {
  structure: "fishbone",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    // Fish head is on the right (parentNode); main spine extends leftward
    const spineY = parentNode.contentBox.y + parentNode.contentBox.height / 2;
    const headLeftX = parentNode.contentBox.x;
    const ribStepX = 185 * ctx.spacingScale;
    const ribHeight = 132 * ctx.spacingScale;
    const tan60 = Math.tan(Math.PI / 3);

    let bounds = parentNode.box;
    let tailX = headLeftX - 90;

    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      const above = i % 2 === 0;
      const pairIdx = Math.floor(i / 2);
      const joinX = headLeftX - 54 - pairIdx * ribStepX - (above ? 0 : 48);
      const m = ctx.measurements.get(child.id)!;

      const tipDx = ribHeight / tan60;
      const tipX = joinX - tipDx;
      const tipY = above ? spineY - ribHeight : spineY + ribHeight;

      const nodeX = tipX - m.width / 2;
      const nodeY = above ? tipY - m.height - 4 : tipY + 4;

      const cNode = ctx.makeLayoutNode(child, nodeX, nodeY, "left");
      ctx.nodes.set(child.id, cNode);
      bounds = unionBox(bounds, cNode.box);
      tailX = Math.min(tailX, joinX - 60, nodeX - 32);

      // Slanted primary rib (±60°)
      const ribPath = `M ${r(joinX)} ${r(spineY)} L ${r(tipX)} ${r(tipY)}`;
      const ribSeed = fnv1aSeed(`fish-rib:${child.id}`);
      ctx.edges.push({
        id: `e:${parent.id}->${child.id}`,
        fromId: parent.id,
        toId: child.id,
        kind: "fishbone-rib",
        svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(ribPath, ribSeed) : ribPath,
        color: cNode.accentColor,
        strokeWidth: 2.2,
        handdrawn: ctx.theme.handdrawn,
        seed: ribSeed,
      });

      // Secondary horizontal sub-bones spaced well clear of the main spine (t in [0.36, 0.82])
      if (!child.collapsed && child.children.length > 0) {
        const count = child.children.length;
        for (let j = 0; j < count; j++) {
          const grand = child.children[j];
          const t = count === 1 ? 0.56 : 0.36 + (0.46 * j) / (count - 1);
          const rx = joinX + (tipX - joinX) * t;
          const ry = spineY + (tipY - spineY) * t;
          const gm = ctx.measurements.get(grand.id)!;
          const gx = rx - 22 - gm.width;
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
          tailX = Math.min(tailX, subBox.x - 36);

          const subPath = `M ${r(rx)} ${r(ry)} H ${r(gNode.contentBox.x + gNode.contentBox.width)}`;
          const subSeed = fnv1aSeed(`fish-sub:${grand.id}`);
          ctx.edges.push({
            id: `e:${child.id}->${grand.id}`,
            fromId: child.id,
            toId: grand.id,
            kind: "fishbone-rib",
            svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(subPath, subSeed) : subPath,
            color: cNode.accentColor,
            strokeWidth: 1.5,
            handdrawn: ctx.theme.handdrawn,
            seed: subSeed,
          });
        }
      }
    }

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
