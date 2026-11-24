import { describe, expect, it } from "vitest";
import {
  computeSheetLayout,
  createDocument,
  createRichText,
  createTopic,
  fnv1aSeed,
  getTemplate,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  TEMPLATES,
  validateDocumentInvariants,
  type MindmapStructure,
} from "../src/index.js";

describe("@mindmap/core model & store", () => {
  it("validates templates against Zod schema and invariants", () => {
    for (const tpl of TEMPLATES) {
      const doc = tpl.create();
      expect(MindmapDocumentSchema.safeParse(doc).success).toBe(true);
      expect(validateDocumentInvariants(doc)).toEqual([]);
    }
  });

  it("handles CRUD, cascade cleanup, and monotonic deletedIds", () => {
    const doc = getTemplate("blank-organic").create();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;

    adapter.applyCommand({
      type: "topic/addChild",
      sheetId,
      parentId: "b1",
      newId: "b1-3",
      title: createRichText("新增子节点"),
    });
    adapter.applyCommand({
      type: "relationship/upsert",
      sheetId,
      relationship: { id: "rel-1", fromId: "b1-3", toId: "b2" },
    });
    adapter.applyCommand({
      type: "boundary/upsert",
      sheetId,
      boundary: { id: "bnd-1", target: { kind: "subtree", topicId: "b1-3" }, shape: "cloud" },
    });

    expect(adapter.getDocument().sheets[0].relationships).toHaveLength(1);
    expect(adapter.getDocument().sheets[0].boundaries).toHaveLength(1);

    // Delete b1-3 -> should cascade remove rel-1 and bnd-1 and record deletedIds
    adapter.applyCommand({ type: "topic/delete", sheetId, topicIds: ["b1-3"] });
    const after = adapter.getDocument();
    expect(after.sheets[0].relationships).toHaveLength(0);
    expect(after.sheets[0].boundaries).toHaveLength(0);
    expect(after.deletedIds).toContain("b1-3");
    expect(after.deletedIds).toContain("rel-1");
    expect(after.deletedIds).toContain("bnd-1");
    expect(validateDocumentInvariants(after)).toEqual([]);
  });

  it("coalesces rapid typing commands into one Undo entry", () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const rootId = doc.sheets[0].rootTopic.id;

    adapter.applyCommand(
      { type: "topic/setTitle", sheetId, topicId: rootId, title: createRichText("A") },
      { coalesceKey: `edit:${rootId}` },
    );
    adapter.applyCommand(
      { type: "topic/setTitle", sheetId, topicId: rootId, title: createRichText("AB") },
      { coalesceKey: `edit:${rootId}` },
    );
    adapter.applyCommand(
      { type: "topic/setTitle", sheetId, topicId: rootId, title: createRichText("ABC") },
      { coalesceKey: `edit:${rootId}` },
    );

    adapter.undo();
    expect(adapter.getDocument().sheets[0].rootTopic.title).toEqual(createRichText("中心主题"));
    expect(adapter.canUndo()).toBe(false);
    adapter.redo();
    expect(adapter.getDocument().sheets[0].rootTopic.title).toEqual(createRichText("ABC"));
  });

  it("supports reparent, indent, outdent, detachToFloating", () => {
    const doc = getTemplate("blank-organic").create();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;

    adapter.applyCommand({ type: "topic/indent", sheetId, topicId: "b2" });
    expect(adapter.getDocument().sheets[0].rootTopic.children[0].children.some((c) => c.id === "b2")).toBe(true);

    adapter.applyCommand({ type: "topic/outdent", sheetId, topicId: "b2" });
    expect(adapter.getDocument().sheets[0].rootTopic.children[1].id).toBe("b2");

    adapter.applyCommand({ type: "topic/detachToFloating", sheetId, topicId: "b4", pos: { x: 300, y: 200 } });
    expect(adapter.getDocument().sheets[0].floatingTopics.some((f) => f.id === "b4")).toBe(true);
  });
});

describe("@mindmap/core layout engine (all 9 structures & mixed branches)", () => {
  const structures: MindmapStructure[] = [
    "mindmap",
    "logic",
    "org",
    "brace",
    "indented",
    "timeline",
    "fishbone",
    "treeTable",
    "matrix",
  ];

  it.each(structures)("computes deterministic layout for %s structure", (structure) => {
    const doc = getTemplate("blank-organic").create();
    doc.sheets[0].structure = structure;
    const res1 = computeSheetLayout(doc);
    const res2 = computeSheetLayout(doc);

    expect(res1.nodes.size).toBeGreaterThanOrEqual(10);
    expect(res1.edges.length).toBeGreaterThan(0);
    expect(res1.spatialIndex.all().length).toBe(res1.nodes.size);

    for (const [id, n1] of res1.nodes) {
      const n2 = res2.nodes.get(id)!;
      expect(n1.box).toEqual(n2.box);
      expect(n1.handdrawnSeed).toBe(n2.handdrawnSeed);
      expect(n1.handdrawnSeed).toBe(fnv1aSeed(id));
    }
  });

  it("supports mixed per-branch structure override without dropping nodes", () => {
    const doc = getTemplate("blank-organic").create();
    doc.sheets[0].structure = "mindmap";
    doc.sheets[0].rootTopic.children[0].structure = "org";
    doc.sheets[0].rootTopic.children[1].structure = "brace";
    const res = computeSheetLayout(doc);
    expect(res.nodes.size).toBe(11);
    expect(res.edges.some((e) => e.kind === "brace")).toBe(true);
  });

  it("keeps callout box non-overlapping above contentBox", () => {
    const doc = createDocument();
    doc.sheets[0].rootTopic.children[0] = createTopic("c1", "带批注节点", {
      callout: { id: "co-1", title: createRichText("重要提示") },
    });
    const res = computeSheetLayout(doc);
    const node = res.nodes.get("c1")!;
    expect(node.calloutBox).toBeDefined();
    expect(node.calloutBox!.y + node.calloutBox!.height).toBeLessThan(node.contentBox.y);
  });
});
