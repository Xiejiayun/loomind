import type RBush from "rbush";
import type { MindmapRelationship } from "../model/document.js";
import type { LayoutNode, LayoutRelationship, Point, SpatialItem } from "./types.js";

const r = (n: number) => Math.round(n * 10) / 10;

function centerOf(node: LayoutNode): Point {
  return {
    x: node.contentBox.x + node.contentBox.width / 2,
    y: node.contentBox.y + node.contentBox.height / 2,
  };
}

function evalCubic(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y,
  };
}

export function routeRelationships(
  relationships: MindmapRelationship[],
  nodes: Map<string, LayoutNode>,
  spatialIndex: RBush<SpatialItem>,
  defaultColor: string,
): LayoutRelationship[] {
  const results: LayoutRelationship[] = [];

  for (const rel of relationships) {
    const from = nodes.get(rel.fromId);
    const to = nodes.get(rel.toId);
    if (!from || !to) continue;

    const p0 = centerOf(from);
    const p3 = centerOf(to);
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    let c1: Point;
    let c2: Point;

    if (rel.control1Offset || rel.control2Offset) {
      c1 = {
        x: p0.x + dx * 0.33 + (rel.control1Offset?.dx ?? 0),
        y: p0.y + dy * 0.33 + (rel.control1Offset?.dy ?? 0),
      };
      c2 = {
        x: p0.x + dx * 0.67 + (rel.control2Offset?.dx ?? 0),
        y: p0.y + dy * 0.67 + (rel.control2Offset?.dy ?? 0),
      };
    } else {
      const offsets = [-24, 24, -48, 48, -80, 80];
      let bestOffset = -48;
      let bestHits = Number.POSITIVE_INFINITY;

      for (const off of offsets) {
        const tc1 = { x: p0.x + dx * 0.33 + nx * off, y: p0.y + dy * 0.33 + ny * off };
        const tc2 = { x: p0.x + dx * 0.67 + nx * off, y: p0.y + dy * 0.67 + ny * off };
        let hits = 0;
        for (const t of [0.25, 0.5, 0.75]) {
          const pt = evalCubic(p0, tc1, tc2, p3, t);
          const found = spatialIndex.search({
            minX: pt.x - 4,
            minY: pt.y - 4,
            maxX: pt.x + 4,
            maxY: pt.y + 4,
          });
          hits += found.filter((f) => f.topicId !== rel.fromId && f.topicId !== rel.toId).length;
        }
        if (hits < bestHits) {
          bestHits = hits;
          bestOffset = off;
          if (hits === 0) break;
        }
      }

      c1 = { x: p0.x + dx * 0.33 + nx * bestOffset, y: p0.y + dy * 0.33 + ny * bestOffset };
      c2 = { x: p0.x + dx * 0.67 + nx * bestOffset, y: p0.y + dy * 0.67 + ny * bestOffset };
    }

    const svgPath = `M ${r(p0.x)} ${r(p0.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(p3.x)} ${r(p3.y)}`;
    const mid = evalCubic(p0, c1, c2, p3, 0.5);

    results.push({
      id: rel.id,
      svgPath,
      labelPos: rel.title ? mid : undefined,
      title: rel.title,
      p0,
      c1,
      c2,
      p3,
      color: rel.style?.strokeColor ?? defaultColor,
      strokeWidth: rel.style?.strokeWidth ?? 1.8,
      dash: rel.style?.dash ?? "dashed",
    });
  }

  return results;
}
