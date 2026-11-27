import { describe, expect, it } from "vitest";
import { createDocument, createSheet, createTopic, LayoutEngine, type MindmapStructure } from "@mindmap/core";
import { computePanToRevealNode, findNextTopicByArrow } from "../src/canvas/navigation.js";

function buildTestSheet(structure: MindmapStructure) {
  const root = createTopic("root", "Root", {
    children: [
      createTopic("b1", "Branch 1", {
        children: [createTopic("b1-1", "Child 1.1"), createTopic("b1-2", "Child 1.2")],
      }),
      createTopic("b2", "Branch 2", {
        children: [createTopic("b2-1", "Child 2.1")],
      }),
      createTopic("b3", "Branch 3"),
      createTopic("b4", "Branch 4"),
    ],
  });
  const sheet = createSheet("s1", "Sheet", root, { structure });
  const doc = createDocument([sheet]);
  const layout = new LayoutEngine().compute(doc, "s1");
  return { sheet, layout };
}

describe("findNextTopicByArrow", () => {
  it("selects root when nothing is selected", () => {
    const { sheet, layout } = buildTestSheet("mindmap");
    expect(findNextTopicByArrow(sheet, layout, undefined, "ArrowRight")).toBe("root");
  });

  it("navigates left/right branches and returns to root in bilateral mindmap", () => {
    const { sheet, layout } = buildTestSheet("mindmap");

    const rightTarget = findNextTopicByArrow(sheet, layout, "root", "ArrowRight");
    expect(rightTarget).not.toBeNull();
    expect(layout.nodes.get(rightTarget!)?.side).toBe("right");
    expect(findNextTopicByArrow(sheet, layout, rightTarget!, "ArrowLeft")).toBe("root");

    const leftTarget = findNextTopicByArrow(sheet, layout, "root", "ArrowLeft");
    expect(leftTarget).not.toBeNull();
    expect(layout.nodes.get(leftTarget!)?.side).toBe("left");
    expect(findNextTopicByArrow(sheet, layout, leftTarget!, "ArrowRight")).toBe("root");
  });

  it("moves into children and between vertical siblings in logic chart", () => {
    const { sheet, layout } = buildTestSheet("logic");
    // Root -> child on right
    const first = findNextTopicByArrow(sheet, layout, "root", "ArrowRight");
    expect(first).not.toBeNull();

    // From b1 -> ArrowDown goes to b2 -> ArrowUp returns to b1
    expect(findNextTopicByArrow(sheet, layout, "b1", "ArrowDown")).toBe("b2");
    expect(findNextTopicByArrow(sheet, layout, "b2", "ArrowUp")).toBe("b1");

    // From b1 -> ArrowRight enters child b1-1 or b1-2, ArrowLeft returns to b1
    const child = findNextTopicByArrow(sheet, layout, "b1", "ArrowRight");
    expect(["b1-1", "b1-2"]).toContain(child);
    expect(findNextTopicByArrow(sheet, layout, child!, "ArrowLeft")).toBe("b1");

    // Sibling navigation among b1's children
    expect(findNextTopicByArrow(sheet, layout, "b1-1", "ArrowDown")).toBe("b1-2");
    expect(findNextTopicByArrow(sheet, layout, "b1-2", "ArrowUp")).toBe("b1-1");
  });

  it("navigates top-down parent/child and horizontal siblings in org chart", () => {
    const { sheet, layout } = buildTestSheet("org");
    // From root -> ArrowDown enters a depth-1 branch
    const down = findNextTopicByArrow(sheet, layout, "root", "ArrowDown");
    expect(["b1", "b2", "b3", "b4"]).toContain(down);
    // ArrowUp returns to root
    expect(findNextTopicByArrow(sheet, layout, down!, "ArrowUp")).toBe("root");
    // Horizontal sibling navigation
    expect(findNextTopicByArrow(sheet, layout, "b1", "ArrowRight")).toBe("b2");
    expect(findNextTopicByArrow(sheet, layout, "b2", "ArrowLeft")).toBe("b1");
    // Enter child of b1 with ArrowDown
    const child = findNextTopicByArrow(sheet, layout, "b1", "ArrowDown");
    expect(["b1-1", "b1-2"]).toContain(child);
    expect(findNextTopicByArrow(sheet, layout, child!, "ArrowUp")).toBe("b1");
  });

  it("does not enter collapsed children", () => {
    const root = createTopic("root", "Root", {
      children: [
        createTopic("b1", "Branch 1", {
          collapsed: true,
          children: [createTopic("hidden-1", "Hidden")],
        }),
      ],
    });
    const sheet = createSheet("s1", "Sheet", root, { structure: "logic" });
    const doc = createDocument([sheet]);
    const layout = new LayoutEngine().compute(doc, "s1");
    expect(findNextTopicByArrow(sheet, layout, "b1", "ArrowRight")).toBeNull();
  });

  it("falls back spatially across branches when at sibling boundary", () => {
    const { sheet, layout } = buildTestSheet("logic");
    // b1-2 is the bottom-most child of b1; ArrowDown should cross over to b2-1 or b2
    const next = findNextTopicByArrow(sheet, layout, "b1-2", "ArrowDown");
    expect(next).not.toBeNull();
    expect(next).not.toBe("b1-2");
    expect(next).not.toBe("b1-1");
  });
});

describe("computePanToRevealNode", () => {
  it("returns null when node is already inside viewport", () => {
    const { layout } = buildTestSheet("logic");
    const rootNode = layout.nodes.get("root")!;
    const cam = {
      x: 400 - rootNode.contentBox.x,
      y: 300 - rootNode.contentBox.y,
      scale: 1,
    };
    expect(computePanToRevealNode(rootNode, cam, { width: 800, height: 600 })).toBeNull();
  });

  it("computes minimal pan when node is offscreen to the right", () => {
    const { layout } = buildTestSheet("logic");
    const node = layout.nodes.get("b1-1")!;
    const cam = { x: 1000, y: 300 - node.contentBox.y, scale: 1 };
    const pan = computePanToRevealNode(node, cam, { width: 800, height: 600 }, 50);
    expect(pan).not.toBeNull();
    const rightAfter = (node.contentBox.x + node.contentBox.width) * cam.scale + pan!.x;
    expect(rightAfter).toBeLessThanOrEqual(800 - 50 + 0.01);
  });
});
