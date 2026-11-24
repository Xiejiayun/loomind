import type { MindmapTopic } from "../../model/document.js";
import { fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const matrixStructurePlugin: StructureLayoutPlugin = {
  structure: "matrix",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const cellPad = 16;
    const gap = 16 * ctx.spacingScale;
    const cols = parent.children.length <= 2 ? parent.children.length : 2;
    const cardMinW = 240;

    const estimateSubtreeBox = (t: MindmapTopic): { w: number; h: number } => {
      const m = ctx.measurements.get(t.id)!;
      if (t.collapsed || t.children.length === 0) return { w: m.width, h: m.height };
      let maxW = m.width;
      let totalH = m.height + 10;
      for (const c of t.children) {
        const sub = estimateSubtreeBox(c);
        maxW = Math.max(maxW, sub.w + 28);
        totalH += sub.h + 10;
      }
      return { w: maxW, h: totalH };
    };

    const cells = parent.children.map((rowTopic) => {
      const rm = ctx.measurements.get(rowTopic.id)!;
      let w = Math.max(cardMinW, rm.width + cellPad * 2);
      let h = rm.height + cellPad * 2;
      if (!rowTopic.collapsed && rowTopic.children.length > 0) {
        h += 14;
        for (const c of rowTopic.children) {
          const sub = estimateSubtreeBox(c);
          w = Math.max(w, sub.w + cellPad * 2 + 12);
          h += sub.h + 10;
        }
      }
      return { topic: rowTopic, width: w, height: h };
    });

    const colWidths = Array.from({ length: cols }, (_, ci) =>
      Math.max(...cells.filter((_, idx) => idx % cols === ci).map((c) => c.width), cardMinW),
    );
    const totalGridW = colWidths.reduce((a, b) => a + b, 0) + (cols - 1) * gap;
    const rootCenterX = parentNode.box.x + parentNode.box.width / 2;
    const startX = rootCenterX - totalGridW / 2;
    let cursorY = parentNode.box.y + parentNode.box.height + 36;
    let bounds = parentNode.box;

    // Clean vertical connector + top horizontal rail linking root to matrix grid
    const stemTop = parentNode.contentBox.y + parentNode.contentBox.height;
    const railY = cursorY - 16;
    const railLeft = startX + colWidths[0] / 2;
    const railRight = startX + totalGridW - colWidths[cols - 1] / 2;
    const connectorPath =
      `M ${r(rootCenterX)} ${r(stemTop)} V ${r(railY)} ` +
      (cols > 1 ? `M ${r(railLeft)} ${r(railY)} H ${r(railRight)}` : "");
    ctx.edges.push({
      id: `matrix-stem:${parent.id}`,
      fromId: parent.id,
      toId: parent.children[0].id,
      kind: "elbow",
      svgPath: connectorPath,
      color: parentNode.accentColor,
      strokeWidth: 1.6,
      handdrawn: false,
      seed: fnv1aSeed(`matrix-stem:${parent.id}`),
    });

    for (let row = 0; row < Math.ceil(cells.length / cols); row++) {
      const rowCells = cells.slice(row * cols, (row + 1) * cols);
      const rowH = Math.max(...rowCells.map((c) => c.height));
      let cursorX = startX;

      for (let ci = 0; ci < rowCells.length; ci++) {
        const cell = rowCells[ci];
        const cw = colWidths[ci];
        const headerNode = ctx.makeLayoutNode(cell.topic, cursorX + cellPad, cursorY + cellPad, "bottom");
        ctx.nodes.set(cell.topic.id, headerNode);

        // Rounded matrix cell border
        const rad = 10;
        const x = cursorX;
        const y = cursorY;
        const cellPath =
          `M ${r(x + rad)} ${r(y)} H ${r(x + cw - rad)} Q ${r(x + cw)} ${r(y)} ${r(x + cw)} ${r(y + rad)} ` +
          `V ${r(y + rowH - rad)} Q ${r(x + cw)} ${r(y + rowH)} ${r(x + cw - rad)} ${r(y + rowH)} ` +
          `H ${r(x + rad)} Q ${r(x)} ${r(y + rowH)} ${r(x)} ${r(y + rowH - rad)} ` +
          `V ${r(y + rad)} Q ${r(x)} ${r(y)} ${r(x + rad)} ${r(y)} Z`;

        ctx.edges.push({
          id: `matrix:${parent.id}->${cell.topic.id}`,
          fromId: parent.id,
          toId: cell.topic.id,
          kind: "table-cell",
          svgPath: cellPath,
          color: headerNode.accentColor,
          strokeWidth: 1.5,
          handdrawn: false,
          seed: fnv1aSeed(cell.topic.id),
        });

        let itemY = headerNode.box.y + headerNode.box.height + 14;
        if (!cell.topic.collapsed) {
          for (const child of cell.topic.children) {
            const subBox = ctx.placeSubtree(
              child,
              cursorX + cellPad + 6,
              itemY,
              "right",
              child.structure ?? "indented",
            );
            itemY = subBox.y + subBox.height + 10;
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
