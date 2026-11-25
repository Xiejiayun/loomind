import type { MindmapTopic } from "../../model/document.js";
import { mixHexWithAlpha } from "../../theme/tokens.js";
import { fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

export const treeTableStructurePlugin: StructureLayoutPlugin = {
  structure: "treeTable",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const cellPadX = 16;
    const cellPadY = 10;
    const minRowH = Math.round(40 * ctx.spacingScale);
    const minColW = Math.round(128 * ctx.spacingScale);

    // 1. Measure max depth & uniform column width per depth (1..maxDepth)
    let maxDepth = 1;
    const colWidths = new Map<number, number>();

    const scanCols = (t: MindmapTopic, depth: number) => {
      maxDepth = Math.max(maxDepth, depth);
      const m = ctx.measurements.get(t.id)!;
      const neededW = Math.max(minColW, m.width + cellPadX * 2 + (depth === 1 ? 10 : 4));
      colWidths.set(depth, Math.max(colWidths.get(depth) ?? 0, neededW));
      if (!t.collapsed) {
        for (const c of t.children) scanCols(c, depth + 1);
      }
    };
    for (const child of parent.children) scanCols(child, 1);

    // Pre-compute column X offsets (relative to tableLeft)
    const colOffsets = new Map<number, number>();
    let totalTableW = 0;
    for (let d = 1; d <= maxDepth; d++) {
      colOffsets.set(d, totalTableW);
      totalTableW += colWidths.get(d) ?? minColW;
    }
    totalTableW = Math.max(totalTableW, parentNode.box.width + cellPadX * 2);

    // 2. Measure exact merged row heights (zero gap -> crisp shared gridlines)
    const rowHeights = new Map<string, number>();
    const measureRowH = (t: MindmapTopic): number => {
      const m = ctx.measurements.get(t.id)!;
      const selfH = Math.max(minRowH, m.height + cellPadY * 2);
      if (t.collapsed || t.children.length === 0) {
        rowHeights.set(t.id, selfH);
        return selfH;
      }
      const kidsH = t.children.reduce((acc, c) => acc + measureRowH(c), 0);
      const h = Math.max(selfH, kidsH);
      rowHeights.set(t.id, h);
      return h;
    };
    const bodyH = parent.children.reduce((acc, c) => acc + measureRowH(c), 0);

    // 3. Position table centered under a flush top header band containing parentNode
    const headerPadY = 14;
    const headerH = parentNode.box.height + headerPadY * 2;
    const tableLeft = parentNode.box.x + parentNode.box.width / 2 - totalTableW / 2;
    const tableTop = parentNode.box.y - headerPadY;
    const bodyTop = tableTop + headerH;
    const tableRight = tableLeft + totalTableW;
    const tableBottom = bodyTop + bodyH;
    const gridColor = ctx.palette.cardBorder;

    // Subtle header background fill
    const rad = 12;
    const headerBgPath =
      `M ${r(tableLeft + rad)} ${r(tableTop)} H ${r(tableRight - rad)} ` +
      `Q ${r(tableRight)} ${r(tableTop)} ${r(tableRight)} ${r(tableTop + rad)} ` +
      `V ${r(bodyTop)} H ${r(tableLeft)} V ${r(tableTop + rad)} ` +
      `Q ${r(tableLeft)} ${r(tableTop)} ${r(tableLeft + rad)} ${r(tableTop)} Z`;
    ctx.edges.push({
      id: `tt-hdrbg:${parent.id}`,
      fromId: parent.id,
      toId: parent.id,
      kind: "tapered",
      svgPath: headerBgPath,
      fillPath: headerBgPath,
      color: mixHexWithAlpha(parentNode.accentColor, ctx.palette.isDark ? 0.16 : 0.06),
      strokeWidth: 0,
      handdrawn: false,
      seed: fnv1aSeed(`tt-hdr:${parent.id}`),
    });

    // Place cells recursively with flush right-edge spanning for shallow leaves
    const gridLines: string[] = [`M ${r(tableLeft)} ${r(bodyTop)} H ${r(tableRight)}`];

    const placeCell = (t: MindmapTopic, depth: number, rowY: number, allocatedH: number) => {
      const colX = tableLeft + (colOffsets.get(depth) ?? 0);
      const isLeaf = t.collapsed || t.children.length === 0;
      const cellW = isLeaf ? tableRight - colX : (colWidths.get(depth) ?? minColW);
      const m = ctx.measurements.get(t.id)!;

      const nodeX = colX + (depth === 1 ? cellPadX + 4 : cellPadX);
      const nodeY = rowY + (allocatedH - m.height) / 2;
      const node = ctx.makeLayoutNode(t, nodeX, nodeY, "right");

      // Clean flat cell typography inside the table (no ugly double-border box inside box)
      if (!t.style?.fillColor) node.fillColor = "#00000000";
      if (!t.style?.strokeColor) node.strokeWidth = 0;
      node.underlineMode = false;
      ctx.nodes.set(t.id, node);

      // Subtle Level-1 rainbow left accent bar + faint tint
      if (depth === 1) {
        const tintPath = `M ${r(colX)} ${r(rowY)} H ${r(colX + cellW)} V ${r(rowY + allocatedH)} H ${r(colX)} Z`;
        ctx.edges.push({
          id: `tt-tint:${t.id}`,
          fromId: parent.id,
          toId: t.id,
          kind: "tapered",
          svgPath: tintPath,
          fillPath: tintPath,
          color: mixHexWithAlpha(node.accentColor, ctx.palette.isDark ? 0.14 : 0.06),
          strokeWidth: 0,
          handdrawn: false,
          seed: fnv1aSeed(`tt-tint:${t.id}`),
        });

        const barPath = `M ${r(colX + 2)} ${r(rowY + 6)} V ${r(rowY + allocatedH - 6)}`;
        ctx.edges.push({
          id: `tt-bar:${t.id}`,
          fromId: parent.id,
          toId: t.id,
          kind: "table-cell",
          svgPath: barPath,
          color: node.accentColor,
          strokeWidth: 3.5,
          handdrawn: false,
          seed: fnv1aSeed(`tt-bar:${t.id}`),
        });
      }

      // Horizontal divider at bottom of this cell (skip outermost bottom border)
      if (rowY + allocatedH < tableBottom - 0.5) {
        gridLines.push(`M ${r(colX)} ${r(rowY + allocatedH)} H ${r(colX + cellW)}`);
      }

      if (!isLeaf) {
        // Vertical divider separating this cell from its children column
        const divX = colX + cellW;
        gridLines.push(`M ${r(divX)} ${r(rowY)} V ${r(rowY + allocatedH)}`);

        const kidsSum = t.children.reduce((acc, c) => acc + (rowHeights.get(c.id) ?? minRowH), 0);
        const scale = kidsSum > 0 ? allocatedH / kidsSum : 1;
        let cy = rowY;
        for (let i = 0; i < t.children.length; i++) {
          const c = t.children[i];
          const ch =
            i === t.children.length - 1
              ? rowY + allocatedH - cy
              : (rowHeights.get(c.id) ?? minRowH) * scale;
          placeCell(c, depth + 1, cy, ch);
          cy += ch;
        }
      }
    };

    let cursorY = bodyTop;
    for (const child of parent.children) {
      const ch = rowHeights.get(child.id) ?? minRowH;
      placeCell(child, 1, cursorY, ch);
      cursorY += ch;
    }

    // Emit shared inner hairline gridlines
    ctx.edges.push({
      id: `tt-grid:${parent.id}`,
      fromId: parent.id,
      toId: parent.children[0].id,
      kind: "table-cell",
      svgPath: gridLines.join(" "),
      color: gridColor,
      strokeWidth: 1,
      handdrawn: false,
      seed: fnv1aSeed(`tt-grid:${parent.id}`),
    });

    // Emit crisp unified outer rounded border
    const outerPath =
      `M ${r(tableLeft + rad)} ${r(tableTop)} H ${r(tableRight - rad)} ` +
      `Q ${r(tableRight)} ${r(tableTop)} ${r(tableRight)} ${r(tableTop + rad)} ` +
      `V ${r(tableBottom - rad)} Q ${r(tableRight)} ${r(tableBottom)} ${r(tableRight - rad)} ${r(tableBottom)} ` +
      `H ${r(tableLeft + rad)} Q ${r(tableLeft)} ${r(tableBottom)} ${r(tableLeft)} ${r(tableBottom - rad)} ` +
      `V ${r(tableTop + rad)} Q ${r(tableLeft)} ${r(tableTop)} ${r(tableLeft + rad)} ${r(tableTop)} Z`;
    ctx.edges.push({
      id: `tt-outer:${parent.id}`,
      fromId: parent.id,
      toId: parent.children[0].id,
      kind: "table-cell",
      svgPath: outerPath,
      color: gridColor,
      strokeWidth: 1.5,
      handdrawn: false,
      seed: fnv1aSeed(`tt-outer:${parent.id}`),
    });

    return unionBox(parentNode.box, {
      x: tableLeft,
      y: tableTop,
      width: totalTableW,
      height: headerH + bodyH,
    });
  },
};
