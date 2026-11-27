import { describe, expect, it } from "vitest";
import { createDocument, createRichText, createSheet, createTopic, LayoutEngine } from "../src/index.js";

function createLargeDocument(branchCount: number, childrenPerBranch: number, leavesPerChild: number) {
  let counter = 0;
  const branches = Array.from({ length: branchCount }, (_, bi) =>
    createTopic(`b-${bi}`, `Branch ${bi + 1}`, {
      children: Array.from({ length: childrenPerBranch }, (_, ci) =>
        createTopic(`c-${bi}-${ci}`, `Subtopic ${bi + 1}.${ci + 1}`, {
          children: Array.from({ length: leavesPerChild }, (_, li) => {
            counter += 1;
            return createTopic(`l-${bi}-${ci}-${li}`, `Leaf item #${counter}`);
          }),
        }),
      ),
    }),
  );
  const root = createTopic("root", "Large Map Root", { children: branches });
  return createDocument([createSheet("s1", "Large Sheet", root)]);
}

describe("LayoutEngine large-map performance & cache hygiene", () => {
  it("computes a 1,000+ node mindmap cleanly and benefits from incremental measure cache", () => {
    // 1 + 10 + 100 + 900 = 1011 topics
    const doc = createLargeDocument(10, 10, 9);
    const engine = new LayoutEngine();

    const first = engine.compute(doc, "s1");
    expect(first.nodes.size).toBe(1011);
    expect(first.edges.length).toBe(1010);

    // Mutate a single leaf title and verify incremental recompute stays fast and accurate
    const updated = structuredClone(doc);
    updated.sheets[0].rootTopic.children[0].children[0].children[0].title = createRichText("Updated Leaf Node Title");
    const t0 = performance.now();
    const second = engine.compute(updated, "s1");
    const elapsedMs = performance.now() - t0;

    expect(second.nodes.size).toBe(1011);
    expect(elapsedMs).toBeLessThan(2000);
    // Spatial index returns localized viewport hits accurately
    const rootBox = second.nodes.get("root")!.contentBox;
    const viewportHits = second.spatialIndex.search({
      minX: rootBox.x - 10,
      minY: rootBox.y - 10,
      maxX: rootBox.x + rootBox.width + 10,
      maxY: rootBox.y + rootBox.height + 10,
    });
    expect(viewportHits.some((h) => h.topicId === "root")).toBe(true);
  });

  it("evicts stale measurement cache entries after shrinking a large map", () => {
    const bigDoc = createLargeDocument(8, 10, 8); // 729 nodes
    const engine = new LayoutEngine();
    engine.compute(bigDoc, "s1");

    const smallDoc = createDocument([createSheet("s2", "Small", createTopic("s-root", "Small"))]);
    const res = engine.compute(smallDoc, "s2");
    expect(res.nodes.size).toBe(1);
    // Internal cache should have been pruned down to just the active sheet's measured node
    const cacheSize = (engine as unknown as { measureCache: Map<string, unknown> }).measureCache.size;
    expect(cacheSize).toBe(1);
  });
});
