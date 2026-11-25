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
    const trunkStartY = parentNode.underlineMode
      ? parentNode.contentBox.y + parentNode.contentBox.height - 1
      : parentNode.contentBox.y + parentNode.contentBox.height;

    let prevY = trunkStartY;

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
      const targetY = cNode.underlineMode
        ? Math.round((cNode.contentBox.y + cNode.contentBox.height - 1) * 10) / 10
        : cNode.contentBox.y + cNode.contentBox.height / 2;
      const endX = cNode.underlineMode
        ? cNode.contentBox.x + cNode.contentBox.width
        : cNode.contentBox.x;
      if (cNode.underlineMode) {
        cNode.underlineDrawnByEdge = true;
      }

      // Chain vertical trunk segment from previous child's junction so each vertical span
      // is drawn exactly once (zero multi-stroke overlap & zero color overwriting).
      const rawPath = `M ${r(trunkX)} ${r(prevY)} V ${r(targetY)} H ${r(endX)}`;
      const seed = fnv1aSeed(`ind:${parent.id}->${child.id}`);
      ctx.edges.push({
        id: `e:${parent.id}->${child.id}`,
        fromId: parent.id,
        toId: child.id,
        kind: "elbow",
        svgPath: ctx.theme.handdrawn ? buildRoughSvgPath(rawPath, seed) : rawPath,
        color: cNode.accentColor,
        strokeWidth: cNode.underlineDrawnByEdge ? Math.max(1.2, cNode.strokeWidth) : 1.5,
        handdrawn: ctx.theme.handdrawn,
        seed,
      });

      prevY = targetY;
      bounds = unionBox(bounds, subBox);
      cursorY = subBox.y + subBox.height + gapY;
    }

    return bounds;
  },
};
