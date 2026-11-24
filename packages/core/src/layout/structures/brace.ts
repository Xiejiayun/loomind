import type { MindmapTopic } from "../../model/document.js";
import { buildCurlyBracePath, buildRoughSvgPath, fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { layoutHorizontalFlextree } from "./flextree-util.js";

export const braceStructurePlugin: StructureLayoutPlugin = {
  structure: "brace",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;
    const dir: 1 | -1 =
      parentNode.side === "left" || ctx.sheet.direction === "rightLeft" ? -1 : 1;

    // Reserve 36px corridor for curly brace, skip standard tree edges
    const bounds = layoutHorizontalFlextree(parent, parentNode, parent.children, dir, ctx, {
      levelGap: 40,
      siblingGap: 12,
      skipEdges: true,
    });

    // Emit calligraphic curly brace for every non-leaf node in this brace subtree
    const emitBraces = (t: MindmapTopic) => {
      if (t.collapsed || t.children.length === 0) return;
      const pNode = ctx.nodes.get(t.id);
      if (!pNode) return;

      const childNodes = t.children
        .map((c) => ctx.nodes.get(c.id))
        .filter((n): n is LayoutNode => Boolean(n));
      if (childNodes.length === 0) return;

      const y0 = Math.min(...childNodes.map((n) => n.contentBox.y));
      const y1 = Math.max(...childNodes.map((n) => n.contentBox.y + n.contentBox.height));
      const cx =
        dir === 1
          ? pNode.contentBox.x + pNode.contentBox.width + 18
          : pNode.contentBox.x - 18;

      const rawPath = buildCurlyBracePath(cx, y0, y1, dir === 1 ? -1 : 1, 14);
      const seed = fnv1aSeed(`brace:${t.id}`);
      const svgPath = ctx.theme.handdrawn ? buildRoughSvgPath(rawPath, seed) : rawPath;

      ctx.edges.push({
        id: `brace:${t.id}`,
        fromId: t.id,
        toId: childNodes[0].id,
        kind: "brace",
        svgPath,
        color: childNodes[0].accentColor,
        strokeWidth: 2,
        handdrawn: ctx.theme.handdrawn,
        seed,
      });

      for (const c of t.children) {
        if (!c.structure || c.structure === "brace") emitBraces(c);
      }
    };

    emitBraces(parent);
    return bounds;
  },
};
