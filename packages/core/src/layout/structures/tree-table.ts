import type { MindmapTopic } from "../../model/document.js";
import { fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const treeTableStructurePlugin: StructureLayoutPlugin = {
  structure: "treeTable",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const colGap = 14 * ctx.spacingScale;
    const rowGap = 10 * ctx.spacingScale;
    const pad = 8;

    const measureSubtreeHeight = (t: MindmapTopic): number => {
      const m = ctx.measurements.get(t.id)!;
      if (t.collapsed || t.children.length === 0) return m.height + pad * 2;
      const kidsH =
        t.children.reduce((acc, c) => acc + measureSubtreeHeight(c), 0) +
        (t.children.length - 1) * rowGap;
      return Math.max(m.height + pad * 2, kidsH);
    };

    const placeRow = (
      t: MindmapTopic,
      colX: number,
      rowY: number,
      allocatedH: number,
      pId: string,
    ): LayoutBox => {
      const m = ctx.measurements.get(t.id)!;
      const nodeY = rowY + (allocatedH - m.height) / 2;
      const node = ctx.makeLayoutNode(t, colX + pad, nodeY, "right");
      ctx.nodes.set(t.id, node);

      const cellW = m.width + pad * 2;
      const cellPath = `M ${r(colX)} ${r(rowY)} H ${r(colX + cellW)} V ${r(rowY + allocatedH)} H ${r(colX)} Z`;
      ctx.edges.push({
        id: `cell:${pId}->${t.id}`,
        fromId: pId,
        toId: t.id,
        kind: "table-cell",
        svgPath: cellPath,
        color: node.accentColor,
        strokeWidth: 1,
        handdrawn: false,
        seed: fnv1aSeed(t.id),
      });

      let box: LayoutBox = { x: colX, y: rowY, width: cellW, height: allocatedH };
      if (!t.collapsed && t.children.length > 0) {
        let cy = rowY;
        const nextColX = colX + cellW + colGap;
        for (const c of t.children) {
          const ch = measureSubtreeHeight(c);
          const sub = placeRow(c, nextColX, cy, ch, t.id);
          box = unionBox(box, sub);
          cy += ch + rowGap;
        }
      }
      return box;
    };

    const startX = parentNode.box.x + parentNode.box.width + 24;
    const totalH =
      parent.children.reduce((acc, c) => acc + measureSubtreeHeight(c), 0) +
      (parent.children.length - 1) * rowGap;
    let cursorY = parentNode.box.y + parentNode.box.height / 2 - totalH / 2;
    let bounds = parentNode.box;

    for (const child of parent.children) {
      const ch = measureSubtreeHeight(child);
      const sub = placeRow(child, startX, cursorY, ch, parent.id);
      bounds = unionBox(bounds, sub);
      cursorY += ch + rowGap;
    }

    return bounds;
  },
};
