import { canonicalJson, MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core";
import type { DraftHistory, LocalDraft, MapAccess, MindmapSummary } from "./drafts/shared.js";
import { MAP_ID, mapTitle } from "./drafts/shared.js";

export const DB_NAME = "loomind-db";
export const STORE_NAME = "docs";

export interface V2SyncedRecord {
  schema: 2;
  kind: "synced";
  owner: string;
  mapId: string;
  revision: number;
  document: MindmapDocument;
  workspaceId?: string | null;
  access?: MapAccess;
  updatedAt: number;
}

export interface V2DraftRecord {
  schema: 2;
  kind: "draft";
  owner: string;
  mapId: string;
  writerId: string;
  localGen: number;
  ackedGen: number;
  baseRevision: number;
  document: MindmapDocument;
  fingerprint: string;
  history?: DraftHistory;
  workspaceId?: string | null;
  access?: MapAccess;
  updatedAt: number;
}

export interface V2CorruptRecord {
  schema: 2;
  kind: "corrupt";
  owner: string;
  mapId: string;
  corruptKey: string;
  sourceKey: string;
  sourceFingerprint: string;
  raw: unknown;
  error: string;
  capturedAt: number;
}

export interface V2MigratedRecord {
  schema: 2;
  kind: "migrated";
  owner: string;
  mapId: string;
  sourceKey: string;
  sourceFingerprint: string;
  migratedAt: number;
}

export interface LoadedMapState {
  synced: V2SyncedRecord | null;
  drafts: V2DraftRecord[];
  corrupts: V2CorruptRecord[];
  legacy: { sourceKey: string; sourceFingerprint: string; draft: LocalDraft } | null;
}

export interface PutDraftCasInput {
  localGen: number;
  ackedGen: number;
  baseRevision: number;
  document: MindmapDocument;
  history?: DraftHistory;
  workspaceId?: string | null;
  access?: MapAccess;
}

export interface ConfirmUploadCasInput {
  sentGen: number;
  newRevision: number;
  document: MindmapDocument;
  workspaceId?: string | null;
  access?: MapAccess;
}

export interface ConfirmUploadCasResult {
  draftCleared: boolean;
  preservedNewerDraft: boolean;
  syncedRevision: number;
}

export type DiscardDraftCasResult =
  | { deleted: true }
  | { deleted: false; reason: "missing" }
  | { deleted: false; reason: "changed"; current: V2DraftRecord };

export type RemoveCleanSyncedResult =
  | { removed: true }
  | { removed: false; reason: "has_pending_drafts" };

function enc(part: string): string {
  return encodeURIComponent(part);
}

export function legacyDocumentKey(owner: string | null, id?: string): string {
  return owner === null ? "active-document" : `google:${owner}:${id ?? "active-document"}`;
}

export function v2SyncedKey(owner: string, mapId: string): string {
  return `v2:synced:${enc(owner)}:${enc(mapId)}`;
}

export function v2DraftKey(owner: string, mapId: string, writerId: string): string {
  return `v2:draft:${enc(owner)}:${enc(mapId)}:${enc(writerId)}`;
}

export function v2DraftPrefix(owner: string, mapId: string): string {
  return `v2:draft:${enc(owner)}:${enc(mapId)}:`;
}

export function v2CorruptKey(owner: string, mapId: string, sourceKey: string, sourceFingerprint: string): string {
  return `v2:corrupt:${enc(owner)}:${enc(mapId)}:${enc(sourceKey)}:${enc(sourceFingerprint)}`;
}

export function v2CorruptPrefix(owner: string, mapId: string): string {
  return `v2:corrupt:${enc(owner)}:${enc(mapId)}:`;
}

export function v2MigratedKey(owner: string, sourceKey: string, sourceFingerprint: string): string {
  return `v2:migrated:${enc(owner)}:${enc(sourceKey)}:${enc(sourceFingerprint)}`;
}

/**
 * Synchronous deterministic fingerprint (2x32-bit FNV-1a) safe to run inside
 * IndexedDB transactions without yielding to microtasks.
 */
export function fingerprintString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function fingerprintDocument(doc: MindmapDocument): string {
  return fingerprintString(canonicalJson(doc));
}

export function fingerprintRaw(raw: unknown): string {
  try {
    return fingerprintString(JSON.stringify(raw) ?? String(raw));
  } catch {
    return fingerprintString(String(raw));
  }
}

let connection: Promise<IDBDatabase> | undefined;

export function resetDbConnectionForTest(): void {
  connection = undefined;
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDraftHistory(value: unknown): value is DraftHistory {
  return isObject(value) && typeof value.room === "string" && MAP_ID.test(value.room) && value.snapshot instanceof Uint8Array;
}

function parseV2Synced(value: unknown, expectedOwner: string, expectedMapId: string): V2SyncedRecord | null {
  if (!isObject(value)) return null;
  if (value.schema !== 2 || value.kind !== "synced") return null;
  if (value.owner !== expectedOwner || value.mapId !== expectedMapId) return null;
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) return null;
  const parsed = MindmapDocumentSchema.safeParse(value.document);
  if (!parsed.success) return null;
  return {
    schema: 2,
    kind: "synced",
    owner: expectedOwner,
    mapId: expectedMapId,
    revision: value.revision,
    document: parsed.data,
    workspaceId: typeof value.workspaceId === "string" || value.workspaceId === null ? value.workspaceId : undefined,
    access: value.access === "owner" || value.access === "editor" || value.access === "viewer" ? value.access : undefined,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

function parseV2Draft(value: unknown, expectedOwner: string, expectedMapId: string): V2DraftRecord | null {
  if (!isObject(value)) return null;
  if (value.schema !== 2 || value.kind !== "draft") return null;
  if (value.owner !== expectedOwner || value.mapId !== expectedMapId) return null;
  if (typeof value.writerId !== "string" || !value.writerId) return null;
  if (typeof value.localGen !== "number" || !Number.isSafeInteger(value.localGen) || value.localGen < 0) return null;
  if (typeof value.ackedGen !== "number" || !Number.isSafeInteger(value.ackedGen) || value.ackedGen < 0) return null;
  if (typeof value.baseRevision !== "number" || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0) return null;
  const history = value.history;
  if (history !== undefined && !isDraftHistory(history)) return null;
  const parsed = MindmapDocumentSchema.safeParse(value.document);
  if (!parsed.success) return null;
  const fingerprint = typeof value.fingerprint === "string" && value.fingerprint
    ? value.fingerprint
    : fingerprintDocument(parsed.data);
  return {
    schema: 2,
    kind: "draft",
    owner: expectedOwner,
    mapId: expectedMapId,
    writerId: value.writerId,
    localGen: value.localGen,
    ackedGen: value.ackedGen,
    baseRevision: value.baseRevision,
    document: parsed.data,
    ...(history && { history }),
    fingerprint,
    workspaceId: typeof value.workspaceId === "string" || value.workspaceId === null ? value.workspaceId : undefined,
    access: value.access === "owner" || value.access === "editor" || value.access === "viewer" ? value.access : undefined,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

function parseV2Corrupt(value: unknown, expectedOwner: string, expectedMapId: string, key: string): V2CorruptRecord | null {
  if (!isObject(value)) return null;
  if (value.schema !== 2 || value.kind !== "corrupt") return null;
  if (value.owner !== expectedOwner || value.mapId !== expectedMapId) return null;
  if (typeof value.sourceKey !== "string" || typeof value.sourceFingerprint !== "string") return null;
  return {
    schema: 2,
    kind: "corrupt",
    owner: expectedOwner,
    mapId: expectedMapId,
    corruptKey: key,
    sourceKey: value.sourceKey,
    sourceFingerprint: value.sourceFingerprint,
    raw: value.raw,
    error: typeof value.error === "string" ? value.error : "Invalid local record",
    capturedAt: typeof value.capturedAt === "number" ? value.capturedAt : 0,
  };
}

function parseLegacyDraft(owner: string | null, saved: unknown): { ok: true; draft: LocalDraft } | { ok: false; error: string } {
  if (owner && isObject(saved) && typeof saved.revision === "number" && Number.isSafeInteger(saved.revision) && saved.revision >= 0 && typeof saved.dirty === "boolean") {
    const parsed = MindmapDocumentSchema.safeParse(saved.document);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    return {
      ok: true,
      draft: {
        document: parsed.data,
        revision: saved.revision,
        dirty: saved.dirty,
        workspaceId: typeof saved.workspaceId === "string" || saved.workspaceId === null ? saved.workspaceId : undefined,
        access: saved.access === "owner" || saved.access === "editor" || saved.access === "viewer" ? saved.access : undefined,
      },
    };
  }
  const parsed = MindmapDocumentSchema.safeParse(saved);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, draft: { document: parsed.data, revision: 0, dirty: owner !== null } };
}

export async function loadMapState(owner: string, mapId: string): Promise<LoadedMapState> {
  const db = await openDb();
  const syncedK = v2SyncedKey(owner, mapId);
  const draftPref = v2DraftPrefix(owner, mapId);
  const corruptPref = v2CorruptPrefix(owner, mapId);
  const legacyK = legacyDocumentKey(owner, mapId);

  const rawEntries: Array<{ key: string; value: unknown }> = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const items: Array<{ key: string; value: unknown }> = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(items); return; }
      const key = String(cursor.key);
      if (
        key === syncedK ||
        key === legacyK ||
        key.startsWith(draftPref) ||
        key.startsWith(corruptPref) ||
        key.startsWith(`v2:migrated:${enc(owner)}:`)
      ) {
        items.push({ key, value: cursor.value });
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  const migratedKeys = new Set<string>();
  for (const entry of rawEntries) {
    if (entry.key.startsWith(`v2:migrated:${enc(owner)}:`) && isObject(entry.value) && entry.value.schema === 2 && entry.value.kind === "migrated") {
      migratedKeys.add(entry.key);
    }
  }

  let synced: V2SyncedRecord | null = null;
  const drafts: V2DraftRecord[] = [];
  const corrupts: V2CorruptRecord[] = [];
  const toQuarantine: Array<{ sourceKey: string; sourceFingerprint: string; raw: unknown; error: string }> = [];
  let legacy: LoadedMapState["legacy"] = null;

  for (const entry of rawEntries) {
    if (entry.key === syncedK) {
      const parsed = parseV2Synced(entry.value, owner, mapId);
      if (parsed) {
        synced = parsed;
      } else {
        const fp = fingerprintRaw(entry.value);
        const mKey = v2MigratedKey(owner, entry.key, fp);
        if (!migratedKeys.has(mKey)) {
          toQuarantine.push({ sourceKey: entry.key, sourceFingerprint: fp, raw: entry.value, error: "Invalid v2:synced record" });
        }
      }
    } else if (entry.key.startsWith(draftPref)) {
      const parsed = parseV2Draft(entry.value, owner, mapId);
      if (parsed) {
        drafts.push(parsed);
      } else {
        const fp = fingerprintRaw(entry.value);
        const mKey = v2MigratedKey(owner, entry.key, fp);
        if (!migratedKeys.has(mKey)) {
          toQuarantine.push({ sourceKey: entry.key, sourceFingerprint: fp, raw: entry.value, error: "Invalid v2:draft record" });
        }
      }
    } else if (entry.key.startsWith(corruptPref)) {
      const parsed = parseV2Corrupt(entry.value, owner, mapId, entry.key);
      if (parsed) corrupts.push(parsed);
    } else if (entry.key === legacyK) {
      const fp = fingerprintRaw(entry.value);
      const mKey = v2MigratedKey(owner, entry.key, fp);
      if (!migratedKeys.has(mKey)) {
        const parsed = parseLegacyDraft(owner, entry.value);
        if (parsed.ok) {
          legacy = { sourceKey: entry.key, sourceFingerprint: fp, draft: parsed.draft };
        } else {
          toQuarantine.push({ sourceKey: entry.key, sourceFingerprint: fp, raw: entry.value, error: parsed.error });
        }
      }
    }
  }

  if (toQuarantine.length > 0) {
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const item of toQuarantine) {
        const cKey = v2CorruptKey(owner, mapId, item.sourceKey, item.sourceFingerprint);
        const mKey = v2MigratedKey(owner, item.sourceKey, item.sourceFingerprint);
        const corruptRec: V2CorruptRecord = {
          schema: 2,
          kind: "corrupt",
          owner,
          mapId,
          corruptKey: cKey,
          sourceKey: item.sourceKey,
          sourceFingerprint: item.sourceFingerprint,
          raw: item.raw,
          error: item.error,
          capturedAt: now,
        };
        const migratedRec: V2MigratedRecord = {
          schema: 2,
          kind: "migrated",
          owner,
          mapId,
          sourceKey: item.sourceKey,
          sourceFingerprint: item.sourceFingerprint,
          migratedAt: now,
        };
        store.put(corruptRec, cKey);
        store.put(migratedRec, mKey);
        corrupts.push(corruptRec);
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("本机隔离坏记录失败。"));
    });
  }

  drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  corrupts.sort((a, b) => b.capturedAt - a.capturedAt);
  return { synced, drafts, corrupts, legacy };
}

export async function markMigrated(
  owner: string,
  mapId: string,
  sourceKey: string,
  sourceFingerprint: string,
): Promise<void> {
  const db = await openDb();
  const key = v2MigratedKey(owner, sourceKey, sourceFingerprint);
  const record: V2MigratedRecord = {
    schema: 2,
    kind: "migrated",
    owner,
    mapId,
    sourceKey,
    sourceFingerprint,
    migratedAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("本机迁移标记写入失败。"));
  });
}

export async function putSyncedCas(
  owner: string,
  mapId: string,
  input: { revision: number; document: MindmapDocument; workspaceId?: string | null; access?: MapAccess },
): Promise<{ updated: boolean; current: V2SyncedRecord }> {
  const db = await openDb();
  const key = v2SyncedKey(owner, mapId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    let result: { updated: boolean; current: V2SyncedRecord } | undefined;
    getReq.onsuccess = () => {
      const existing = parseV2Synced(getReq.result, owner, mapId);
      if (existing && existing.revision >= input.revision) {
        result = { updated: false, current: existing };
        return;
      }
      const next: V2SyncedRecord = {
        schema: 2,
        kind: "synced",
        owner,
        mapId,
        revision: input.revision,
        document: input.document,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : existing?.workspaceId !== undefined ? { workspaceId: existing.workspaceId } : {}),
        ...(input.access !== undefined ? { access: input.access } : existing?.access !== undefined ? { access: existing.access } : {}),
        updatedAt: Date.now(),
      };
      store.put(next, key);
      result = { updated: true, current: next };
    };
    tx.oncomplete = () => resolve(result!);
    tx.onabort = () => reject(tx.error ?? new Error("本机云端快照保存失败。"));
  });
}

export async function putDraftCas(
  owner: string,
  mapId: string,
  writerId: string,
  input: PutDraftCasInput,
): Promise<{ written: boolean; record: V2DraftRecord | null }> {
  const db = await openDb();
  const key = v2DraftKey(owner, mapId, writerId);
  const fingerprint = fingerprintDocument(input.document);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    let result: { written: boolean; record: V2DraftRecord | null } = { written: false, record: null };
    getReq.onsuccess = () => {
      const existing = parseV2Draft(getReq.result, owner, mapId);
      const effectiveAckedGen = Math.max(input.ackedGen, existing?.ackedGen ?? 0);
      // Reject late flush of an already-acked gen or older gen than stored
      if (input.localGen <= effectiveAckedGen) {
        result = { written: false, record: existing };
        return;
      }
      if (existing && input.localGen < existing.localGen) {
        result = { written: false, record: existing };
        return;
      }
      const next: V2DraftRecord = {
        schema: 2,
        kind: "draft",
        owner,
        mapId,
        writerId,
        localGen: input.localGen,
        ackedGen: effectiveAckedGen,
        baseRevision: Math.max(input.baseRevision, existing?.baseRevision ?? 0),
        document: input.document,
        ...(input.history && { history: input.history }),
        fingerprint,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : existing?.workspaceId !== undefined ? { workspaceId: existing.workspaceId } : {}),
        ...(input.access !== undefined ? { access: input.access } : existing?.access !== undefined ? { access: existing.access } : {}),
        updatedAt: Date.now(),
      };
      store.put(next, key);
      result = { written: true, record: next };
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error("本机草稿保存失败。"));
  });
}

export async function confirmUploadCas(
  owner: string,
  mapId: string,
  writerId: string,
  input: ConfirmUploadCasInput,
): Promise<ConfirmUploadCasResult> {
  const db = await openDb();
  const sKey = v2SyncedKey(owner, mapId);
  const dKey = v2DraftKey(owner, mapId, writerId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let existingSynced: V2SyncedRecord | null = null;
    let existingDraft: V2DraftRecord | null = null;
    let doneCount = 0;
    let result: ConfirmUploadCasResult = {
      draftCleared: false,
      preservedNewerDraft: false,
      syncedRevision: input.newRevision,
    };

    const finish = () => {
      const syncedRevision = Math.max(existingSynced?.revision ?? 0, input.newRevision);
      if (!existingSynced || existingSynced.revision < input.newRevision) {
        const nextSynced: V2SyncedRecord = {
          schema: 2,
          kind: "synced",
          owner,
          mapId,
          revision: input.newRevision,
          document: input.document,
          workspaceId: input.workspaceId ?? existingSynced?.workspaceId ?? null,
          access: input.access ?? existingSynced?.access ?? "owner",
          updatedAt: Date.now(),
        };
        store.put(nextSynced, sKey);
      }

      if (existingDraft && existingDraft.localGen > input.sentGen) {
        // Step A only: advance causal watermark/baseRevision on newer draft while preserving its dirty content
        const updatedDraft: V2DraftRecord = {
          ...existingDraft,
          ackedGen: Math.max(existingDraft.ackedGen, input.sentGen),
          baseRevision: Math.max(existingDraft.baseRevision, input.newRevision),
          updatedAt: Date.now(),
        };
        store.put(updatedDraft, dKey);
        result = { draftCleared: false, preservedNewerDraft: true, syncedRevision };
      } else {
        // Step B: no newer local edit in store -> clear this writer's draft
        store.delete(dKey);
        result = { draftCleared: true, preservedNewerDraft: false, syncedRevision };
      }
    };

    const sReq = store.get(sKey);
    sReq.onsuccess = () => {
      existingSynced = parseV2Synced(sReq.result, owner, mapId);
      doneCount += 1;
      if (doneCount === 2) finish();
    };
    const dReq = store.get(dKey);
    dReq.onsuccess = () => {
      existingDraft = parseV2Draft(dReq.result, owner, mapId);
      doneCount += 1;
      if (doneCount === 2) finish();
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error("本机确认同步状态失败。"));
  });
}

export async function discardDraftCas(
  owner: string,
  mapId: string,
  writerId: string,
  expectedLocalGen: number,
  expectedFingerprint: string,
): Promise<DiscardDraftCasResult> {
  const db = await openDb();
  const key = v2DraftKey(owner, mapId, writerId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    let result: DiscardDraftCasResult = { deleted: false, reason: "missing" };
    getReq.onsuccess = () => {
      const existing = parseV2Draft(getReq.result, owner, mapId);
      if (!existing) {
        result = { deleted: false, reason: "missing" };
        return;
      }
      if (existing.localGen !== expectedLocalGen || existing.fingerprint !== expectedFingerprint) {
        result = { deleted: false, reason: "changed", current: existing };
        return;
      }
      store.delete(key);
      result = { deleted: true };
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error("放弃草稿失败。"));
  });
}

export async function removeCleanSyncedCas(owner: string, mapId: string): Promise<RemoveCleanSyncedResult> {
  const db = await openDb();
  const sKey = v2SyncedKey(owner, mapId);
  const dPref = v2DraftPrefix(owner, mapId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let hasPending = false;
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        if (!hasPending) store.delete(sKey);
        return;
      }
      const key = String(cursor.key);
      if (key.startsWith(dPref) && parseV2Draft(cursor.value, owner, mapId)) {
        hasPending = true;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(hasPending ? { removed: false, reason: "has_pending_drafts" } : { removed: true });
    tx.onabort = () => reject(tx.error ?? new Error("清理本机缓存失败。"));
  });
}

export async function discardCorruptRecord(corruptKey: string): Promise<void> {
  if (!corruptKey.startsWith("v2:corrupt:")) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(corruptKey);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("删除损坏记录失败。"));
  });
}

export async function loadLocal(owner: string | null, id?: string): Promise<LocalDraft | null> {
  const db = await openDb();
  if (owner && id) {
    const state = await loadMapState(owner, id);
    if (state.drafts.length > 0) {
      const d = state.drafts[0];
      return {
        document: d.document,
        revision: d.baseRevision,
        dirty: true,
        ...(d.workspaceId !== undefined ? { workspaceId: d.workspaceId } : {}),
        ...(d.access !== undefined ? { access: d.access } : {}),
      };
    }
    if (state.synced) {
      return {
        document: state.synced.document,
        revision: state.synced.revision,
        dirty: false,
        ...(state.synced.workspaceId !== undefined ? { workspaceId: state.synced.workspaceId } : {}),
        ...(state.synced.access !== undefined ? { access: state.synced.access } : {}),
      };
    }
    if (state.legacy) {
      return state.legacy.draft;
    }
    return null;
  }
  const saved = await new Promise<unknown>((resolve, reject) => {
    const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(legacyDocumentKey(owner, id));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (saved === undefined) return null;
  const parsed = parseLegacyDraft(owner, saved);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.draft;
}

export async function saveLocal(owner: string | null, draft: LocalDraft, id?: string): Promise<void> {
  const db = await openDb();
  if (owner === null) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(draft.document, legacyDocumentKey(null));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("本机存储失败。"));
    });
    return;
  }
  if (id) {
    if (!draft.dirty && draft.revision > 0) {
      await putSyncedCas(owner, id, {
        revision: draft.revision,
        document: draft.document,
        workspaceId: draft.workspaceId,
        access: draft.access,
      });
    } else {
      const writerId = crypto.randomUUID();
      await putDraftCas(owner, id, writerId, {
        localGen: 1,
        ackedGen: 0,
        baseRevision: draft.revision,
        document: draft.document,
        workspaceId: draft.workspaceId,
        access: draft.access,
      });
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(draft, legacyDocumentKey(owner, id));
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("本机存储失败。"));
  });
}

export async function listLocalMaps(owner: string): Promise<MindmapSummary[]> {
  const db = await openDb();
  const syncedPref = `v2:synced:${enc(owner)}:`;
  const draftPref = `v2:draft:${enc(owner)}:`;
  const migratedPref = `v2:migrated:${enc(owner)}:`;
  const legacyPref = `google:${owner}:`;

  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const byId = new Map<string, MindmapSummary & { _priority: number }>();
    const migratedKeys = new Set<string>();
    const legacyCandidates: Array<{ key: string; id: string; value: unknown }> = [];

    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        for (const item of legacyCandidates) {
          const fp = fingerprintRaw(item.value);
          if (migratedKeys.has(v2MigratedKey(owner, item.key, fp))) continue;
          if (byId.has(item.id)) continue;
          const val = item.value as Record<string, unknown> | null;
          if (val && (!val.access || val.access === "owner")) {
            const parsed = MindmapDocumentSchema.safeParse(val.document);
            if (parsed.success) {
              byId.set(item.id, {
                id: item.id,
                title: mapTitle(parsed.data),
                updatedAt: "",
                workspaceId: typeof val.workspaceId === "string" ? val.workspaceId : null,
                access: "owner",
                hasPendingDraft: Boolean(val.dirty),
                _priority: 1,
              });
            }
          }
        }
        resolve(Array.from(byId.values()).map(({ _priority: _, ...summary }) => summary));
        return;
      }

      const key = String(cursor.key);
      if (key.startsWith(migratedPref)) {
        migratedKeys.add(key);
      } else if (key.startsWith(syncedPref)) {
        const id = decodeURIComponent(key.slice(syncedPref.length));
        if (MAP_ID.test(id)) {
          const rec = parseV2Synced(cursor.value, owner, id);
          if (rec && (!rec.access || rec.access === "owner")) {
            const existing = byId.get(id);
            if (!existing || existing._priority < 2) {
              byId.set(id, {
                id,
                title: mapTitle(rec.document),
                updatedAt: "",
                workspaceId: rec.workspaceId ?? null,
                access: "owner",
                hasPendingDraft: existing?.hasPendingDraft ?? false,
                _priority: 2,
              });
            }
          }
        }
      } else if (key.startsWith(draftPref)) {
        const rest = key.slice(draftPref.length);
        const sep = rest.indexOf(":");
        if (sep > 0) {
          const id = decodeURIComponent(rest.slice(0, sep));
          if (MAP_ID.test(id)) {
            const rec = parseV2Draft(cursor.value, owner, id);
            if (rec && (!rec.access || rec.access === "owner")) {
              byId.set(id, {
                id,
                title: mapTitle(rec.document),
                updatedAt: "",
                workspaceId: rec.workspaceId ?? null,
                access: "owner",
                hasPendingDraft: true,
                _priority: 3,
              });
            }
          }
        }
      } else if (key.startsWith(legacyPref)) {
        const id = key.slice(legacyPref.length);
        if (MAP_ID.test(id)) {
          legacyCandidates.push({ key, id, value: cursor.value });
        }
      }

      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteLocal(owner: string, id: string): Promise<void> {
  const db = await openDb();
  const sKey = v2SyncedKey(owner, id);
  const dPref = v2DraftPrefix(owner, id);
  const legacyK = legacyDocumentKey(owner, id);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(sKey);
    store.delete(legacyK);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if (key.startsWith(dPref)) store.delete(cursor.key);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("本机导图删除失败。"));
  });
}
