import { flextree } from "d3-flextree";
import type { MindmapTopic } from "../../model/document.js";
import { buildRoughSvgPath, fnv1aSeed } from "../svg-paths.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { anchorForSide, createStandardEdge, unionBox } from "./flextree-util.js";

const r = (n: number) => Math.round(n * 10) / 10;

interface OrgDatum {
  topic: MindmapTopic;
  size: [number, number];
  children?: OrgDatum[];
}

export const orgStructurePlugin: StructureLayoutPlugin = {
  structure: "org",
  layoutChildren(parent: MindmapTopic, parentNode: LayoutNode, ctx: LayoutBuildContext): LayoutBox {
    if (parent.children.length === 0) return parentNode.box;

    const dir: 1 | -1 = ctx.sheet.direction === "bottomUp" ? -1 : 1;
    const siblingGap = 18 * ctx.spacingScale;
    const levelGap = 44 * ctx.spacingScale;
    const side: LayoutNode["side"] = dir === 1 ? "bottom" : "top";

    const buildDatum = (t: MindmapTopic, isRoot: boolean): OrgDatum => {
      const m = ctx.measurements.get(t.id)!;
      const keepOrg = isRoot || (!t.collapsed && (!t.structure || t.structure === "org"));
      const kids =
        keepOrg && !t.collapsed && t.children.length > 0
          ? t.children.map((c) => buildDatum(c, false))
          : undefined;
      return {
        topic: t,
        size: [m.width + siblingGap, m.height + levelGap],
        children: kids,
      };
    };

    const layout = flextree<OrgDatum>({
      nodeSize: (n) => n.data.size,
      spacing: () => 0,
    });
    const treeRoot = layout.hierarchy(buildDatum(parent, true));
    layout(treeRoot);

    const rootCenterX = parentNode.box.x + parentNode.box.width / 2;
    const offsetX = rootCenterX - treeRoot.x;

    let bounds = parentNode.box;
    const placed = new Map<string, LayoutNode>();
    placed.set(parent.id, parentNode);
    const parentGroups = new Map<string, { pNode: LayoutNode; children: LayoutNode[] }>();

    const recordChild = (pNode: LayoutNode, cNode: LayoutNode) => {
      let group = parentGroups.get(pNode.id);
      if (!group) {
        group = { pNode, children: [] };
        parentGroups.set(pNode.id, group);
      }
      group.children.push(cNode);
    };

    treeRoot.each((node) => {
      if (node === treeRoot) return;
      const t = node.data.topic;
      const m = ctx.measurements.get(t.id)!;
      const pNode = placed.get(node.parent!.data.topic.id)!;

      const x = node.x + offsetX - m.width / 2;
      const y =
        dir === 1
          ? parentNode.box.y + node.y
          : parentNode.box.y + parentNode.box.height - node.y - m.height;

      const hasOverride = Boolean(t.structure && t.structure !== "org");
      if (hasOverride && !t.collapsed && t.children.length > 0) {
        const subBox = ctx.placeSubtree(t, x, y, side, t.structure!);
        const cNode = ctx.nodes.get(t.id)!;
        placed.set(t.id, cNode);
        bounds = unionBox(bounds, subBox);
        recordChild(pNode, cNode);
        return;
      }

      const cNode = ctx.makeLayoutNode(t, x, y, side);
      ctx.nodes.set(t.id, cNode);
      placed.set(t.id, cNode);
      bounds = unionBox(bounds, cNode.box);
      recordChild(pNode, cNode);
    });

    // Emit non-overlapping bus-style elbow edges per parent (shared stem drawn once, rails chained outward)
    const handdrawn = ctx.theme.handdrawn;
    for (const { pNode, children } of parentGroups.values()) {
      const p0 = anchorForSide(pNode, dir === 1 ? "bottom" : "top");
      if (children.length === 1) {
        const cNode = children[0];
        const p3 = anchorForSide(cNode, dir === 1 ? "top" : "bottom");
        ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx, { forceKind: "elbow", verticalFirst: true }));
        continue;
      }

      const items = children.map((cNode) => ({
        cNode,
        p3: anchorForSide(cNode, dir === 1 ? "top" : "bottom"),
      }));
      const targetRailY =
        dir === 1
          ? Math.min(...items.map((it) => it.p3.y))
          : Math.max(...items.map((it) => it.p3.y));
      const ym = (p0.y + targetRailY) / 2;
      const strokeWidth = pNode.depth === 0 ? 2.4 : 1.6;

      // Single vertical stem from parent to horizontal rail
      const stemRaw = `M ${r(p0.x)} ${r(p0.y)} V ${r(ym)}`;
      const stemSeed = fnv1aSeed(`org-stem:${pNode.id}`);
      ctx.edges.push({
        id: `org-stem:${pNode.id}`,
        fromId: pNode.id,
        toId: children[0].id,
        kind: "elbow",
        svgPath: handdrawn ? buildRoughSvgPath(stemRaw, stemSeed) : stemRaw,
        color: pNode.depth === 0 && ctx.theme.rainbowBranches ? pNode.accentColor : children[0].accentColor,
        strokeWidth,
        handdrawn,
        seed: stemSeed,
      });

      const leftSide = items
        .filter((it) => it.p3.x <= p0.x)
        .sort((a, b) => b.p3.x - a.p3.x);
      const rightSide = items
        .filter((it) => it.p3.x > p0.x)
        .sort((a, b) => a.p3.x - b.p3.x);

      const emitSide = (list: typeof items) => {
        let prevX = p0.x;
        for (const { cNode, p3 } of list) {
          const raw =
            Math.abs(p3.x - prevX) < 0.2
              ? `M ${r(prevX)} ${r(ym)} V ${r(p3.y)}`
              : `M ${r(prevX)} ${r(ym)} H ${r(p3.x)} V ${r(p3.y)}`;
          const seed = fnv1aSeed(`${pNode.id}->${cNode.id}`);
          ctx.edges.push({
            id: `e:${pNode.id}->${cNode.id}`,
            fromId: pNode.id,
            toId: cNode.id,
            kind: "elbow",
            svgPath: handdrawn ? buildRoughSvgPath(raw, seed) : raw,
            color: cNode.accentColor,
            strokeWidth,
            handdrawn,
            seed,
          });
          prevX = p3.x;
        }
      };

      emitSide(leftSide);
      emitSide(rightSide);
    }

    return bounds;
  },
};
