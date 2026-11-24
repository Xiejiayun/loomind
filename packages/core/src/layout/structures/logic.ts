import type { MindmapTopic } from "../../model/document.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { layoutHorizontalFlextree } from "./flextree-util.js";

export const logicStructurePlugin: StructureLayoutPlugin = {
  structure: "logic",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;
    const dir: 1 | -1 =
      parentNode.side === "left" || ctx.sheet.direction === "rightLeft" ? -1 : 1;
    return layoutHorizontalFlextree(parent, parentNode, parent.children, dir, ctx);
  },
};
