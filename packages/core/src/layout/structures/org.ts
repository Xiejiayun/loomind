import { flextree } from "d3-flextree";
import type { MindmapTopic } from "../../model/document.js";
import type { LayoutBox, LayoutBuildContext, LayoutNode, StructureLayoutPlugin } from "../types.js";
import { anchorForSide, createStandardEdge, unionBox } from "./flextree-util.js";

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
        const p0 = anchorForSide(pNode, dir === 1 ? "bottom" : "top");
        const p3 = anchorForSide(cNode, dir === 1 ? "top" : "bottom");
        ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx, { forceKind: "elbow", verticalFirst: true }));
        return;
      }

      const cNode = ctx.makeLayoutNode(t, x, y, side);
      ctx.nodes.set(t.id, cNode);
      placed.set(t.id, cNode);
      bounds = unionBox(bounds, cNode.box);

      const p0 = anchorForSide(pNode, dir === 1 ? "bottom" : "top");
      const p3 = anchorForSide(cNode, dir === 1 ? "top" : "bottom");
      ctx.edges.push(createStandardEdge(pNode, cNode, p0, p3, ctx, { forceKind: "elbow", verticalFirst: true }));
    });

    return bounds;
  },
};
