import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTemplate, MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core";
import {
  confirmUploadCas,
  DB_NAME,
  discardCorruptRecord,
  discardDraftCas,
  fingerprintDocument,
  listLocalMaps,
  loadLocal,
  loadMapState,
  markMigrated,
  putDraftCas,
  putSyncedCas,
  removeCleanSyncedCas,
  resetDbConnectionForTest,
  saveLocal,
  STORE_NAME,
  v2DraftKey,
  v2SyncedKey,
} from "../src/persistence.js";
import { CloudError } from "../src/drafts/cloud.js";
import { MAP_ID, mapTitle, type CloudDraft, type LocalDraft } from "../src/drafts/shared.js";
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

async function clearDb() {
  resetDbConnectionForTest();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

async function rawGetAll(): Promise<Array<{ key: string; value: unknown }>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const items: Array<{ key: string; value: unknown }> = [];
      const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { resolve(items); return; }
        items.push({ key: String(c.key), value: c.value });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function rawPut(key: string, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function createV2CloudHarness(initialRev = 1, initialDoc: MindmapDocument | null = documentWith("initial")) {
  let cloudRev = initialRev;
  let cloudDoc: MindmapDocument | null = initialDoc;
  const readCloud = vi.fn(async () => ({ revision: cloudRev, document: cloudDoc ? structuredClone(cloudDoc) : null }));
  const writeCloud = vi.fn(async (_owner: string, _id: string, expectedRev: number, doc: MindmapDocument) => {
    if (expectedRev !== cloudRev) throw new CloudError(409, "conflict");
    cloudRev += 1;
    cloudDoc = structuredClone(doc);
    return cloudRev;
  });
  return {
    get state() { return { revision: cloudRev, document: cloudDoc }; },
    setCloud(rev: number, doc: MindmapDocument | null) { cloudRev = rev; cloudDoc = doc; },
    readCloud,
    writeCloud,
    storage: {
      loadLocal,
      saveLocal,
      readCloud,
      writeCloud,
      loadMapState,
      putSyncedCas,
      putDraftCas,
      confirmUploadCas,
      discardDraftCas,
      removeCleanSyncedCas,
      discardCorruptRecord,
      markMigrated,
    },
  };
}

describe("T1 v2 draft isolation, CAS, causal watermark, remote-unavailable, and rollback recovery", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("isolates two tabs sharing real fake-indexeddb so winner writeback never overwrites loser draft (before or after 409) and reload recovers it", async () => {
    const owner = "alice";
    const mapId = "11111111-1111-4111-8111-111111111111";
    const cloud = createV2CloudHarness(1, documentWith("v1"));

    const tabA = new DraftWorkspace(owner, mapId, vi.fn(), vi.fn(), vi.fn(), cloud.storage);
    const tabB = new DraftWorkspace(owner, mapId, vi.fn(), vi.fn(), vi.fn(), cloud.storage);
    await tabA.start();
    await tabB.start();

    const docA = documentWith("tab-A-wins");
    const docB = documentWith("tab-B-divergent");
    tabA.edit(docA);
    tabB.edit(docB);
    await tabA.flush();
    await tabB.flush();

    // Winner tabA syncs first (rev 1 -> 2), writing v2:synced and clearing ONLY tabA's draft
    await tabA.sync();
    expect(cloud.state.revision).toBe(2);

    // Verify tabB's draft is STILL intact in IDB before tabB even hits 409
    const midState = await loadMapState(owner, mapId);
    expect(midState.synced?.revision).toBe(2);
    expect(midState.drafts).toHaveLength(1);
    expect(midState.drafts[0].writerId).toBe(tabB.writerId);
    expect(midState.drafts[0].document).toEqual(docB);

    // Now tabB attempts sync -> hits 409 -> its draft MUST still be intact
    const tabBStatuses: SyncState[] = [];
    const tabB2Status = vi.fn((s: SyncState) => tabBStatuses.push(s));
    void tabB2Status;
    await tabB.sync();
    const after409 = await loadMapState(owner, mapId);
    expect(after409.drafts.some((d) => d.writerId === tabB.writerId && d.document.sheets[0].title === "tab-B-divergent")).toBe(true);

    tabA.close();
    tabB.close();

    // Fresh reload (tabC with new writerId) recovers tabB's divergent draft intact without deleting tabB's key
    const shownC = vi.fn();
    const tabC = new DraftWorkspace(owner, mapId, shownC, vi.fn(), vi.fn(), cloud.storage);
    await tabC.start();
    expect(shownC).toHaveBeenCalledWith(docB);
    expect(tabC.getOtherDrafts().length).toBeGreaterThanOrEqual(1);
    tabC.close();
  });

  it("advances causal watermark/baseRevision on gen1->r2 ack while preserving gen2 dirty content, prevents late flush regressions, and survives reload", async () => {
    const owner = "alice";
    const mapId = "22222222-2222-4222-8222-222222222222";
    const cloud = createV2CloudHarness(1, documentWith("v1"));
    const statuses: SyncState[] = [];
    const ws = new DraftWorkspace(owner, mapId, vi.fn(), (s) => statuses.push(s), vi.fn(), cloud.storage);
    await ws.start();

    // gen1 edit
    const gen1Doc = documentWith("gen1");
    ws.edit(gen1Doc);
    await ws.flush();

    // Start upload of gen1 (rev 1 -> 2), pause before server responds
    const upload1 = Promise.withResolvers<number>();
    cloud.writeCloud.mockReturnValueOnce(upload1.promise);
    const sync1 = ws.sync();

    // gen2 edit arrives AND flushes to IDB BEFORE gen1->r2 ack arrives!
    const gen2Doc = documentWith("gen2-newer");
    ws.edit(gen2Doc);
    await ws.flush();

    // Verify intermediate persisted state before ack: gen2 has baseRevision=1, ackedGen=0
    const beforeAck = await loadMapState(owner, mapId);
    expect(beforeAck.drafts).toHaveLength(1);
    expect(beforeAck.drafts[0].localGen).toBe(2);
    expect(beforeAck.drafts[0].baseRevision).toBe(1);
    expect(beforeAck.drafts[0].document).toEqual(gen2Doc);

    // Resolve gen1 -> r2
    cloud.setCloud(2, gen1Doc);
    upload1.resolve(2);
    await sync1;

    // Assert intermediate persisted state AFTER gen1->r2 ack:
    // v2:synced is r2, AND gen2 draft is preserved with baseRevision=2, ackedGen=1, content=gen2Doc!
    const afterAck = await loadMapState(owner, mapId);
    expect(afterAck.synced?.revision).toBe(2);
    expect(afterAck.drafts).toHaveLength(1);
    expect(afterAck.drafts[0].localGen).toBe(2);
    expect(afterAck.drafts[0].ackedGen).toBe(1);
    expect(afterAck.drafts[0].baseRevision).toBe(2);
    expect(afterAck.drafts[0].document).toEqual(gen2Doc);
    expect(statuses.at(-1)?.status).toBe("pending");

    // Late gen2(base=1) flush must NOT regress baseRevision back to 1
    const lateBaseFlush = await putDraftCas(owner, mapId, ws.writerId, {
      localGen: 2,
      ackedGen: 0,
      baseRevision: 1,
      document: gen2Doc,
    });
    expect(lateBaseFlush.written).toBe(true);
    expect(lateBaseFlush.record?.baseRevision).toBe(2);
    expect(lateBaseFlush.record?.ackedGen).toBe(1);

    // Late gen1 flush must be rejected (cannot overwrite gen2 or resurrect acked gen1)
    const lateGen1Flush = await putDraftCas(owner, mapId, ws.writerId, {
      localGen: 1,
      ackedGen: 0,
      baseRevision: 1,
      document: gen1Doc,
    });
    expect(lateGen1Flush.written).toBe(false);

    // Simulate reload/restart before gen2 syncs -> new DraftWorkspace recovers gen2 at baseRevision=2 and syncs to r3 without 409!
    ws.close();
    const reloadedStatuses: SyncState[] = [];
    const reloaded = new DraftWorkspace(owner, mapId, vi.fn(), (s) => reloadedStatuses.push(s), vi.fn(), cloud.storage);
    await reloaded.start();
    expect(cloud.state.revision).toBe(3);
    expect(cloud.state.document).toEqual(gen2Doc);
    expect(reloadedStatuses.at(-1)?.status).toBe("synced");

    // Out-of-order r2 ack after r3 must NOT regress v2:synced
    const ooo = await putSyncedCas(owner, mapId, { revision: 2, document: gen1Doc });
    expect(ooo.updated).toBe(false);
    expect(ooo.current.revision).toBe(3);

    // Late gen1 flush after draft cleared must not resurrect when ackedGen >= localGen
    const resurrect = await putDraftCas(owner, mapId, reloaded.writerId, {
      localGen: 1,
      ackedGen: 1,
      baseRevision: 2,
      document: gen1Doc,
    });
    expect(resurrect.written).toBe(false);
    reloaded.close();
  });

  it("aborts explicit discardDraftCas when another tab updated the draft", async () => {
    const owner = "alice";
    const mapId = "33333333-3333-4333-8333-333333333333";
    const writer = "writer-active";
    const doc1 = documentWith("v1");
    const doc2 = documentWith("v2-updated");
    await putDraftCas(owner, mapId, writer, { localGen: 1, ackedGen: 0, baseRevision: 1, document: doc1 });
    const fp1 = fingerprintDocument(doc1);

    // Active tab updates to gen 2 before user clicks discard
    await putDraftCas(owner, mapId, writer, { localGen: 2, ackedGen: 0, baseRevision: 1, document: doc2 });

    const res = await discardDraftCas(owner, mapId, writer, 1, fp1);
    expect(res.deleted).toBe(false);
    if (!res.deleted) expect(res.reason).toBe("changed");

    // Exact CAS succeeds
    const ok = await discardDraftCas(owner, mapId, writer, 2, fingerprintDocument(doc2));
    expect(ok.deleted).toBe(true);
  });

  it("handles remote_unavailable for both clean and dirty caches without false synced or 409 loop, and distinguishes offline", async () => {
    const owner = "alice";
    const mapId = "44444444-4444-4444-8444-444444444444";
    const cleanDoc = documentWith("cached-v3");
    await putSyncedCas(owner, mapId, { revision: 3, document: cleanDoc });

    // Cloud returns { revision: 0, document: null } (deleted or access revoked)
    const cloud = createV2CloudHarness(0, null);
    const statuses: SyncState[] = [];
    const wsClean = new DraftWorkspace(owner, mapId, vi.fn(), (s) => statuses.push(s), vi.fn(), cloud.storage);
    await wsClean.start();
    expect(statuses.at(-1)?.status).toBe("remote_unavailable");
    expect(statuses.at(-1)?.remoteUnavailable).toBe(true);
    expect(cloud.writeCloud).not.toHaveBeenCalled();

    // Clean cache is NOT auto-deleted
    const stillThere = await loadMapState(owner, mapId);
    expect(stillThere.synced?.document).toEqual(cleanDoc);

    // Save as new map creates fresh UUID at revision 0
    const newId = await wsClean.saveAsNewMap();
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(mapId);
    const newMapState = await loadMapState(owner, newId!);
    expect(newMapState.drafts[0].baseRevision).toBe(0);
    expect(newMapState.drafts[0].document).toEqual(cleanDoc);

    // Dirty cache on remote_unavailable breaks 409 loop & refuses removeCleanCache
    wsClean.edit(documentWith("dirty-on-unavailable"));
    await wsClean.flush();
    const removeBlocked = await wsClean.removeCleanCache();
    expect(removeBlocked).toEqual({ removed: false, reason: "has_pending_drafts" });
    wsClean.close();

    // Offline network error must NOT be treated as remote_unavailable
    const offlineStatuses: SyncState[] = [];
    cloud.readCloud.mockRejectedValueOnce(new CloudError(0, "offline"));
    const wsOffline = new DraftWorkspace(owner, mapId, vi.fn(), (s) => offlineStatuses.push(s), vi.fn(), cloud.storage);
    await wsOffline.start();
    expect(offlineStatuses.at(-1)?.status).toBe("unsynced");
    expect(offlineStatuses.at(-1)?.remoteUnavailable).toBeFalsy();
    wsOffline.close();
  });

  it("quarantines corrupt local records into v2:corrupt with raw JSON export and idempotent migration", async () => {
    const owner = "alice";
    const mapId = "55555555-5555-4555-8555-555555555555";
    const corruptRaw = { revision: 2, dirty: true, document: { format: "mindmap-document", version: 999, broken: true } };
    await rawPut(`google:${owner}:${mapId}`, corruptRaw);

    const cloud = createV2CloudHarness(0, null);
    const ws = new DraftWorkspace(owner, mapId, vi.fn(), vi.fn(), vi.fn(), cloud.storage);
    await ws.start();

    expect(ws.getCorruptRecords()).toHaveLength(1);
    const exported = ws.exportCorruptRecordJson(ws.getCorruptRecords()[0].corruptKey);
    expect(exported).toContain('"broken": true');

    // Reloading again must NOT duplicate corrupt record (idempotent v2:migrated marker)
    const state2 = await loadMapState(owner, mapId);
    expect(state2.corrupts).toHaveLength(1);

    // Explicit discard removes quarantined record and does not resurrect on reload
    await ws.discardCorrupt(ws.getCorruptRecords()[0].corruptKey);
    const state3 = await loadMapState(owner, mapId);
    expect(state3.corrupts).toHaveLength(0);
    ws.close();
  });

  it("rollback verification: legacy 7fc979c reader ignores v2:* safely AND standalone read-only script exports all records with zero writes", async () => {
    const owner = "alice";
    const mapId = "66666666-6666-4666-8666-666666666666";
    const legacyDoc = documentWith("legacy-map");
    const syncedDoc = documentWith("v2-synced-map");
    const draftDoc = documentWith("v2-draft-map");

    // Populate mixed IndexedDB with legacy + v2:synced + v2:draft + v2:corrupt + v2:migrated
    await rawPut(`google:${owner}:${mapId}`, { document: legacyDoc, revision: 1, dirty: false });
    await putSyncedCas(owner, mapId, { revision: 2, document: syncedDoc });
    await putDraftCas(owner, mapId, "writer-rollback", { localGen: 1, ackedGen: 0, baseRevision: 2, document: draftDoc });
    await rawPut(`google:${owner}:77777777-7777-4777-8777-777777777777`, { revision: 1, dirty: true, document: { bad: true } });
    await loadMapState(owner, "77777777-7777-4777-8777-777777777777"); // creates v2:corrupt + v2:migrated

    const snapshotBefore = await rawGetAll();

    // 1. Simulate main@7fc979c legacy listLocalMaps reader directly against mixed DB
    const legacyListed = await (async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        return await new Promise<Array<{ id: string; title: string }>>((resolve, reject) => {
          const store = db.transaction(STORE_NAME).objectStore(STORE_NAME);
          const maps: Array<{ id: string; title: string }> = [];
          const request = store.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(maps); return; }
            const key = String(cursor.key);
            const id = key.startsWith(`google:${owner}:`) ? key.slice(`google:${owner}:`.length) : "";
            if (MAP_ID.test(id) && (!cursor.value?.access || cursor.value.access === "owner")) {
              const parsed = MindmapDocumentSchema.safeParse(cursor.value?.document);
              if (parsed.success) maps.push({ id, title: mapTitle(parsed.data) });
            }
            cursor.continue();
          };
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    })();

    // Legacy reader does not crash and ONLY sees the valid legacy google:* map — NEVER any v2:* record
    expect(legacyListed).toEqual([{ id: mapId, title: "legacy-map" }]);

    // 2. Execute standalone zero-dependency read-only script from disk (no T1 app/UI imports)
    const scriptPath = fileURLToPath(new URL("../../../docs/recovery/loomind-idb-readonly-recovery.js", import.meta.url));
    const scriptSource = readFileSync(scriptPath, "utf8");
    const sandboxGlobal: Record<string, unknown> = { indexedDB };
    new Function("window", "globalThis", scriptSource)(sandboxGlobal, sandboxGlobal);
    const recoverFn = sandboxGlobal.__loomindReadOnlyRecover as (opts?: Record<string, unknown>) => Promise<{
      schema: string;
      counts: { draft: number; synced: number; corrupt: number; migrated: number; legacy: number };
      records: {
        draft: Array<{ key: string; value: { document: MindmapDocument } }>;
        synced: Array<{ key: string; value: { document: MindmapDocument } }>;
        corrupt: Array<{ key: string; value: { raw: unknown } }>;
        migrated: Array<{ key: string; value: unknown }>;
        legacy: Array<{ key: string; value: unknown }>;
      };
    }>;

    // Spy on IDBDatabase.prototype.transaction to guarantee ONLY "readonly" mode is ever used
    const txModes: string[] = [];
    const origTx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (storeNames: string | Iterable<string>, mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      txModes.push(mode ?? "readonly");
      return origTx.call(this, storeNames, mode, options);
    };
    let dump;
    try {
      dump = await recoverFn({ autoDownload: false, indexedDB });
    } finally {
      IDBDatabase.prototype.transaction = origTx;
    }

    expect(txModes.length).toBeGreaterThan(0);
    expect(txModes.every((m) => m === "readonly")).toBe(true);
    expect(dump.schema).toBe("loomind-readonly-recovery-v1");
    expect(dump.counts.draft).toBe(1);
    expect(dump.counts.synced).toBe(1);
    expect(dump.counts.corrupt).toBe(1);
    expect(dump.counts.migrated).toBe(1);
    expect(dump.counts.legacy).toBe(2);
    expect(dump.records.draft[0].key).toBe(v2DraftKey(owner, mapId, "writer-rollback"));
    expect(dump.records.draft[0].value.document).toEqual(draftDoc);
    expect(dump.records.synced[0].key).toBe(v2SyncedKey(owner, mapId));
    expect(dump.records.corrupt[0].value.raw).toEqual({ revision: 1, dirty: true, document: { bad: true } });

    // IndexedDB is 100% unchanged (zero writes, zero deletes)
    const snapshotAfter = await rawGetAll();
    expect(snapshotAfter).toEqual(snapshotBefore);
  });
});
