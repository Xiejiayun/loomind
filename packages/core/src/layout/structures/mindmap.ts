import type { MindmapTopic } from "../../model/document.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { layoutHorizontalFlextree, unionBox } from "./flextree-util.js";

function estimateSubtreeWeight(t: MindmapTopic): number {
  if (t.collapsed || t.children.length === 0) return 1;
  return 1 + t.children.reduce((acc, c) => acc + estimateSubtreeWeight(c), 0);
}

export const mindmapStructurePlugin: StructureLayoutPlugin = {
  structure: "mindmap",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    // Non-root nodes continue expanding on their current side
    if (parentNode.side === "left" || parentNode.side === "right") {
      return layoutHorizontalFlextree(
        parent,
        parentNode,
        parent.children,
        parentNode.side === "left" ? -1 : 1,
        ctx,
      );
    }

    if (ctx.sheet.direction === "leftRight") {
      return layoutHorizontalFlextree(parent, parentNode, parent.children, 1, ctx);
    }
    if (ctx.sheet.direction === "rightLeft") {
      return layoutHorizontalFlextree(parent, parentNode, parent.children, -1, ctx);
    }

    // Bilateral balanced partition (respect explicit direction first, then greedy weight balance)
    const rightChildren: MindmapTopic[] = [];
    const leftChildren: MindmapTopic[] = [];
    let rightWeight = 0;
    let leftWeight = 0;

    for (const child of parent.children) {
      const w = estimateSubtreeWeight(child);
      if (child.direction === "right") {
        rightChildren.push(child);
        rightWeight += w;
      } else if (child.direction === "left") {
        leftChildren.push(child);
        leftWeight += w;
      } else if (rightWeight <= leftWeight) {
        rightChildren.push(child);
        rightWeight += w;
      } else {
        leftChildren.push(child);
        leftWeight += w;
      }
    }

    let bounds = parentNode.box;
    if (rightChildren.length > 0) {
      bounds = unionBox(bounds, layoutHorizontalFlextree(parent, parentNode, rightChildren, 1, ctx));
    }
    if (leftChildren.length > 0) {
      bounds = unionBox(bounds, layoutHorizontalFlextree(parent, parentNode, leftChildren, -1, ctx));
    }
    return bounds;
  },
};
