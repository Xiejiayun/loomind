import type { MindmapTopic } from "../../model/document.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { layoutHorizontalFlextree, unionBox } from "./flextree-util.js";

function estimateSubtreeWeight(t: MindmapTopic): number {
  if (t.collapsed || t.children.length === 0) return 1;
  return 1 + t.children.reduce((acc, c) => acc + estimateSubtreeWeight(c), 0);
}

function clockwiseSides(children: MindmapTopic[], ctx: LayoutBuildContext) {
  const gap = ctx.skeleton.siblingGap * ctx.spacingScale;
  const height = (topic: MindmapTopic): number => {
    const own = ctx.measurements.get(topic.id)!.height;
    if (topic.collapsed || !topic.children.length) return own;
    return Math.max(own, topic.children.reduce((sum, child) => sum + height(child), gap * (topic.children.length - 1)));
  };
  const weights = children.map((child) => height(child) + ctx.measurements.get(child.id)!.height + gap);
  let total = 0, right = 0;
  children.forEach((child, index) => {
    total += weights[index];
    if (child.direction === "right") right += weights[index];
  });
  let bestDifference = Math.abs(total - 2 * right), split = 0;
  children.forEach((child, index) => {
    if (child.direction === "left" || child.direction === "right") return;
    right += weights[index];
    const difference = Math.abs(total - 2 * right);
    if (difference <= bestDifference) { bestDifference = difference; split = index + 1; }
  });
  const rightChildren: MindmapTopic[] = [], leftChildren: MindmapTopic[] = [];
  children.forEach((child, index) => {
    const onRight = child.direction === "right" || (child.direction !== "left" && index < split);
    (onRight ? rightChildren : leftChildren).push(child);
  });
  return { rightChildren, leftChildren: leftChildren.reverse() };
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

    if (ctx.sheet.branchOrder === "clockwise") {
      const { rightChildren, leftChildren } = clockwiseSides(parent.children, ctx);
      return unionBox(layoutHorizontalFlextree(parent, parentNode, rightChildren, 1, ctx),
        layoutHorizontalFlextree(parent, parentNode, leftChildren, -1, ctx));
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
