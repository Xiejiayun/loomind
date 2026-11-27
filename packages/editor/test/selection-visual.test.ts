import { describe, expect, it } from "vitest";
import { createDocument, createMindmapStore, createSheet, createTopic, LayoutEngine } from "@mindmap/core";
import { computeSelectionOverlay } from "../src/canvas/selection-visual.js";

describe("topic selection visual state", () => {
  it("renders a crisp selection overlay on root, main branch, and underline leaf nodes in light and dark themes", () => {
    const root = createTopic("root", "Root", {
      children: [
        createTopic("b1", "Branch 1", {
          children: [createTopic("l1", "Leaf 1")],
        }),
      ],
    });
    const doc = createDocument([createSheet("s1", "Sheet", root)]);
    const layout = new LayoutEngine().compute(doc, "s1");

    // Depth 0 (root) — previously clobbered by cardStyle.boxShadow
    const rootOverlay = computeSelectionOverlay({
      layoutNode: layout.nodes.get("root")!,
      selected: true,
      editing: false,
      isDarkCanvas: false,
    });
    expect(rootOverlay).not.toBeNull();
    expect(rootOverlay!.kind).toBe("selected");
    expect(rootOverlay!.border).toContain("#2563EB");
    expect(rootOverlay!.boxShadow).toContain("rgba(37, 99, 235");

    // Depth 1 (main branch) in dark mode
    const branchOverlay = computeSelectionOverlay({
      layoutNode: layout.nodes.get("b1")!,
      selected: true,
      editing: false,
      isDarkCanvas: true,
    });
    expect(branchOverlay!.border).toContain("#60A5FA");
    expect(branchOverlay!.boxShadow).toContain("rgba(96, 165, 250");

    // Depth 2 (underline / frameless leaf) gets rounded frame + soft tint background
    const leafNode = layout.nodes.get("l1")!;
    const leafOverlay = computeSelectionOverlay({
      layoutNode: leafNode,
      selected: true,
      editing: false,
      isDarkCanvas: false,
    });
    expect(leafOverlay!.borderRadius).toBe(8);
    expect(leafOverlay!.backgroundColor).toBeDefined();
  });

  it("prioritizes selection over search highlight and remote peer, and renders search/peer overlays when unselected", () => {
    const node = { shape: "rounded" as const, cornerRadius: 8, underlineMode: false, fillColor: "#FFFFFFFF" };

    const activeSearch = computeSelectionOverlay({
      layoutNode: node,
      selected: false,
      editing: false,
      isDarkCanvas: false,
      searchHighlight: "active",
    });
    expect(activeSearch?.kind).toBe("search-active");
    expect(activeSearch?.border).toContain("#F59E0B");

    const peer = computeSelectionOverlay({
      layoutNode: node,
      selected: false,
      editing: false,
      isDarkCanvas: false,
      remotePeer: { color: "#10B981FF" },
    });
    expect(peer?.kind).toBe("remote-peer");

    const unselected = computeSelectionOverlay({
      layoutNode: node,
      selected: false,
      editing: false,
      isDarkCanvas: false,
    });
    expect(unselected).toBeNull();
  });

  it("initializes store with rootTopic selected so keyboard navigation is immediately visible", () => {
    const doc = createDocument();
    const store = createMindmapStore(doc);
    expect(store.getState().selectedTopicIds).toEqual([doc.sheets[0].rootTopic.id]);
  });
});
