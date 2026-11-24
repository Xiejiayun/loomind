import type { MindmapTopic } from "../../model/document.js";
import { buildRoughSvgPath, fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const indentedStructurePlugin: StructureLayoutPlugin = {
  structure: "indented",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const indentX = 28;
    const gapY = 10 * ctx.spacingScale;
    let cursorY = parentNode.box.y + parentNode.box.height + gapY;
    let bounds = parentNode.box;

    const trunkX = parentNode.contentBox.x + 14;
    const trunkStartY = parentNode.contentBox.y + parentNode.contentBox.height;

    for (const child of parent.children) {
      const childX = parentNode.box.x + indentX;
      const subBox = ctx.placeSubtree(
        child,
        childX,
        cursorY,
        "right",
        child.structure ?? "indented",
      );
      const cNode = ctx.nodes.get(child.id)!;
      const targetY = cNode.contentBox.y + cNode.contentBox.height / 2;
      const rawPath = `M ${r(trunkX)} ${r(trunkStartY)} V ${r(targetY)} H ${r(cNode.contentBox.x)}`;
      const seed = fnv1aSeed(`ind:${parent.id}->${child.id}`);
      ctx.edges.push({
        id: `e:${parent.id}->${child.id}`,
        fromId: parent.id,
        toId: child.id,
        kind: "elbow",
        svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(rawPath, seed) : rawPath,
        color: cNode.accentColor,
        strokeWidth: 1.5,
        handdrawn: ctx.theme.handdrawn,
        seed,
      });

      bounds = unionBox(bounds, subBox);
      cursorY = subBox.y + subBox.height + gapY;
    }

    return bounds;
  },
};
