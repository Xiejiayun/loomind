import { MindmapDocumentSchema } from "@mindmap/core/model";
import type { LocalDraft } from "./drafts/shared.js";
import { MAP_ID, mapTitle, type MindmapSummary } from "./drafts/shared.js";

const DB_NAME = "loomind-db";
const STORE_NAME = "docs";
function documentKey(owner: string | null, id?: string) {
  return owner === null ? "active-document" : `google:${owner}:${id ?? "active-document"}`;
}

let connection: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); connection = undefined; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  }).catch((error) => { connection = undefined; throw error; });
}

export async function loadLocal(owner: string | null, id?: string): Promise<LocalDraft | null> {
  const db = await openDb();
  const saved = await new Promise<LocalDraft | undefined>((resolve, reject) => {
    const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(documentKey(owner, id));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (saved === undefined) return null;
  if (owner && saved && Number.isSafeInteger(saved.revision) && saved.revision >= 0 && typeof saved.dirty === "boolean") {
    MindmapDocumentSchema.parse(saved.document);
    return saved;
  }
  return { document: MindmapDocumentSchema.parse(saved), revision: 0, dirty: owner !== null };
}

export async function saveLocal(owner: string | null, draft: LocalDraft, id?: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(owner === null ? draft.document : draft, documentKey(owner, id));
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("本机存储失败。"));
  });
}

export async function listLocalMaps(owner: string): Promise<MindmapSummary[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_NAME).objectStore(STORE_NAME);
    const maps: MindmapSummary[] = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(maps); return; }
      const key = String(cursor.key);
      const id = key.startsWith(`google:${owner}:`) ? key.slice(`google:${owner}:`.length) : "";
      if (MAP_ID.test(id)) {
        const parsed = MindmapDocumentSchema.safeParse(cursor.value?.document);
        if (parsed.success) maps.push({ id, title: mapTitle(parsed.data), updatedAt: "" });
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
