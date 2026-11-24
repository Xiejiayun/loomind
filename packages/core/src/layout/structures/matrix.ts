import type { MindmapTopic } from "../../model/document.js";
import { fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const matrixStructurePlugin: StructureLayoutPlugin = {
  structure: "matrix",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const cellPad = 14;
    const gap = 14 * ctx.spacingScale;
    const cols = parent.children.length <= 2 ? parent.children.length : 2;
    const cardMinW = 220;

    // Pre-calculate each quadrant/cell size
    const cells = parent.children.map((rowTopic) => {
      const rm = ctx.measurements.get(rowTopic.id)!;
      let w = Math.max(cardMinW, rm.width + cellPad * 2);
      let h = rm.height + cellPad * 2;
      if (!rowTopic.collapsed && rowTopic.children.length > 0) {
        h += 10;
        for (const c of rowTopic.children) {
          const cm = ctx.measurements.get(c.id)!;
          w = Math.max(w, cm.width + cellPad * 2 + 8);
          h += cm.height + 8;
        }
      }
      return { topic: rowTopic, width: w, height: h };
    });

    const colWidths = Array.from({ length: cols }, (_, ci) =>
      Math.max(...cells.filter((_, idx) => idx % cols === ci).map((c) => c.width), cardMinW),
    );
    const totalGridW = colWidths.reduce((a, b) => a + b, 0) + (cols - 1) * gap;
    const startX = parentNode.box.x + parentNode.box.width / 2 - totalGridW / 2;
    let cursorY = parentNode.box.y + parentNode.box.height + 28;
    let bounds = parentNode.box;

    for (let row = 0; row < Math.ceil(cells.length / cols); row++) {
      const rowCells = cells.slice(row * cols, (row + 1) * cols);
      const rowH = Math.max(...rowCells.map((c) => c.height));
      let cursorX = startX;

      for (let ci = 0; ci < rowCells.length; ci++) {
        const cell = rowCells[ci];
        const cw = colWidths[ci];
        const headerNode = ctx.makeLayoutNode(cell.topic, cursorX + cellPad, cursorY + cellPad, "bottom");
        ctx.nodes.set(cell.topic.id, headerNode);

        // Matrix cell border
        const cellPath = `M ${r(cursorX)} ${r(cursorY)} H ${r(cursorX + cw)} V ${r(cursorY + rowH)} H ${r(cursorX)} Z`;
        ctx.edges.push({
          id: `matrix:${parent.id}->${cell.topic.id}`,
          fromId: parent.id,
          toId: cell.topic.id,
          kind: "table-cell",
          svgPath: cellPath,
          color: headerNode.accentColor,
          strokeWidth: 1.4,
          handdrawn: false,
          seed: fnv1aSeed(cell.topic.id),
        });

        let itemY = headerNode.box.y + headerNode.box.height + 10;
        if (!cell.topic.collapsed) {
          for (const child of cell.topic.children) {
            const subBox = ctx.placeSubtree(
              child,
              cursorX + cellPad + 6,
              itemY,
              "right",
              child.structure ?? "indented",
            );
            itemY = subBox.y + subBox.height + 8;
            bounds = unionBox(bounds, subBox);
          }
        }

        bounds = unionBox(bounds, { x: cursorX, y: cursorY, width: cw, height: rowH });
        cursorX += cw + gap;
      }

      cursorY += rowH + gap;
    }

    return bounds;
  },
};
