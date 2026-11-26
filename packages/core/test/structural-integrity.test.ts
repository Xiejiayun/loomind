import { describe, expect, it, vi } from "vitest";
import {
  createDocument,
  createMindmapStore,
  createSheet,
  createTopic,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  validateDocumentInvariants,
  type MindmapDocument,
} from "../src/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

function buildFixtureDoc(): MindmapDocument {
  const b1 = createTopic("b1", "B1", {
    children: [createTopic("b1-1", "B1-1"), createTopic("b1-2", "B1-2")],
  });
  const b2 = createTopic("b2", "B2");
  const b3 = createTopic("b3", "B3");
  const b4 = createTopic("b4", "B4");
  const root = createTopic("root", "Root", { children: [b1, b2, b3, b4] });
  const floating = createTopic("float-1", "Float 1", { floatingPos: { x: 200, y: 200 } });
  const sheet = createSheet("sheet-1", "Sheet 1", root, {
    floatingTopics: [floating],
    summaries: [
      {
        id: "sum-multi",
        parentId: "root",
        startIndex: 0,
        endIndex: 1, // covers [b1, b2]
        brace: "curly",
        topic: createTopic("sum-multi-topic", "Summary Multi", {
          children: [createTopic("sum-multi-child", "Child of Summary")],
        }),
      },
      {
        id: "sum-single",
        parentId: "root",
        startIndex: 3,
        endIndex: 3, // covers [b4]
        brace: "bracket",
        topic: createTopic("sum-single-topic", "Summary Single", {
          children: [createTopic("sum-single-child", "Single Child")],
        }),
      },
    ],
  });
  return createDocument([sheet]);
}

function coveredIds(doc: MindmapDocument, summaryId: string): string[] {
  const sheet = doc.sheets[0];
  const s = sheet.summaries.find((x) => x.id === summaryId);
  if (!s) return [];
  const find = (t: typeof sheet.rootTopic): typeof sheet.rootTopic | null => {
    if (t.id === s.parentId) return t;
    for (const c of t.children) {
      const f = find(c);
      if (f) return f;
    }
    return null;
  };
  let parent = find(sheet.rootTopic);
  if (!parent) {
    for (const f of sheet.floatingTopics) {
      parent = find(f);
      if (parent) break;
    }
  }
  if (!parent) return [];
  return parent.children.slice(s.startIndex, s.endIndex + 1).map((c) => c.id);
}

describe("T2 Core structural commands, summary semantics & referential integrity", () => {
  it("shrinks multi-member summary on indent/reparent/detach and migrates single-member summary across both adapters", () => {
    const base = buildFixtureDoc();
    expect(validateDocumentInvariants(base)).toEqual([]);

    for (const adapter of [new LocalImmerSyncAdapter(base), new LoroSyncAdapter(base)]) {
      // 1. Indent b2 under b1 -> multi-member summary [b1, b2] shrinks to [b1]
      expect(adapter.applyCommand({ type: "topic/indent", sheetId: "sheet-1", topicId: "b2" })).toBeUndefined();
      let doc = adapter.getDocument();
      expect(validateDocumentInvariants(doc)).toEqual([]);
      expect(MindmapDocumentSchema.safeParse(doc).success).toBe(true);
      expect(coveredIds(doc, "sum-multi")).toEqual(["b1"]);
      expect(coveredIds(doc, "sum-single")).toEqual(["b4"]);

      // 2. Indent b4 (sole member of sum-single) under b3 -> migrates sum-single to parentId="b3" with subtree intact
      expect(adapter.applyCommand({ type: "topic/indent", sheetId: "sheet-1", topicId: "b4" })).toBeUndefined();
      doc = adapter.getDocument();
      expect(validateDocumentInvariants(doc)).toEqual([]);
      const migrated = doc.sheets[0].summaries.find((s) => s.id === "sum-single")!;
      expect(migrated.parentId).toBe("b3");
      expect(migrated.startIndex).toBe(0);
      expect(migrated.endIndex).toBe(0);
      expect(migrated.topic.children[0].id).toBe("sum-single-child");
      expect(coveredIds(doc, "sum-single")).toEqual(["b4"]);

      // 3. Outdent b4 back to root -> migrates sum-single back to root covering [b4]
      expect(adapter.applyCommand({ type: "topic/outdent", sheetId: "sheet-1", topicId: "b4" })).toBeUndefined();
      doc = adapter.getDocument();
      expect(validateDocumentInvariants(doc)).toEqual([]);
      expect(coveredIds(doc, "sum-single")).toEqual(["b4"]);

      // 4. Undo restores previous state cleanly
      adapter.undo();
      doc = adapter.getDocument();
      expect(validateDocumentInvariants(doc)).toEqual([]);
      expect(doc.sheets[0].summaries.find((s) => s.id === "sum-single")?.parentId).toBe("b3");
    }
  });

  it("atomically rejects summary-breaking reorder, interior reparent, and single-member detach with zero side effects", () => {
    const base = buildFixtureDoc();
    const local = new LocalImmerSyncAdapter(base);
    const loro = new LoroSyncAdapter(base);
    const localListener = vi.fn();
    const loroListener = vi.fn();
    local.subscribe(localListener);
    loro.subscribe(loroListener);
    const initialLoroVersion = loro.getVersion().toJSON();

    // 1. Reorder b3 into middle of [b1, b2] (index 2 -> 1) breaks [b1, b2] contiguity -> REJECT
    const r1Local = local.applyCommand({ type: "topic/reorder", sheetId: "sheet-1", topicId: "b3", delta: -1 });
    const r1Loro = loro.applyCommand({ type: "topic/reorder", sheetId: "sheet-1", topicId: "b3", delta: -1 });
    expect(r1Local?.code).toBe("SUMMARY_RANGE_BROKEN");
    expect(r1Loro?.code).toBe("SUMMARY_RANGE_BROKEN");

    // 2. Cross-parent reparent b1-1 into index 1 of root (strictly inside [b1, b2]) -> REJECT
    const r2Local = local.applyCommand({
      type: "topic/reparent",
      sheetId: "sheet-1",
      topicId: "b1-1",
      newParentId: "root",
      index: 1,
    });
    const r2Loro = loro.applyCommand({
      type: "topic/reparent",
      sheetId: "sheet-1",
      topicId: "b1-1",
      newParentId: "root",
      index: 1,
    });
    expect(r2Local?.code).toBe("SUMMARY_RANGE_BROKEN");
    expect(r2Loro?.code).toBe("SUMMARY_RANGE_BROKEN");

    // 3. detachToFloating on single-member summary topic b4 -> REJECT
    const r3Local = local.applyCommand({
      type: "topic/detachToFloating",
      sheetId: "sheet-1",
      topicId: "b4",
      pos: { x: 100, y: 100 },
    });
    const r3Loro = loro.applyCommand({
      type: "topic/detachToFloating",
      sheetId: "sheet-1",
      topicId: "b4",
      pos: { x: 100, y: 100 },
    });
    expect(r3Local?.code).toBe("SUMMARY_CANNOT_DETACH");
    expect(r3Loro?.code).toBe("SUMMARY_CANNOT_DETACH");

    // Verify ZERO side effects on both adapters
    expect(local.getDocument()).toBe(base);
    expect(local.canUndo()).toBe(false);
    expect(localListener).not.toHaveBeenCalled();
    expect(loro.canUndo()).toBe(false);
    expect(loroListener).not.toHaveBeenCalled();
    expect(loro.getVersion().toJSON()).toEqual(initialLoroVersion);

    // Store surfaces lastRejection without mutating doc
    const store = createMindmapStore(base);
    const storeDocBefore = store.getState().doc;
    store.getState().dispatch({ type: "topic/detachToFloating", sheetId: "sheet-1", topicId: "b4", pos: { x: 0, y: 0 } });
    expect(store.getState().doc).toBe(storeDocBefore);
    expect(store.getState().lastRejection?.code).toBe("SUMMARY_CANNOT_DETACH");
  });

  it("allows valid reorder inside a summary and multi-member detachToFloating", () => {
    const base = buildFixtureDoc();
    const local = new LocalImmerSyncAdapter(base);

    // Swapping b1 and b2 keeps [b1, b2] contiguous at [0, 1]
    expect(local.applyCommand({ type: "topic/reorder", sheetId: "sheet-1", topicId: "b1", delta: 1 })).toBeUndefined();
    expect(coveredIds(local.getDocument(), "sum-multi").sort()).toEqual(["b1", "b2"]);
    expect(validateDocumentInvariants(local.getDocument())).toEqual([]);

    // Detaching b2 from multi-member [b2, b1] shrinks sum-multi to [b1]
    expect(
      local.applyCommand({ type: "topic/detachToFloating", sheetId: "sheet-1", topicId: "b2", pos: { x: 50, y: 50 } }),
    ).toBeUndefined();
    expect(coveredIds(local.getDocument(), "sum-multi")).toEqual(["b1"]);
    expect(coveredIds(local.getDocument(), "sum-single")).toEqual(["b4"]);
    expect(validateDocumentInvariants(local.getDocument())).toEqual([]);
  });

  it("performs fixed-point cascadeCleanup on nested summaries and doc/replaceSheetRoot while preserving reused root.id and floating topics", () => {
    const base = buildFixtureDoc();
    // Add nested summary on sum-multi-topic's child + relationship from sum-multi-child to float-1 + boundary on b1 + valid boundary on float-1
    base.sheets[0].summaries.push({
      id: "sum-nested",
      parentId: "sum-multi-topic",
      startIndex: 0,
      endIndex: 0,
      brace: "round",
      topic: createTopic("sum-nested-topic", "Nested Summary"),
    });
    base.sheets[0].relationships.push(
      { id: "rel-nested-to-float", fromId: "sum-nested-topic", toId: "float-1" },
      { id: "rel-float-self", fromId: "float-1", toId: "float-1" },
    );
    base.sheets[0].boundaries.push(
      { id: "bnd-b1", target: { kind: "subtree", topicId: "b1" }, shape: "rounded" },
      { id: "bnd-float", target: { kind: "subtree", topicId: "float-1" }, shape: "cloud" },
    );
    expect(validateDocumentInvariants(base)).toEqual([]);

    // Replace root reusing "root" ID with a brand new child "new-c1"
    const adapter = new LocalImmerSyncAdapter(base);
    adapter.applyCommand({
      type: "doc/replaceSheetRoot",
      sheetId: "sheet-1",
      rootTopic: createTopic("root", "New Root", { children: [createTopic("new-c1", "New C1")] }),
    });

    const next = adapter.getDocument();
    expect(validateDocumentInvariants(next)).toEqual([]);
    expect(MindmapDocumentSchema.safeParse(next).success).toBe(true);

    // Reused root.id must NOT be tombstoned!
    expect(next.deletedIds).not.toContain("root");

    // Floating topic and its valid relationship & boundary MUST be preserved
    expect(next.sheets[0].floatingTopics.map((f) => f.id)).toEqual(["float-1"]);
    expect(next.sheets[0].relationships.map((r) => r.id)).toEqual(["rel-float-self"]);
    expect(next.sheets[0].boundaries.map((b) => b.id)).toEqual(["bnd-float"]);

    // Vanished summaries, nested summary, nested summary topic, and dangling rel/boundary MUST be cleaned & recorded in deletedIds
    expect(next.sheets[0].summaries).toEqual([]);
    expect(next.deletedIds).toEqual(
      expect.arrayContaining([
        "b1",
        "sum-multi",
        "sum-multi-topic",
        "sum-multi-child",
        "sum-nested",
        "sum-nested-topic",
        "rel-nested-to-float",
        "bnd-b1",
      ]),
    );
  });

  it("detects dangling boundary targets in validateDocumentInvariants", () => {
    const doc = buildFixtureDoc();
    doc.sheets[0].boundaries.push(
      { id: "bnd-missing-subtree", target: { kind: "subtree", topicId: "non-existent" }, shape: "rounded" },
      {
        id: "bnd-invalid-range",
        target: { kind: "range", parentId: "root", startIndex: 0, endIndex: 99 },
        shape: "bracket",
      },
    );
    const violations = validateDocumentInvariants(doc);
    expect(violations.filter((v) => v.code === "DANGLING_REFERENCE")).toHaveLength(2);
  });
});
