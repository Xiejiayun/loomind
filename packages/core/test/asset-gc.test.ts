import { describe, expect, it, vi } from "vitest";
import {
  createDocument,
  createSheet,
  createTopic,
  isAllowedImageMimeType,
  LocalImmerSyncAdapter,
  MindmapDocumentSchema,
  validateDocumentInvariants,
  type InlineAsset,
} from "../src/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

function makeAsset(resourceId: string, sizeBytes = 32, mimeType: InlineAsset["mimeType"] = "image/png"): InlineAsset {
  return {
    resourceId,
    mimeType,
    width: 180,
    height: 120,
    sha256: resourceId,
    dataBase64: "A".repeat(sizeBytes),
  };
}

describe("T4 image MIME validation & full-document zero-reference asset GC", () => {
  it("atomically rejects unsupported MIME types (e.g. image/gif) with zero side effects across adapters", () => {
    expect(isAllowedImageMimeType("image/png")).toBe(true);
    expect(isAllowedImageMimeType("image/jpeg")).toBe(true);
    expect(isAllowedImageMimeType("image/webp")).toBe(true);
    expect(isAllowedImageMimeType("image/svg+xml")).toBe(true);
    expect(isAllowedImageMimeType("image/gif")).toBe(false);
    expect(isAllowedImageMimeType("image/bmp")).toBe(false);

    const base = createDocument();
    const sheetId = base.sheets[0].id;
    const targetId = base.sheets[0].rootTopic.children[0].id;

    const local = new LocalImmerSyncAdapter(base);
    const loro = new LoroSyncAdapter(base);
    const localListener = vi.fn();
    const loroListener = vi.fn();
    local.subscribe(localListener);
    loro.subscribe(loroListener);

    const badCmd = {
      type: "topic/setImage" as const,
      sheetId,
      topicId: targetId,
      image: { resourceId: "img-gif", width: 100, height: 100, pos: "top" as const },
      asset: {
        resourceId: "img-gif",
        mimeType: "image/gif" as unknown as InlineAsset["mimeType"],
        width: 100,
        height: 100,
        sha256: "img-gif",
        dataBase64: "R0lGODlh",
      },
    };

    expect(local.applyCommand(badCmd)?.code).toBe("UNSUPPORTED_IMAGE_MIME");
    expect(loro.applyCommand(badCmd)?.code).toBe("UNSUPPORTED_IMAGE_MIME");
    expect(local.getDocument()).toBe(base);
    expect(local.canUndo()).toBe(false);
    expect(localListener).not.toHaveBeenCalled();
    expect(loro.canUndo()).toBe(false);
    expect(loroListener).not.toHaveBeenCalled();
  });

  it("reclaims zero-reference assets on clear/replace/delete/summary-remove, preserves shared references across sheets/floating/summaries, and restores via undo/redo", () => {
    const s1 = createSheet(
      "sheet-1",
      "S1",
      createTopic("r1", "R1", { children: [createTopic("b1", "B1"), createTopic("b2", "B2")] }),
      {
        floatingTopics: [createTopic("f1", "F1", { floatingPos: { x: 10, y: 10 } })],
        summaries: [
          {
            id: "sum-1",
            parentId: "r1",
            startIndex: 0,
            endIndex: 0,
            brace: "curly",
            topic: createTopic("sum-t1", "Sum T1"),
          },
        ],
      },
    );
    const s2 = createSheet("sheet-2", "S2", createTopic("r2", "R2", { children: [createTopic("s2-b1", "S2-B1")] }));
    const base = createDocument([s1, s2]);

    const adapter = new LocalImmerSyncAdapter(base);
    const shared = makeAsset("img-shared", 64);
    const solo = makeAsset("img-solo", 64);
    const sumAsset = makeAsset("img-sum", 64);

    // Attach shared asset to b1 (sheet-1), f1 (floating), sum-t1 (summary), and s2-b1 (sheet-2)
    adapter.applyCommand({
      type: "topic/setImage",
      sheetId: "sheet-1",
      topicId: "b1",
      image: { resourceId: "img-shared", width: 100, height: 100, pos: "top" },
      asset: shared,
    });
    adapter.applyCommand({
      type: "topic/setImage",
      sheetId: "sheet-1",
      topicId: "f1",
      image: { resourceId: "img-shared", width: 100, height: 100, pos: "top" },
    });
    adapter.applyCommand({
      type: "topic/setImage",
      sheetId: "sheet-2",
      topicId: "s2-b1",
      image: { resourceId: "img-shared", width: 100, height: 100, pos: "top" },
    });
    adapter.applyCommand({
      type: "topic/setImage",
      sheetId: "sheet-1",
      topicId: "b2",
      image: { resourceId: "img-solo", width: 100, height: 100, pos: "top" },
      asset: solo,
    });
    adapter.applyCommand({
      type: "topic/setImage",
      sheetId: "sheet-1",
      topicId: "sum-t1",
      image: { resourceId: "img-sum", width: 100, height: 100, pos: "top" },
      asset: sumAsset,
    });

    // Clear b1 -> shared still referenced by f1 and s2-b1 -> MUST remain!
    adapter.applyCommand({ type: "topic/setImage", sheetId: "sheet-1", topicId: "b1", image: undefined });
    expect(adapter.getDocument().assets["img-shared"]).toBeDefined();

    // Clear b2 -> solo has 0 refs -> MUST be reclaimed!
    adapter.applyCommand({ type: "topic/setImage", sheetId: "sheet-1", topicId: "b2", image: undefined });
    expect(adapter.getDocument().assets["img-solo"]).toBeUndefined();

    // Undo restores img-solo; redo reclaims it again!
    adapter.undo();
    expect(adapter.getDocument().assets["img-solo"]).toEqual(solo);
    adapter.redo();
    expect(adapter.getDocument().assets["img-solo"]).toBeUndefined();

    // Remove summary sum-1 -> img-sum has 0 refs -> MUST be reclaimed!
    adapter.applyCommand({ type: "summary/remove", sheetId: "sheet-1", summaryId: "sum-1" });
    expect(adapter.getDocument().assets["img-sum"]).toBeUndefined();

    // Delete floating f1 -> shared still referenced by sheet-2 -> MUST remain!
    adapter.applyCommand({ type: "topic/delete", sheetId: "sheet-1", topicIds: ["f1"] });
    expect(adapter.getDocument().assets["img-shared"]).toBeDefined();

    // Remove sheet-2 -> shared now has 0 refs -> MUST be reclaimed!
    adapter.applyCommand({ type: "sheet/remove", sheetId: "sheet-2" });
    expect(adapter.getDocument().assets["img-shared"]).toBeUndefined();
    expect(Object.keys(adapter.getDocument().assets)).toEqual([]);
    expect(MindmapDocumentSchema.safeParse(adapter.getDocument()).success).toBe(true);
    expect(validateDocumentInvariants(adapter.getDocument())).toEqual([]);
  });

  it("drops serialized UTF-8 byte size back below 1 MiB 413 boundary after clearing a large image", () => {
    const DRAFT_LIMIT = 1024 * 1024;
    const base = createDocument();
    const sheetId = base.sheets[0].id;
    const topicId = base.sheets[0].rootTopic.children[0].id;

    const adapter = new LocalImmerSyncAdapter(base);
    const largeAsset = makeAsset("img-large", DRAFT_LIMIT + 1024);
    adapter.applyCommand({
      type: "topic/setImage",
      sheetId,
      topicId,
      image: { resourceId: "img-large", width: 800, height: 600, pos: "top" },
      asset: largeAsset,
    });

    const overBytes = new TextEncoder().encode(JSON.stringify(adapter.getDocument())).byteLength;
    expect(overBytes).toBeGreaterThan(DRAFT_LIMIT);

    // Clear image -> GC reclaims img-large -> UTF-8 byte size drops well below 1 MiB
    adapter.applyCommand({ type: "topic/setImage", sheetId, topicId, image: undefined });
    const afterBytes = new TextEncoder().encode(JSON.stringify(adapter.getDocument())).byteLength;
    expect(afterBytes).toBeLessThan(DRAFT_LIMIT);
    expect(adapter.getDocument().assets["img-large"]).toBeUndefined();
  });
});
