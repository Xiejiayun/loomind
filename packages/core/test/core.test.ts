import { describe, expect, it } from "vitest";
import {
  buildCurlyBracePath,
  buildRoughSvgPath,
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

  it("keeps deep multi-level fishbone subtrees completely non-overlapping", () => {
    const doc = getTemplate("blank-organic").create();
    doc.sheets[0].structure = "fishbone";
    doc.sheets[0].rootTopic.children.push(
      createTopic("fb-deep", "深层分支", {
        children: [
          createTopic("fb-d1", "二级子主题", {
            children: [
              createTopic("fb-d1-1", "三级子主题 A", {
                children: [createTopic("fb-d1-1-1", "四级节点 1"), createTopic("fb-d1-1-2", "四级节点 2")],
              }),
            ],
          }),
        ],
      }),
      createTopic("fb-next", "相邻大骨主题"),
    );

    const res = computeSheetLayout(doc);
    const list = Array.from(res.nodes.values());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].contentBox;
        const b = list[j].contentBox;
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps, `Nodes ${list[i].id} and ${list[j].id} overlap`).toBe(false);
      }
    }
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

  it("keeps handdrawn paths continuous with exact pinned endpoints and corners", () => {
    const elbow = "M 14 40 V 280 H 28";
    const roughElbow = buildRoughSvgPath(elbow, 12345);
    // Must remain one continuous subpath (never split into disconnected M jumps at the corner)
    expect(roughElbow.match(/\bM\b/g)?.length).toBe(1);
    expect(roughElbow.startsWith("M 14 40 ")).toBe(true);
    expect(roughElbow.includes("14 280")).toBe(true);
    expect(roughElbow.endsWith("28 280")).toBe(true);
    expect(roughElbow).not.toBe(elbow);

    // Deterministic output for identical seed
    expect(buildRoughSvgPath(elbow, 12345)).toBe(roughElbow);

    // Seamless curve + underline stays one unbroken path pinned at both endpoints
    const bezierUnderline = "M 0 0 C 40 0, 40 100, 80 100 H 180";
    const roughBezier = buildRoughSvgPath(bezierUnderline, 999);
    expect(roughBezier.match(/\bM\b/g)?.length).toBe(1);
    expect(roughBezier.startsWith("M 0 0 ")).toBe(true);
    expect(roughBezier.includes("80 100")).toBe(true);
    expect(roughBezier.endsWith("180 100")).toBe(true);

    // Curly brace meets cleanly at its center tip
    const brace = buildCurlyBracePath(100, 0, 120, 1, 14);
    const roughBrace = buildRoughSvgPath(brace, 42);
    expect(roughBrace.match(/\bM\b/g)?.length).toBe(1);
    expect(roughBrace.includes("107 60")).toBe(true);
    expect(roughBrace.endsWith("93 120")).toBe(true);
  });

  it("chains non-overlapping trunks in indented, org, and elbow structures under handdrawn mode", () => {
    // 1. Indented: every child vertical segment chains from previous child's junction (zero duplicate trunk)
    const indDoc = getTemplate("blank-organic").create();
    indDoc.theme.handdrawn = true;
    indDoc.theme.skeletonId = "classic-cards";
    indDoc.sheets[0].structure = "indented";
    const indLayout = computeSheetLayout(indDoc);
    const rootId = indDoc.sheets[0].rootTopic.id;
    const rootEdges = indLayout.edges.filter((e) => e.fromId === rootId);
    expect(rootEdges.length).toBe(indDoc.sheets[0].rootTopic.children.length);
    const startYs = rootEdges.map((e) => Number(e.svgPath.match(/^M [\d.-]+ ([\d.-]+)/)?.[1]));
    for (let i = 1; i < startYs.length; i++) {
      expect(startYs[i]).toBeGreaterThan(startYs[i - 1]);
    }
    for (const edge of indLayout.edges) {
      expect(edge.svgPath.match(/\bM\b/g)?.length).toBe(1);
    }

    // 2. Org: single shared stem per multi-child parent + continuous handdrawn rails
    const orgDoc = getTemplate("blank-organic").create();
    orgDoc.theme.handdrawn = true;
    orgDoc.sheets[0].structure = "org";
    const orgLayout = computeSheetLayout(orgDoc);
    expect(orgLayout.edges.filter((e) => e.id === `org-stem:${orgDoc.sheets[0].rootTopic.id}`)).toHaveLength(1);
    for (const edge of orgLayout.edges) {
      expect(edge.svgPath.match(/\bM\b/g)?.length).toBe(1);
    }

    // 3. Technical-elbow mindmap: single shared stem per side + continuous handdrawn rails
    const elbowDoc = getTemplate("blank-organic").create();
    elbowDoc.theme.handdrawn = true;
    elbowDoc.theme.skeletonId = "technical-elbow";
    elbowDoc.sheets[0].structure = "logic";
    const elbowLayout = computeSheetLayout(elbowDoc);
    expect(elbowLayout.edges.some((e) => e.id.startsWith("elbow-stem:"))).toBe(true);
    for (const edge of elbowLayout.edges) {
      expect(edge.svgPath.match(/\bM\b/g)?.length).toBe(1);
    }
  });
});
