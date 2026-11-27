import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDocument, createSheet, createTopic, validateDocumentInvariants, type InlineAsset } from "../src/model/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

function fixture() {
  return createDocument([createSheet("sheet", "Photos", createTopic("root", "Report", {
    children: Array.from({ length: 5 }, (_, index) => createTopic(`photo-${index}`, `Photo ${index}`)),
  }))]);
}

function photo(index: number): InlineAsset {
  const contents = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><desc>${randomBytes(64 * 1024).toString("base64")}</desc><rect width="10" height="10"/></svg>`);
  return { resourceId: `resource-${index}`, dataBase64: contents.toString("base64"), sha256: createHash("sha256").update(contents).digest("hex"), mimeType: "image/svg+xml", width: 10, height: 10 };
}

function attach(adapter: LoroSyncAdapter, index: number, asset: InlineAsset) {
  adapter.applyCommand({ type: "topic/setImage", sheetId: "sheet", topicId: `photo-${index}`, asset,
    image: { resourceId: asset.resourceId, pos: "top", width: 10, height: 10 } });
}

describe("collaborative image resources", () => {
  it("sends just the newly attached photo rather than retransmitting previous photos", () => {
    const adapter = new LoroSyncAdapter(fixture());
    const frameBytes: number[] = [];
    for (let index = 0; index < 5; index++) {
      const before = adapter.getVersion();
      attach(adapter, index, photo(index));
      frameBytes.push(adapter.exportUpdates(before).byteLength);
    }
    expect(Math.max(...frameBytes), `successive delta bytes: ${frameBytes.join(", ")}`).toBeLessThan(frameBytes[0] * 1.2);
  });

  it("preserves both photos when two peers attach images to different nodes concurrently", () => {
    const first = new LoroSyncAdapter(fixture(), 1n);
    const second = new LoroSyncAdapter(undefined, 2n);
    second.importUpdates(first.exportUpdates());
    const base = first.getVersion();
    const left = photo(0), right = photo(1);
    attach(first, 0, left); attach(second, 1, right);
    const firstDelta = first.exportUpdates(base);
    first.importUpdates(second.exportUpdates(base)); second.importUpdates(firstDelta);
    for (const peer of [first, second]) {
      expect(Object.keys(peer.getDocument().assets).sort()).toEqual([left.resourceId, right.resourceId]);
      expect(validateDocumentInvariants(peer.getDocument())).toEqual([]);
    }
    first.undo(); second.importUpdates(first.exportUpdates(second.getVersion()));
    expect(second.getDocument().assets).toEqual({ [right.resourceId]: right });
    first.redo(); second.importUpdates(first.exportUpdates(second.getVersion()));
    expect(second.getDocument().assets).toEqual({ [left.resourceId]: left, [right.resourceId]: right });
  });

  it("keeps the existing image dictionary readable and writable when joining a legacy history", () => {
    const original = new LoroSyncAdapter(fixture());
    const legacyMeta = original.getLoroDoc().getMap("meta");
    legacyMeta.set("assets", "{}");
    original.getLoroDoc().commit();
    const joined = new LoroSyncAdapter();
    joined.importUpdates(original.exportUpdates());
    const asset = photo(0);
    attach(joined, 0, asset);
    original.importUpdates(joined.exportUpdates(original.getVersion()));
    expect(JSON.parse(String(legacyMeta.get("assets")))).toEqual({ [asset.resourceId]: asset });
    expect(original.getDocument().assets).toEqual(joined.getDocument().assets);
  });
});
