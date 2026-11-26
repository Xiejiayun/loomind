import { canonicalJson, getTemplate, type MindmapDocument } from "@mindmap/core";
import { getWebMessages } from "../i18n.js";
import { loadLocal, saveLocal } from "../persistence.js";
import { documentFromTopic } from "../outline.js";
import { CloudError, readCloud, writeCloud } from "./cloud.js";
import type { LocalDraft, MapAccess } from "./shared.js";

export type SyncStatus = "connecting" | "conflict" | "pending" | "synced" | "syncing" | "ready" | "unsynced";
export type SyncState = { label: string; detail: string; conflict?: boolean; status?: SyncStatus };

function syncMessages() {
  return getWebMessages().sync;
}
function conflictState(): SyncState {
  const s = syncMessages();
  return { label: s.conflictLabel, detail: s.conflictDetail, conflict: true, status: "conflict" };
}
function pendingState(): SyncState {
  const s = syncMessages();
  return { label: s.pendingLabel, detail: s.pendingDetail, status: "pending" };
}
function syncedState(): SyncState {
  const s = syncMessages();
  return { label: s.syncedLabel, detail: s.syncedDetail, status: "synced" };
}

export class DraftWorkspace {
  private draft?: LocalDraft;
  private closed = false;
  private cacheReadable = true;
  private needsLocalSave = false;
  private pullingRequired = true;
  private running = false;
  private conflicted = false;
  private localTimer?: ReturnType<typeof setTimeout>;
  private cloudTimer?: ReturnType<typeof setTimeout>;

  constructor(private owner: string | null, private id: string | null, private show: (document: MindmapDocument) => void,
    private status: (state: SyncState) => void, private localError: (message: string) => void,
    private storage = { loadLocal, saveLocal, readCloud, writeCloud },
    private workspaceId?: string | null, private access?: MapAccess) {}

  private withScope(draft: LocalDraft): LocalDraft {
    if (this.workspaceId === undefined && this.access === undefined) return draft;
    return { ...draft, workspaceId: this.workspaceId ?? draft.workspaceId ?? null, access: this.access ?? draft.access ?? "owner" };
  }

  async start() {
    let local: LocalDraft | null = null;
    try { local = await this.storage.loadLocal(this.owner, this.id ?? undefined); }
    catch {
      this.cacheReadable = false;
      if (!this.closed) this.localError(syncMessages().localReadError);
    }
    if (this.closed) return;
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
    this.draft = { ...this.draft, document, dirty: true };
    this.needsLocalSave = true;
    clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => void this.flush(), 250);
    if (this.owner && !this.conflicted) { this.status(pendingState()); this.scheduleCloud(); }
  }

  private scheduleCloud() {
    clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => void this.sync(), 2500);
  }

  async flush() {
    if (!this.draft || !this.needsLocalSave || !this.cacheReadable) return;
    this.needsLocalSave = false;
    try {
      await this.storage.saveLocal(this.owner, this.draft, this.id ?? undefined);
      if (!this.closed) this.localError("");
    } catch {
      this.needsLocalSave = true;
      if (!this.closed) this.localError(syncMessages().localSaveError);
    }
  }

  async sync(useCloud = false) {
    if (!this.owner || !this.id || !this.draft || this.closed || this.running || (this.conflicted && !useCloud)) return;
    this.running = true;
    const s = syncMessages();
    this.status({ label: s.syncingLabel, detail: s.syncingDetail, status: "syncing" });
    try {
      if (this.pullingRequired || !this.draft.dirty || useCloud) {
        const before = this.draft.document;
        const remote = await this.storage.readCloud(this.owner, this.id);
        if (this.closed) return;
        if (useCloud && (!remote.document || this.draft.document !== before)) throw new CloudError(409, conflictState().detail);
        if (!useCloud && this.draft.dirty && remote.revision !== this.draft.revision) {
          if (!remote.document || canonicalJson(remote.document) !== canonicalJson(this.draft.document)) throw new CloudError(409, conflictState().detail);
          this.draft = { ...this.draft, revision: remote.revision, dirty: false };
          this.needsLocalSave = true;
        } else if (remote.document && (useCloud || (!this.draft.dirty && remote.revision !== this.draft.revision))) {
          this.draft = this.withScope({ document: remote.document, revision: remote.revision, dirty: false });
          this.show(remote.document);
          this.needsLocalSave = true;
        }
        this.pullingRequired = false;
        this.conflicted = false;
      }
      if (this.draft.dirty) {
        const sent = this.draft.document;
        const revision = this.workspaceId && this.draft.revision === 0
          ? await this.storage.writeCloud(this.owner, this.id, this.draft.revision, sent, this.workspaceId)
          : await this.storage.writeCloud(this.owner, this.id, this.draft.revision, sent);
        if (this.closed) return;
        this.draft = { ...this.draft, revision, dirty: this.draft.document !== sent };
        this.needsLocalSave = true;
      }
      await this.flush();
      if (this.closed) return;
      const doneMsg = syncMessages();
      this.status(this.draft.dirty ? pendingState() : this.draft.revision ? syncedState() : { label: doneMsg.readyLabel, detail: doneMsg.readyDetail, status: "ready" });
      if (this.draft.dirty) this.scheduleCloud();
    } catch (error) {
      if (this.closed) return;
      this.pullingRequired = true;
      this.conflicted ||= error instanceof CloudError && error.status === 409;
      const errMsg = syncMessages();
      this.status(this.conflicted ? conflictState() : { label: errMsg.unsyncedLabel, detail: error instanceof Error ? error.message : errMsg.unsyncedDetail, status: "unsynced" });
    } finally { this.running = false; }
  }

  close() {
    this.closed = true;
    clearTimeout(this.localTimer);
    clearTimeout(this.cloudTimer);
    void this.flush();
  }
}
