import { canonicalJson, getTemplate, type MindmapDocument } from "@mindmap/core";
import { getWebMessages } from "../i18n.js";
import {
  confirmUploadCas,
  discardCorruptRecord,
  discardDraftCas,
  loadLocal,
  loadMapState,
  markMigrated,
  putDraftCas,
  putSyncedCas,
  removeCleanSyncedCas,
  saveLocal,
  type ConfirmUploadCasInput,
  type ConfirmUploadCasResult,
  type DiscardDraftCasResult,
  type LoadedMapState,
  type PutDraftCasInput,
  type RemoveCleanSyncedResult,
  type V2CorruptRecord,
  type V2DraftRecord,
  type V2SyncedRecord,
} from "../persistence.js";
import { documentFromTopic } from "../outline.js";
import { CloudError, readCloud, writeCloud } from "./cloud.js";
import type { CloudDraft, LocalDraft, MapAccess } from "./shared.js";

export type SyncStatus =
  | "connecting"
  | "conflict"
  | "pending"
  | "synced"
  | "syncing"
  | "ready"
  | "unsynced"
  | "remote_unavailable";

export interface SyncState {
  label: string;
  detail: string;
  conflict?: boolean;
  remoteUnavailable?: boolean;
  corruptCount?: number;
  otherDraftCount?: number;
  status?: SyncStatus;
}

export interface WorkspaceStorage {
  loadLocal: (owner: string | null, id?: string) => Promise<LocalDraft | null>;
  saveLocal: (owner: string | null, draft: LocalDraft, id?: string) => Promise<void>;
  readCloud: (owner: string, id: string) => Promise<CloudDraft>;
  writeCloud: (owner: string, id: string, revision: number, document: MindmapDocument, workspaceId?: string | null) => Promise<number>;
  loadMapState?: (owner: string, mapId: string) => Promise<LoadedMapState>;
  putSyncedCas?: (
    owner: string,
    mapId: string,
    input: { revision: number; document: MindmapDocument; workspaceId?: string | null; access?: MapAccess },
  ) => Promise<{ updated: boolean; current: V2SyncedRecord }>;
  putDraftCas?: (
    owner: string,
    mapId: string,
    writerId: string,
    input: PutDraftCasInput,
  ) => Promise<{ written: boolean; record: V2DraftRecord | null }>;
  confirmUploadCas?: (
    owner: string,
    mapId: string,
    writerId: string,
    input: ConfirmUploadCasInput,
  ) => Promise<ConfirmUploadCasResult>;
  discardDraftCas?: (
    owner: string,
    mapId: string,
    writerId: string,
    expectedLocalGen: number,
    expectedFingerprint: string,
  ) => Promise<DiscardDraftCasResult>;
  removeCleanSyncedCas?: (owner: string, mapId: string) => Promise<RemoveCleanSyncedResult>;
  discardCorruptRecord?: (corruptKey: string) => Promise<void>;
  markMigrated?: (owner: string, mapId: string, sourceKey: string, sourceFingerprint: string) => Promise<void>;
}

const DEFAULT_STORAGE: WorkspaceStorage = {
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
};

function syncMessages() {
  return getWebMessages().sync;
}

function deduplicateDrafts(drafts: V2DraftRecord[]): V2DraftRecord[] {
  const seen = new Set<string>();
  const out: V2DraftRecord[] = [];
  for (const d of drafts) {
    if (seen.has(d.fingerprint)) continue;
    seen.add(d.fingerprint);
    out.push(d);
  }
  return out;
}

export class DraftWorkspace {
  readonly writerId = crypto.randomUUID();

  private draft?: LocalDraft;
  private closed = false;
  private cacheReadable = true;
  private needsLocalSave = false;
  private pullingRequired = true;
  private running = false;
  private conflicted = false;
  private remoteUnavailable = false;
  private hasBeenSyncedToCloud = false;
  private localGen = 0;
  private ackedGen = 0;
  private confirmedBaseRevision = 0;
  private otherDrafts: V2DraftRecord[] = [];
  private corruptRecords: V2CorruptRecord[] = [];
  private localTimer?: ReturnType<typeof setTimeout>;
  private cloudTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private owner: string | null,
    private id: string | null,
    private show: (document: MindmapDocument) => void,
    private status: (state: SyncState) => void,
    private localError: (message: string) => void,
    private storage: WorkspaceStorage = DEFAULT_STORAGE,
    private workspaceId?: string | null,
    private access?: MapAccess,
  ) {}

  private usesV2(): boolean {
    return Boolean(
      this.owner &&
        this.id &&
        this.storage.loadMapState &&
        this.storage.putSyncedCas &&
        this.storage.putDraftCas &&
        this.storage.confirmUploadCas,
    );
  }

  private emitStatus(base: SyncState) {
    if (this.closed) return;
    this.status({
      ...base,
      corruptCount: this.corruptRecords.length,
      otherDraftCount: this.otherDrafts.length,
    });
  }

  private conflictState(): SyncState {
    const s = syncMessages();
    return { label: s.conflictLabel, detail: s.conflictDetail, conflict: true, status: "conflict" };
  }

  private pendingState(): SyncState {
    const s = syncMessages();
    return { label: s.pendingLabel, detail: s.pendingDetail, status: "pending" };
  }

  private syncedState(): SyncState {
    const s = syncMessages();
    return { label: s.syncedLabel, detail: s.syncedDetail, status: "synced" };
  }

  private remoteUnavailableState(): SyncState {
    const s = syncMessages();
    return {
      label: s.remoteUnavailableLabel,
      detail: s.remoteUnavailableDetail,
      remoteUnavailable: true,
      status: "remote_unavailable",
    };
  }

  private withScope(draft: LocalDraft): LocalDraft {
    if (this.workspaceId === undefined && this.access === undefined) return draft;
    return {
      ...draft,
      workspaceId: this.workspaceId ?? draft.workspaceId ?? null,
      access: this.access ?? draft.access ?? "owner",
    };
  }

  getCorruptRecords(): readonly V2CorruptRecord[] {
    return this.corruptRecords;
  }

  getOtherDrafts(): readonly V2DraftRecord[] {
    return this.otherDrafts;
  }

  exportCurrentJson(): string | null {
    if (!this.draft) return null;
    return JSON.stringify(this.draft.document, null, 2);
  }

  exportCorruptRecordJson(corruptKey: string): string | null {
    const found = this.corruptRecords.find((r) => r.corruptKey === corruptKey);
    if (!found) return null;
    return JSON.stringify(
      {
        corruptKey: found.corruptKey,
        sourceKey: found.sourceKey,
        sourceFingerprint: found.sourceFingerprint,
        error: found.error,
        capturedAt: found.capturedAt,
        raw: found.raw,
      },
      null,
      2,
    );
  }

  async discardCorrupt(corruptKey: string): Promise<void> {
    if (!this.storage.discardCorruptRecord) return;
    await this.storage.discardCorruptRecord(corruptKey);
    this.corruptRecords = this.corruptRecords.filter((r) => r.corruptKey !== corruptKey);
  }

  async discardOtherDraft(
    writerId: string,
    expectedLocalGen: number,
    expectedFingerprint: string,
  ): Promise<DiscardDraftCasResult> {
    if (!this.owner || !this.id || !this.storage.discardDraftCas) {
      return { deleted: false, reason: "missing" };
    }
    const res = await this.storage.discardDraftCas(
      this.owner,
      this.id,
      writerId,
      expectedLocalGen,
      expectedFingerprint,
    );
    if (res.deleted) {
      this.otherDrafts = this.otherDrafts.filter((d) => d.writerId !== writerId);
    } else if (res.reason === "changed") {
      this.otherDrafts = deduplicateDrafts(
        this.otherDrafts.map((d) => (d.writerId === writerId ? res.current : d)),
      );
    }
    return res;
  }

  async saveAsNewMap(newId = crypto.randomUUID()): Promise<string | null> {
    if (!this.owner || !this.draft) return null;
    const doc = this.draft.document;
    const nextDraft: LocalDraft = {
      document: doc,
      revision: 0,
      dirty: true,
      workspaceId: this.workspaceId ?? this.draft.workspaceId ?? null,
      access: "owner",
    };
    if (this.storage.putDraftCas) {
      await this.storage.putDraftCas(this.owner, newId, crypto.randomUUID(), {
        localGen: 1,
        ackedGen: 0,
        baseRevision: 0,
        document: doc,
        workspaceId: nextDraft.workspaceId,
        access: "owner",
      });
    } else {
      await this.storage.saveLocal(this.owner, nextDraft, newId);
    }
    return newId;
  }

  async removeCleanCache(): Promise<RemoveCleanSyncedResult> {
    if (!this.owner || !this.id || !this.storage.removeCleanSyncedCas) {
      return { removed: false, reason: "has_pending_drafts" };
    }
    return this.storage.removeCleanSyncedCas(this.owner, this.id);
  }

  async start() {
    let local: LocalDraft | null = null;
    const reqOwner = this.owner;
    try {
      if (this.usesV2() && this.owner && this.id) {
        const state = await this.storage.loadMapState!(this.owner, this.id);
        if (this.closed || this.owner !== reqOwner) return;
        this.corruptRecords = state.corrupts;
        if (state.corrupts.length > 0) {
          this.localError(syncMessages().localCorruptDetected);
        }
        const foreignDrafts = state.drafts.filter((d) => d.writerId !== this.writerId);
        this.otherDrafts = deduplicateDrafts(foreignDrafts);

        if (state.drafts.length > 0) {
          // Claim by copying into this instance's own writerId without deleting the other writer's key
          const latest = state.drafts[0];
          local = {
            document: latest.document,
            revision: latest.baseRevision,
            dirty: true,
            workspaceId: latest.workspaceId,
            access: latest.access,
          };
          this.localGen = 1;
          this.ackedGen = 0;
          this.confirmedBaseRevision = latest.baseRevision;
          this.hasBeenSyncedToCloud = latest.baseRevision > 0 || Boolean(state.synced && state.synced.revision > 0);
          this.needsLocalSave = true;
        } else if (state.legacy) {
          local = state.legacy.draft;
          this.hasBeenSyncedToCloud = local.revision > 0;
          this.confirmedBaseRevision = local.revision;
          if (local.dirty) {
            this.localGen = 1;
            this.needsLocalSave = true;
          } else if (local.revision > 0) {
            await this.storage.putSyncedCas!(this.owner, this.id, {
              revision: local.revision,
              document: local.document,
              workspaceId: local.workspaceId,
              access: local.access,
            });
          }
          await this.storage.markMigrated?.(
            this.owner,
            this.id,
            state.legacy.sourceKey,
            state.legacy.sourceFingerprint,
          );
        } else if (state.synced) {
          local = {
            document: state.synced.document,
            revision: state.synced.revision,
            dirty: false,
            workspaceId: state.synced.workspaceId,
            access: state.synced.access,
          };
          this.confirmedBaseRevision = state.synced.revision;
          this.hasBeenSyncedToCloud = state.synced.revision > 0;
        }
      } else {
        local = await this.storage.loadLocal(this.owner, this.id ?? undefined);
        if (local) {
          this.confirmedBaseRevision = local.revision;
          this.hasBeenSyncedToCloud = local.revision > 0;
          if (local.dirty) this.localGen = 1;
        }
      }
    } catch {
      this.cacheReadable = false;
      if (!this.closed) this.localError(syncMessages().localReadError);
    }
    if (this.closed || this.owner !== reqOwner) return;
    this.draft = this.withScope(local ?? { document: this.initialDocument(), revision: 0, dirty: false });
    this.show(this.draft.document);
    if (this.owner) await this.sync();
  }

  private initialDocument(): MindmapDocument {
    if (this.owner) return getTemplate("blank-organic").create();
    const document = documentFromTopic(getWebMessages().common.untitledMap);
    return { ...document, theme: { ...document.theme, paletteId: "workspace" } };
  }

  edit(document: MindmapDocument) {
    if (!this.draft || this.closed) return;
    this.localGen += 1;
    this.draft = {
      ...this.draft,
      document,
      dirty: true,
      revision: Math.max(this.draft.revision, this.confirmedBaseRevision),
    };
    this.needsLocalSave = true;
    clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => void this.flush(), 250);
    if (this.owner && !this.conflicted && !this.remoteUnavailable) {
      this.emitStatus(this.pendingState());
      this.scheduleCloud();
    }
  }

  private scheduleCloud() {
    clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => void this.sync(), 2500);
  }

  async flush() {
    if (!this.draft || !this.needsLocalSave || !this.cacheReadable) return;
    const reqOwner = this.owner;
    const reqId = this.id;
    const flushGen = this.localGen;
    const flushAckedGen = this.ackedGen;
    const flushBaseRevision = Math.max(this.draft.revision, this.confirmedBaseRevision);
    const snapshot = this.draft;
    this.needsLocalSave = false;
    try {
      if (this.usesV2() && reqOwner && reqId) {
        if (snapshot.dirty) {
          await this.storage.putDraftCas!(reqOwner, reqId, this.writerId, {
            localGen: flushGen,
            ackedGen: flushAckedGen,
            baseRevision: flushBaseRevision,
            document: snapshot.document,
            workspaceId: snapshot.workspaceId,
            access: snapshot.access,
          });
        } else if (flushBaseRevision > 0) {
          await this.storage.putSyncedCas!(reqOwner, reqId, {
            revision: flushBaseRevision,
            document: snapshot.document,
            workspaceId: snapshot.workspaceId,
            access: snapshot.access,
          });
        }
      } else {
        await this.storage.saveLocal(reqOwner, snapshot, reqId ?? undefined);
      }
      if (!this.closed && this.owner === reqOwner && this.corruptRecords.length === 0) {
        this.localError("");
      }
    } catch {
      this.needsLocalSave = true;
      if (!this.closed && this.owner === reqOwner) this.localError(syncMessages().localSaveError);
    }
  }

  async sync(useCloud = false) {
    if (
      !this.owner ||
      !this.id ||
      !this.draft ||
      this.closed ||
      this.running ||
      (this.conflicted && !useCloud) ||
      (this.remoteUnavailable && !useCloud)
    ) {
      return;
    }
    const reqOwner = this.owner;
    const reqId = this.id;
    this.running = true;
    const s = syncMessages();
    this.emitStatus({ label: s.syncingLabel, detail: s.syncingDetail, status: "syncing" });
    try {
      if (this.pullingRequired || !this.draft.dirty || useCloud) {
        const beforeGen = this.localGen;
        const beforeDoc = this.draft.document;
        const remote = await this.storage.readCloud(reqOwner, reqId);
        if (this.closed || this.owner !== reqOwner) return;

        // Remote unavailable detection: previously synced or non-zero base revision,
        // and single-map GET returns { revision: 0, document: null }
        if (remote.revision === 0 && remote.document === null && (this.draft.revision > 0 || this.hasBeenSyncedToCloud)) {
          this.remoteUnavailable = true;
          this.conflicted = false;
          this.pullingRequired = false;
          this.emitStatus(this.remoteUnavailableState());
          return;
        }

        if (remote.document && remote.revision > 0) {
          this.hasBeenSyncedToCloud = true;
          this.remoteUnavailable = false;
          if (this.usesV2() && this.cacheReadable) {
            await this.storage.putSyncedCas!(reqOwner, reqId, {
              revision: remote.revision,
              document: remote.document,
              workspaceId: this.draft.workspaceId,
              access: this.draft.access,
            });
            if (this.closed || this.owner !== reqOwner) return;
          }
        }

        if (useCloud && (!remote.document || this.draft.document !== beforeDoc || this.localGen !== beforeGen)) {
          throw new CloudError(409, this.conflictState().detail);
        }

        if (!useCloud && this.draft.dirty && remote.revision !== this.draft.revision) {
          if (!remote.document || canonicalJson(remote.document) !== canonicalJson(this.draft.document)) {
            throw new CloudError(409, this.conflictState().detail);
          }
          // Same content as cloud -> reconcile cleanly
          const reconcileGen = this.localGen;
          this.ackedGen = Math.max(this.ackedGen, reconcileGen);
          this.confirmedBaseRevision = Math.max(this.confirmedBaseRevision, remote.revision);
          if (this.usesV2() && this.cacheReadable) {
            const confirmed = await this.storage.confirmUploadCas!(reqOwner, reqId, this.writerId, {
              sentGen: reconcileGen,
              newRevision: remote.revision,
              document: remote.document,
              workspaceId: this.draft.workspaceId,
              access: this.draft.access,
            });
            if (this.closed || this.owner !== reqOwner) return;
            const stillSame = this.localGen === reconcileGen && confirmed.draftCleared;
            this.draft = {
              ...this.draft,
              revision: Math.max(this.draft.revision, remote.revision),
              dirty: !stillSame,
            };
            this.needsLocalSave = !stillSame;
          } else {
            this.draft = { ...this.draft, revision: remote.revision, dirty: false };
            this.needsLocalSave = true;
          }
        } else if (
          remote.document &&
          (useCloud || (!this.draft.dirty && remote.revision !== this.draft.revision))
        ) {
          const acceptGen = this.localGen;
          this.ackedGen = Math.max(this.ackedGen, acceptGen);
          this.confirmedBaseRevision = Math.max(this.confirmedBaseRevision, remote.revision);
          this.draft = this.withScope({ document: remote.document, revision: remote.revision, dirty: false });
          this.show(remote.document);
          if (this.usesV2() && this.cacheReadable) {
            await this.storage.confirmUploadCas!(reqOwner, reqId, this.writerId, {
              sentGen: acceptGen,
              newRevision: remote.revision,
              document: remote.document,
              workspaceId: this.draft.workspaceId,
              access: this.draft.access,
            });
            if (this.closed || this.owner !== reqOwner) return;
            this.needsLocalSave = false;
          } else {
            this.needsLocalSave = true;
          }
        }
        this.pullingRequired = false;
        this.conflicted = false;
      }

      if (this.draft.dirty) {
        // Capture immutable 4-tuple before upload
        const sentGen = this.localGen;
        const baseRevision = Math.max(this.draft.revision, this.confirmedBaseRevision);
        const docSnapshot = this.draft.document;

        const newRevision =
          this.workspaceId && baseRevision === 0
            ? await this.storage.writeCloud(reqOwner, reqId, baseRevision, docSnapshot, this.workspaceId)
            : await this.storage.writeCloud(reqOwner, reqId, baseRevision, docSnapshot);
        if (this.closed || this.owner !== reqOwner) return;

        // Step A (always runs for this writerId): monotonically advance causal watermark & baseRevision
        this.ackedGen = Math.max(this.ackedGen, sentGen);
        this.confirmedBaseRevision = Math.max(this.confirmedBaseRevision, newRevision);
        this.hasBeenSyncedToCloud = true;

        if (this.usesV2() && this.cacheReadable) {
          const confirmResult = await this.storage.confirmUploadCas!(reqOwner, reqId, this.writerId, {
            sentGen,
            newRevision,
            document: docSnapshot,
            workspaceId: this.draft.workspaceId,
            access: this.draft.access,
          });
          // Re-verify after awaiting IDB commit
          if (this.closed || this.owner !== reqOwner) return;

          // Step B: only mark clean/synced if no newer local edit exists in store OR memory
          if (this.localGen === sentGen && confirmResult.draftCleared) {
            this.draft = {
              ...this.draft,
              revision: Math.max(this.draft.revision, newRevision),
              dirty: false,
            };
            this.needsLocalSave = false;
          } else {
            // Newer edit (gen2 > sentGen) exists: keep gen2 document untouched, advance baseRevision
            this.draft = {
              ...this.draft,
              revision: Math.max(this.draft.revision, newRevision),
              dirty: true,
            };
            if (confirmResult.draftCleared) {
              // gen2 happened in memory while confirmUploadCas was committing -> persist gen2 now
              this.needsLocalSave = true;
              await this.flush();
              if (this.closed || this.owner !== reqOwner) return;
            }
          }
        } else {
          this.draft = {
            ...this.draft,
            revision: Math.max(this.draft.revision, newRevision),
            dirty: this.draft.document !== docSnapshot || this.localGen !== sentGen,
          };
          this.needsLocalSave = true;
        }
      }

      if (this.needsLocalSave) {
        await this.flush();
        if (this.closed || this.owner !== reqOwner) return;
      }

      const doneMsg = syncMessages();
      this.emitStatus(
        this.draft.dirty
          ? this.pendingState()
          : this.draft.revision
            ? this.syncedState()
            : { label: doneMsg.readyLabel, detail: doneMsg.readyDetail, status: "ready" },
      );
      if (this.draft.dirty) this.scheduleCloud();
    } catch (error) {
      if (this.closed || this.owner !== reqOwner) return;
      this.pullingRequired = true;
      this.conflicted ||= error instanceof CloudError && error.status === 409;
      const errMsg = syncMessages();
      this.emitStatus(
        this.conflicted
          ? this.conflictState()
          : {
              label: errMsg.unsyncedLabel,
              detail: error instanceof Error ? error.message : errMsg.unsyncedDetail,
              status: "unsynced",
            },
      );
    } finally {
      this.running = false;
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.localTimer);
    clearTimeout(this.cloudTimer);
    void this.flush();
  }
}
