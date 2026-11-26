import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { getTemplate, type MindmapDocument } from "@mindmap/core";
import { listLocalMaps, loadLocal, saveLocal } from "../src/persistence.js";
import { CloudError } from "../src/drafts/cloud.js";
import type { CloudDraft, LocalDraft } from "../src/drafts/shared.js";
import { DraftWorkspace, type SyncState } from "../src/drafts/workspace.js";

function documentWith(title: string) {
  const doc = getTemplate("blank-organic").create();
  return { ...doc, sheets: [{ ...doc.sheets[0], title }] };
}

function fixture(owner: string | null, local: LocalDraft | null = null, cloud: CloudDraft = { revision: 0, document: null }) {
  const id = owner ? "11111111-1111-4111-8111-111111111111" : null;
  const storage = {
    loadLocal: vi.fn(async () => local), saveLocal: vi.fn(async (_owner: string | null, _draft: LocalDraft, _id?: string) => {}),
    readCloud: vi.fn(async () => cloud), writeCloud: vi.fn(async (_owner: string, _id: string, revision: number, _doc: MindmapDocument) => revision + 1),
  };
  const show = vi.fn<(doc: MindmapDocument) => void>();
  const status = vi.fn<(state: SyncState) => void>();
  const warning = vi.fn<(message: string) => void>();
  return { storage, show, status, warning, id, space: new DraftWorkspace(owner, id, show, status, warning, storage) };
}

describe("local draft storage", () => {
  it("keeps the original guest record compatible and never shares documents between account keys", async () => {
    const guest = { document: documentWith("guest"), dirty: true, revision: 0 };
    const alice = { document: documentWith("alice"), dirty: true, revision: 9 };
    await saveLocal(null, guest);
    await saveLocal("alice", alice);
    expect((await loadLocal(null))?.document).toEqual(guest.document);
    expect(await loadLocal("alice")).toEqual(alice);
    expect(await loadLocal("bob")).toBeNull();
    const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open("loomind-db"); req.onsuccess = () => resolve(req.result); });
    const legacy = await new Promise((resolve) => { const req = db.transaction("docs").objectStore("docs").get("active-document"); req.onsuccess = () => resolve(req.result); });
    expect(legacy).toEqual(guest.document);
    db.close();
  });
  it("keeps independent account maps and lists only the signed-in owner's maps", async () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const aliceFirst = { document: documentWith("第一张"), revision: 1, dirty: false };
    const aliceSecond = { document: documentWith("第二张"), revision: 0, dirty: true };
    await saveLocal("alice", aliceFirst, first);
    await saveLocal("alice", aliceSecond, second);
    await saveLocal("bob", { ...aliceFirst, document: documentWith("Bob") }, first);
    expect(await loadLocal("alice", first)).toEqual(aliceFirst);
    expect(await loadLocal("alice", second)).toEqual(aliceSecond);
    expect((await listLocalMaps("alice")).map((map) => map.title).sort()).toEqual(["第一张", "第二张"]);
    expect((await listLocalMaps("bob")).map((map) => map.title)).toEqual(["Bob"]);
  });
});

describe("local-first workspace", () => {
  it("starts a new guest map without sample branches and preserves a returning guest's map", async () => {
    const fresh = fixture(null);
    await fresh.space.start();
    expect(fresh.show.mock.calls[0][0].sheets[0].rootTopic.children).toHaveLength(0);
    expect(fresh.show.mock.calls[0][0].theme.paletteId).toBe("workspace");
    expect(fresh.storage.saveLocal).not.toHaveBeenCalled();
    const saved = documentWith("我的导图");
    const returning = fixture(null, { document: saved, revision: 0, dirty: true });
    await returning.space.start();
    expect(returning.show).toHaveBeenCalledWith(saved);
    fresh.space.close(); returning.space.close();
  });
  it("flushes guest edits during a switch without making a cloud request", async () => {
    const { space, storage } = fixture(null);
    await space.start();
    const edited = documentWith("guest edit"); space.edit(edited); space.close();
    expect(storage.saveLocal).toHaveBeenCalledWith(null, { document: edited, revision: 0, dirty: true }, undefined);
    expect(storage.readCloud).not.toHaveBeenCalled(); expect(storage.writeCloud).not.toHaveBeenCalled();
  });

  it("restores the account draft on a new device without uploading its blank template", async () => {
    const remote = documentWith("remote");
    const { space, storage, show, id } = fixture("alice", null, { document: remote, revision: 7 });
    await space.start(); space.close();
    expect(show).toHaveBeenLastCalledWith(remote);
    expect(storage.saveLocal).toHaveBeenCalledWith("alice", { document: remote, revision: 7, dirty: false }, id);
    expect(storage.writeCloud).not.toHaveBeenCalled();
  });

  it("retains offline edits and retries their original revision", async () => {
    const local = { document: documentWith("offline edit"), revision: 2, dirty: true };
    const { space, storage, status, id } = fixture("alice", local, { document: documentWith("old"), revision: 2 });
    storage.readCloud.mockRejectedValueOnce(new CloudError(0, "offline"));
    await space.start(); expect(status.mock.lastCall?.[0].label).toBe("未同步");
    await space.sync(); space.close();
    expect(storage.writeCloud).toHaveBeenCalledWith("alice", id, 2, local.document);
    expect(storage.saveLocal).toHaveBeenLastCalledWith("alice", { ...local, revision: 3, dirty: false }, id);
  });

  it("retains divergent local edits until the user explicitly chooses the cloud copy", async () => {
    const local = { document: documentWith("local edit"), revision: 2, dirty: true };
    const remote = { document: documentWith("other device"), revision: 3 };
    const { space, storage, status, show, id } = fixture("alice", local, remote);
    await space.start();
    expect(status.mock.lastCall?.[0].conflict).toBe(true); expect(show).toHaveBeenLastCalledWith(local.document);
    await space.sync(); expect(storage.writeCloud).not.toHaveBeenCalled();
    await space.sync(true); space.close();
    expect(show).toHaveBeenLastCalledWith(remote.document);
    expect(storage.saveLocal).toHaveBeenLastCalledWith("alice", { ...remote, dirty: false }, id);
  });

  it("reconciles a saved copy after losing its acknowledgement", async () => {
    const doc = documentWith("same content");
    const { space, storage, id } = fixture("alice", { document: doc, revision: 0, dirty: true }, { document: structuredClone(doc), revision: 1 });
    await space.start(); space.close();
    expect(storage.writeCloud).not.toHaveBeenCalled();
    expect(storage.saveLocal).toHaveBeenCalledWith("alice", { document: doc, revision: 1, dirty: false }, id);
  });

  it("does not mark edits made during an upload as synced", async () => {
    const { space, storage, id } = fixture("alice"); await space.start();
    space.edit(documentWith("first"));
    const upload = Promise.withResolvers<number>(); storage.writeCloud.mockReturnValueOnce(upload.promise);
    const started = space.sync();
    const later = documentWith("edited during upload"); space.edit(later); upload.resolve(1); await started;
    expect(storage.saveLocal).toHaveBeenCalledWith("alice", { document: later, dirty: true, revision: 1 }, id);
    await space.sync(); space.close();
    expect(storage.writeCloud).toHaveBeenLastCalledWith("alice", id, 1, later);
  });

  it("never reopens the old account after an in-flight read resolves", async () => {
    const { space, storage, show } = fixture("alice");
    const read = Promise.withResolvers<CloudDraft>(); storage.readCloud.mockReturnValueOnce(read.promise);
    const started = space.start(); await Promise.resolve(); space.close();
    const old = documentWith("old account"); read.resolve({ revision: 1, document: old }); await started;
    expect(show).not.toHaveBeenCalledWith(old); expect(storage.writeCloud).not.toHaveBeenCalled();
  });

  it("surfaces local quota errors without claiming that a guest draft was saved", async () => {
    const { space, storage, warning } = fixture(null); await space.start();
    storage.saveLocal.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    space.edit(documentWith("unsaved")); await space.flush();
    expect(warning.mock.lastCall?.[0]).toContain("本机保存失败"); space.close();
  });
});
