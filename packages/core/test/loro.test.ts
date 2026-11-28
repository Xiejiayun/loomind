import { describe, expect, it, vi } from "vitest";
import {
  createDocument,
  createRichText,
  createSheet,
  createTopic,
  getTemplate,
  LocalImmerSyncAdapter,
  richTextToPlainText,
  validateDocumentInvariants,
} from "../src/index.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

describe("LoroSyncAdapter (M4 CRDT collaborative sync)", () => {
  it("replaces a generated tree without resurrecting removed topics in the canvas, peer or history", () => {
    const source = new LoroSyncAdapter(getTemplate("blank-organic").create());
    const before = source.getDocument();
    const peer = LoroSyncAdapter.fromSnapshot(source.exportSnapshot());
    const expected = new LocalImmerSyncAdapter(before);
    const [first, second] = before.sheets[0].rootTopic.children;
    const command = { type: "doc/replaceSheetRoot", sheetId: before.activeSheetId,
      rootTopic: createTopic(before.sheets[0].rootTopic.id, "New map", { children: [second, createTopic("new-parent", "New parent", { children: [first.children[0]] })] }),
    } as const;
    expected.applyCommand(command);
    source.applyCommand(command);
    expect(source.getDocument()).toEqual(expected.getDocument());
    expect(validateDocumentInvariants(source.getDocument())).toEqual([]);
    peer.importUpdates(source.exportUpdates(peer.getVersion()));
    expect(peer.getDocument()).toEqual(source.getDocument());
    source.undo();
    expect(source.getDocument()).toEqual(before);
    source.redo();
    expect(source.getDocument()).toEqual(expected.getDocument());
  });

  it("commits a tree title to peers and history without replacing untouched branches", () => {
    const adapter = new LoroSyncAdapter(getTemplate("blank-organic").create(), 1n);
    const peer = LoroSyncAdapter.fromSnapshot(adapter.exportSnapshot(), 2n);
    const before = adapter.getDocument();
    const [target, sibling] = before.sheets[0].rootTopic.children;
    const title = createRichText("Updated\nleaf");
    const changed = vi.fn();
    adapter.subscribe(changed);

    adapter.applyCommand({ type: "topic/setTitle", sheetId: before.activeSheetId, topicId: target.id, title });
    const after = adapter.getDocument();
    const children = after.sheets[0].rootTopic.children;
    expect(children[0]).toEqual({ ...target, title });
    expect(children[1]).toBe(sibling);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(after, new Set([target.id]));

    peer.importUpdates(adapter.exportUpdates(peer.getVersion()));
    expect(peer.getDocument()).toEqual(after);
    adapter.undo();
    expect(adapter.getDocument()).toEqual(before);
    adapter.redo();
    expect(adapter.getDocument()).toEqual(after);
  });

  it("round-trips floating and summary titles stored outside the Loro tree", () => {
    const root = createTopic("root", "Root", {
      children: [createTopic("first", "First"), createTopic("last", "Last")],
    });
    const sheet = createSheet("sheet", "Map", root, {
      floatingTopics: [createTopic("floating", "Floating", { floatingPos: { x: 10, y: 20 } })],
      summaries: [{
        id: "span", parentId: root.id, startIndex: 0, endIndex: 1,
        brace: "curly", topic: createTopic("summary", "Summary"),
      }],
    });
    const adapter = new LoroSyncAdapter(createDocument([sheet]), 1n);
    const expected = new LocalImmerSyncAdapter(adapter.getDocument());
    const peer = LoroSyncAdapter.fromSnapshot(adapter.exportSnapshot(), 2n);

    for (const topicId of ["floating", "summary", root.id]) {
      const command = {
        type: "topic/setTitle", sheetId: sheet.id, topicId, title: createRichText(`New ${topicId}`),
      } as const;
      expected.applyCommand(command);
      adapter.applyCommand(command);
      peer.importUpdates(adapter.exportUpdates(peer.getVersion()));
      expect(peer.getDocument()).toEqual(expected.getDocument());
      expect(adapter.getDocument()).toEqual(expected.getDocument());
    }
  });

  it("restores a reordered JSON draft without replacing retained topics or erasing an independent peer edit", () => {
    const source = new LoroSyncAdapter(getTemplate("blank-organic").create());
    const restored = LoroSyncAdapter.fromSnapshot(source.exportSnapshot());
    const peer = LoroSyncAdapter.fromSnapshot(source.exportSnapshot());
    const draft = structuredClone(restored.getDocument());
    const root = draft.sheets[0].rootTopic;
    const [first, second, third] = root.children;
    first.children = first.children.slice(1);
    second.children.push(createTopic("extra", "Offline addition"));
    root.children = [third, first, second];
    restored.reconcileDraft(draft);
    expect(restored.getDocument()).toEqual(draft);
    peer.applyCommand({ type: "topic/setTitle", sheetId: draft.activeSheetId, topicId: first.id, title: createRichText("Remote rename") });
    expect(restored.importUpdates(peer.exportUpdates(source.getVersion()))).toBe(true);
    peer.importUpdates(restored.exportUpdates(peer.getVersion()));
    expect(peer.getDocument()).toEqual(restored.getDocument());
    const children = peer.getDocument().sheets[0].rootTopic.children;
    expect(children.map((child) => child.id)).toEqual([third.id, first.id, second.id]);
    expect(children[1].title).toEqual(createRichText("Remote rename"));
    expect(children[2].children.at(-1)?.id).toBe("extra");
    expect(validateDocumentInvariants(peer.getDocument())).toEqual([]);
  });

  it("distinguishes a missing dependency from a duplicate and notifies only for applied changes", () => {
    const source = new LoroSyncAdapter(getTemplate("blank-organic").create());
    const peer = LoroSyncAdapter.fromSnapshot(source.exportSnapshot());
    const changes = vi.fn();
    peer.subscribe(changes);
    source.applyCommand({ type: "topic/addChild", sheetId: "sheet-1", parentId: "root", newId: "parent" });
    const first = source.exportUpdates(peer.getVersion());
    const middle = source.getVersion();
    source.applyCommand({ type: "topic/addChild", sheetId: "sheet-1", parentId: "parent", newId: "child" });
    const second = source.exportUpdates(middle);
    expect(peer.importUpdates(second)).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(peer.importUpdates(first)).toBe(true);
    expect(peer.importUpdates(second)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(peer.getDocument()).toEqual(source.getDocument());
  });

  it("does not add undo history for missing topics or identical serialized titles", () => {
    const adapter = new LoroSyncAdapter(getTemplate("blank-organic").create(), 1n);
    const { activeSheetId: sheetId, sheets } = adapter.getDocument();
    const root = sheets[0].rootTopic;
    for (const topicId of ["missing", root.id]) {
      adapter.applyCommand({ type: "topic/setTitle", sheetId, topicId, title: structuredClone(root.title) });
    }
    expect(adapter.canUndo()).toBe(false);
  });

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
