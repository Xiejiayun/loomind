import { describe, expect, it } from "vitest";
import {
  createRichText,
  getTemplate,
  richTextToPlainText,
  validateDocumentInvariants,
} from "../src/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

describe("LoroSyncAdapter (M4 CRDT collaborative sync)", () => {
  it("synchronizes concurrent tree edits & reparents across two peers without cycles", () => {
    const initial = getTemplate("blank-organic").create();
    const peerA = new LoroSyncAdapter(initial, 1n);
    const peerB = LoroSyncAdapter.fromSnapshot(peerA.exportSnapshot(), 2n);

    const sheetId = initial.activeSheetId;

    // Concurrent edits: Peer A adds child under b1 and reparents b3 under b2
    peerA.applyCommand({
      type: "topic/addChild",
      sheetId,
      parentId: "b1",
      newId: "peer-a-node",
      title: createRichText("来自 Peer A"),
    });
    peerA.applyCommand({
      type: "topic/reparent",
      sheetId,
      topicId: "b3",
      newParentId: "b2",
    });

    // Concurrent edits: Peer B edits b2 title and reparents b2 under b3 (opposite move!)
    peerB.applyCommand({
      type: "topic/setTitle",
      sheetId,
      topicId: "b2",
      title: createRichText("目标拆解（Peer B 编辑）"),
    });
    peerB.applyCommand({
      type: "topic/reparent",
      sheetId,
      topicId: "b2",
      newParentId: "b3",
    });

    // Exchange CRDT updates in both directions
    const updateA = peerA.exportUpdates();
    const updateB = peerB.exportUpdates();
    peerA.importUpdates(updateB);
    peerB.importUpdates(updateA);

    const docA = peerA.getDocument();
    const docB = peerB.getDocument();

    // Both peers converge to an identical, cycle-free tree with all invariants valid
    expect(validateDocumentInvariants(docA)).toEqual([]);
    expect(validateDocumentInvariants(docB)).toEqual([]);
    expect(JSON.stringify(docA.sheets[0].rootTopic)).toBe(JSON.stringify(docB.sheets[0].rootTopic));
    expect(richTextToPlainText(docA.sheets[0].rootTopic.children[0].children.at(-1)!.title)).toBe("来自 Peer A");
  });

  it("supports local Undo/Redo and peer presence awareness", () => {
    const initial = getTemplate("blank-organic").create();
    const adapter = new LoroSyncAdapter(initial, 10n);
    const sheetId = initial.activeSheetId;

    adapter.applyCommand({
      type: "topic/addChild",
      sheetId,
      parentId: "b1",
      newId: "u1",
      title: createRichText("临时节点"),
    });
    expect(adapter.canUndo()).toBe(true);
    adapter.undo();
    expect(
      adapter.getDocument().sheets[0].rootTopic.children[0].children.some((c) => c.id === "u1"),
    ).toBe(false);
    adapter.redo();
    expect(
      adapter.getDocument().sheets[0].rootTopic.children[0].children.some((c) => c.id === "u1"),
    ).toBe(true);

    adapter.setPeerPresence({
      peerId: "user-2",
      name: "Alice",
      color: "#3B82F6FF",
      selectedTopicIds: ["b1"],
      cursor: { x: 120, y: 80 },
      updatedAt: Date.now(),
    });
    expect(adapter.getPeerPresences()).toHaveLength(1);
    expect(adapter.getPeerPresences()[0].name).toBe("Alice");
  });
});
