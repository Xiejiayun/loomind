import { describe, expect, it } from "vitest";
import { createDocument, createSheet, createTopic, LayoutEngine, type MindmapStructure } from "@mindmap/core";
import { resolveDropTarget } from "../src/canvas/drop-target.js";

function buildLayout(structure: MindmapStructure) {
  const root = createTopic("root", "Root", {
    children: [
      createTopic("b1", "Branch 1", {
        children: [createTopic("b1-1", "Child 1.1")],
      }),
      createTopic("b2", "Branch 2"),
      createTopic("b3", "Branch 3"),
    ],
  });
  const sheet = createSheet("s1", "Sheet", root, { structure });
  const doc = createDocument([sheet]);
  const layout = new LayoutEngine().compute(doc, "s1");
  return { sheet, layout };
}

describe("resolveDropTarget", () => {
  it("uses vertical top/bottom before/after in logic chart", () => {
    const { sheet, layout } = buildLayout("logic");
    const box = layout.nodes.get("b2")!.contentBox;

    expect(resolveDropTarget(sheet, layout, "b3", { x: box.x + box.width / 2, y: box.y + 2 })).toEqual({
      dropTargetId: "b2",
      dropMode: "before",
      indicatorSide: "top",
    });

    expect(resolveDropTarget(sheet, layout, "b3", { x: box.x + box.width / 2, y: box.y + box.height - 2 })).toEqual({
      dropTargetId: "b2",
      dropMode: "after",
      indicatorSide: "bottom",
    });

    expect(resolveDropTarget(sheet, layout, "b3", { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toEqual({
      dropTargetId: "b2",
      dropMode: "child",
      indicatorSide: "around",
    });
  });

  it("uses horizontal left/right before/after in org chart and timeline", () => {
    for (const structure of ["org", "timeline"] as const) {
      const { sheet, layout } = buildLayout(structure);
      const box = layout.nodes.get("b2")!.contentBox;

      expect(resolveDropTarget(sheet, layout, "b3", { x: box.x + 2, y: box.y + box.height / 2 })).toEqual({
        dropTargetId: "b2",
        dropMode: "before",
        indicatorSide: "left",
      });

      expect(resolveDropTarget(sheet, layout, "b3", { x: box.x + box.width - 2, y: box.y + box.height / 2 })).toEqual({
        dropTargetId: "b2",
        dropMode: "after",
        indicatorSide: "right",
      });

      expect(resolveDropTarget(sheet, layout, "b3", { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toEqual({
        dropTargetId: "b2",
        dropMode: "child",
        indicatorSide: "around",
      });
    }
  });

  it("reverses horizontal before/after for right-to-left fishbone ribs", () => {
    const { sheet, layout } = buildLayout("fishbone");
    const box = layout.nodes.get("b2")!.contentBox;
    const resLeft = resolveDropTarget(sheet, layout, "b3", { x: box.x + 2, y: box.y + box.height / 2 });
    const resRight = resolveDropTarget(sheet, layout, "b3", { x: box.x + box.width - 2, y: box.y + box.height / 2 });
    expect(resLeft.indicatorSide).toBe("left");
    expect(resRight.indicatorSide).toBe("right");
    expect(resLeft.dropMode).toBe("after");
    expect(resRight.dropMode).toBe("before");
  });

  it("never targets the dragged topic itself or its own descendants", () => {
    const { sheet, layout } = buildLayout("logic");
    const childBox = layout.nodes.get("b1-1")!.contentBox;
    const res = resolveDropTarget(sheet, layout, "b1", {
      x: childBox.x + childBox.width / 2,
      y: childBox.y + childBox.height / 2,
    });
    expect(res.dropTargetId).toBeNull();
    expect(res.dropMode).toBe("floating");
  });

  it("always resolves root topic drop as child", () => {
    const { sheet, layout } = buildLayout("org");
    const rootBox = layout.nodes.get("root")!.contentBox;
    expect(resolveDropTarget(sheet, layout, "b2", { x: rootBox.x + 1, y: rootBox.y + 1 })).toEqual({
      dropTargetId: "root",
      dropMode: "child",
      indicatorSide: "around",
    });
  });
});
