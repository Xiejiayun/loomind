import { describe, expect, it } from "vitest";
import {
  createDocument,
  createSheet,
  createTopic,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  validateDocumentInvariants,
} from "../src/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

describe("topic/insertSubtrees command", () => {
  it("inserts subtrees, merges assets, shifts summaries & boundaries, and supports undo/redo", () => {
    const root = createTopic("root", "Root", {
      children: [createTopic("a", "A"), createTopic("b", "B"), createTopic("c", "C")],
    });
    const sheet = createSheet("s1", "Sheet", root, {
      summaries: [
        {
          id: "sum-1",
          parentId: "root",
          startIndex: 1,
          endIndex: 2,
          brace: "curly",
          topic: createTopic("sumt-1", "Summary BC"),
        },
      ],
      boundaries: [
        {
          id: "bnd-1",
          target: { kind: "range", parentId: "root", startIndex: 1, endIndex: 2 },
          shape: "rounded",
        },
      ],
    });
    const doc = createDocument([sheet]);
    const adapter = new LocalImmerSyncAdapter(doc);

    const inserted = createTopic("dup-a", "A Copy", {
      image: { resourceId: "img-1", width: 120, height: 80, pos: "top" },
      children: [createTopic("dup-a-1", "Grandchild")],
    });

    const rejected = adapter.applyCommand({
      type: "topic/insertSubtrees",
      sheetId: "s1",
      parentId: "root",
      index: 1,
      topics: [inserted],
      assets: {
        "img-1": {
          resourceId: "img-1",
          mimeType: "image/png",
          width: 120,
          height: 80,
          sha256: "abc123",
          dataBase64: "iVBORw0KGgo=",
        },
      },
    });

    expect(rejected).toBeUndefined();
    const after = adapter.getDocument();
    expect(after.sheets[0].rootTopic.children.map((c) => c.id)).toEqual(["a", "dup-a", "b", "c"]);
    expect(after.sheets[0].summaries[0]).toMatchObject({ startIndex: 2, endIndex: 3 });
    expect(after.sheets[0].boundaries[0].target).toEqual({
      kind: "range",
      parentId: "root",
      startIndex: 2,
      endIndex: 3,
    });
    expect(after.assets["img-1"]).toBeDefined();
    expect(MindmapDocumentSchema.safeParse(after).success).toBe(true);
    expect(validateDocumentInvariants(after)).toEqual([]);

    adapter.undo();
    expect(adapter.getDocument().sheets[0].rootTopic.children.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(adapter.getDocument().sheets[0].summaries[0]).toMatchObject({ startIndex: 1, endIndex: 2 });
  });

  it("rejects disallowed asset MIME types atomically", () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const before = adapter.getDocument();

    const rejected = adapter.applyCommand({
      type: "topic/insertSubtrees",
      sheetId: doc.activeSheetId,
      parentId: doc.sheets[0].rootTopic.id,
      topics: [createTopic("bad-1", "Bad")],
      assets: {
        "bad-img": {
          resourceId: "bad-img",
          // @ts-expect-error testing runtime MIME guard
          mimeType: "image/gif",
          width: 100,
          height: 100,
          sha256: "x",
          dataBase64: "R0lGOD==",
        },
      },
    });

    expect(rejected?.code).toBe("UNSUPPORTED_IMAGE_MIME");
    expect(adapter.getDocument()).toBe(before);
    expect(adapter.canUndo()).toBe(false);
  });

  it("syncs inserted subtrees cleanly across LoroSyncAdapter peers", () => {
    const doc = createDocument();
    const peerA = new LoroSyncAdapter(doc, 1n);
    const peerB = LoroSyncAdapter.fromSnapshot(peerA.exportSnapshot(), 2n);

    const rejected = peerA.applyCommand({
      type: "topic/insertSubtrees",
      sheetId: doc.activeSheetId,
      parentId: doc.sheets[0].rootTopic.id,
      topics: [
        createTopic("pasted-1", "Pasted Branch", {
          children: [createTopic("pasted-1-1", "Nested Leaf")],
        }),
      ],
    });
    expect(rejected).toBeUndefined();

    peerB.importUpdates(peerA.exportUpdates(peerB.getVersion()));
    const peerBIds = peerB.getDocument().sheets[0].rootTopic.children.map((c) => c.id);
    expect(peerBIds).toContain("pasted-1");
    const pasted = peerB.getDocument().sheets[0].rootTopic.children.find((c) => c.id === "pasted-1");
    expect(pasted?.children.map((c) => c.id)).toEqual(["pasted-1-1"]);
  });
});
