import { canonicalJson, type MindmapDocument, type PeerPresence } from "@mindmap/core";
import type { LoroSyncAdapter } from "@mindmap/core/loro";
import { getWebMessages } from "../i18n.js";
import { CloudError, readCloud, seedCloud, writeCloud } from "./cloud.js";
import { base64ToBytes, bytesToBase64, CollabSession } from "./collab.js";
import { restoreJsonDraft } from "./legacy-branches.js";
import { MAP_ID, MAX_CHECKPOINT_B64, type CloudDraft, type DraftHistory, type LiveCheckpoint } from "./shared.js";

interface Handlers {
  open(adapter: LoroSyncAdapter): void;
  change(doc: MindmapDocument, remote: boolean): void;
  peers(peers: PeerPresence[]): void;
  refresh(): void;
}

function invalidCheckpoint() { return new CloudError(502, getWebMessages().editorWorkspace.invalidCheckpoint); }
function same(first: MindmapDocument, second: MindmapDocument) { return first === second || canonicalJson(first) === canonicalJson(second); }

function makeCheckpoint(adapter: LoroSyncAdapter, room: string, cursor: number): LiveCheckpoint {
  const bytes = adapter.exportSnapshot();
  if (Math.ceil(bytes.byteLength / 3) * 4 > MAX_CHECKPOINT_B64) throw new CloudError(413, getWebMessages().editorWorkspace.fullHistory);
  return { room, cursor, snapshot: bytesToBase64(bytes) };
}

export class LiveDraft {
  private active?: { adapter: LoroSyncAdapter; room: string };
  private loaded?: { draft: CloudDraft; adapter: LoroSyncAdapter };
  private unsubscribe?: () => void;
  private closed = false;
  private mergingCheckpoint = false;
  session?: CollabSession;

  constructor(private readonly ctor: typeof LoroSyncAdapter, private readonly owner: string, private readonly id: string,
    private readonly name: string, private readonly handlers: Handlers) {}

  captureHistory = (doc: MindmapDocument): DraftHistory | undefined => {
    if (!this.active || !same(this.active.adapter.getDocument(), doc)) return undefined;
    return { room: this.active.room, snapshot: this.active.adapter.exportSnapshot() };
  };

  show = (doc: MindmapDocument, history?: DraftHistory) => {
    if (history) {
      let adapter: LoroSyncAdapter;
      try { adapter = this.ctor.fromSnapshot(history.snapshot); } catch { throw invalidCheckpoint(); }
      if (!same(adapter.getDocument(), doc)) throw invalidCheckpoint();
      this.bind(adapter, undefined, 0, history.room);
      return;
    }
    const saved = this.loaded;
    if (saved?.draft.document && same(saved.draft.document, doc)) this.bind(saved.adapter, saved.draft.checkpoint!, saved.draft.revision);
    else this.bind(new this.ctor(doc));
  };

  private bind(adapter: LoroSyncAdapter, checkpoint?: LiveCheckpoint, revision = 0, room = checkpoint?.room ?? crypto.randomUUID()) {
    if (this.closed) return;
    this.session?.close();
    this.session = undefined;
    this.unsubscribe?.();
    this.active = { adapter, room };
    this.unsubscribe = adapter.subscribe((doc) => this.handlers.change(doc, this.mergingCheckpoint || (this.session?.isApplyingRemote() ?? false)));
    this.handlers.open(adapter);
    if (checkpoint) this.connect(revision, checkpoint.cursor);
  }

  private connect(revision: number, cursor: number, unsentSince?: ReturnType<LoroSyncAdapter["getVersion"]>) {
    if (!this.active || this.closed) return;
    this.session = new CollabSession(this.owner, this.id, this.name, this.active.adapter, false, this.handlers.peers,
      this.active.room, cursor, revision, this.handlers.refresh);
    this.session.start(unsentSince);
  }

  close() { this.closed = true; this.unsubscribe?.(); this.session?.close(); }

  read = async (owner: string, id: string): Promise<CloudDraft> => {
    let remote = await readCloud(owner, id, true);
    if (this.closed || !remote.document) return remote;
    if (remote.checkpoint === null) {
      const seed = new this.ctor(remote.document);
      const checkpoint = makeCheckpoint(seed, crypto.randomUUID(), 0);
      try {
        await seedCloud(owner, id, remote.revision, checkpoint);
        remote = { ...remote, checkpoint };
      } catch (error) {
        if (!(error instanceof CloudError && error.status === 409)) throw error;
        remote = await readCloud(owner, id, true);
        if (!remote.checkpoint) throw invalidCheckpoint();
      }
    }
    if (this.closed) return remote;
    if (!remote.checkpoint || !remote.document) throw invalidCheckpoint();
    const checkpoint = remote.checkpoint;
    if (!MAP_ID.test(checkpoint.room) || !Number.isSafeInteger(checkpoint.cursor) || checkpoint.cursor < 0 || typeof checkpoint.snapshot !== "string" || !checkpoint.snapshot || checkpoint.snapshot.length > MAX_CHECKPOINT_B64) throw invalidCheckpoint();
    let adapter: LoroSyncAdapter;
    try { adapter = this.ctor.fromSnapshot(base64ToBytes(checkpoint.snapshot)); } catch { throw invalidCheckpoint(); }
    if (!same(adapter.getDocument(), remote.document)) throw invalidCheckpoint();
    this.loaded = { draft: remote, adapter };
    return remote;
  };

  merge = (remote: CloudDraft): boolean => {
    if (this.closed || !remote.document || !remote.checkpoint || this.loaded?.draft !== remote || !this.active) return false;
    if (this.session?.room === remote.checkpoint.room) {
      if (!this.session.applyRemoteBytes(base64ToBytes(remote.checkpoint.snapshot))) throw invalidCheckpoint();
      this.session.revision = Math.max(this.session.revision, remote.revision);
      this.session.cursor = Math.max(this.session.cursor, remote.checkpoint.cursor);
      return true;
    }
    if (this.active.room === remote.checkpoint.room) {
      this.mergingCheckpoint = true;
      try {
        if (!this.active.adapter.importUpdates(base64ToBytes(remote.checkpoint.snapshot))) throw invalidCheckpoint();
      } finally { this.mergingCheckpoint = false; }
      this.connect(remote.revision, remote.checkpoint.cursor, this.loaded.adapter.getVersion());
      return true;
    }
    if (!same(this.active.adapter.getDocument(), remote.document)) return false;
    this.bind(this.loaded.adapter, remote.checkpoint, remote.revision);
    return true;
  };

  keepLocal = async (remote: CloudDraft, local: MindmapDocument, overwrite = true) => {
    if (this.closed || !remote.checkpoint || this.loaded?.draft !== remote) return;
    if (this.session?.room === remote.checkpoint.room && this.active && same(this.active.adapter.getDocument(), local)) {
      const compared = this.active.adapter.getVersion().compare(this.loaded.adapter.getVersion());
      if (compared === 0 || compared === 1) return;
    }
    const previous = this.active?.adapter.getDocument();
    const { adapter, cursor } = await restoreJsonDraft(this.ctor, remote.checkpoint, remote.revision, local, this.owner, this.id, overwrite);
    if (this.closed || this.loaded?.draft !== remote || previous !== this.active?.adapter.getDocument()) throw new CloudError(409, getWebMessages().sync.conflictDetail);
    this.bind(adapter, { ...remote.checkpoint, cursor }, remote.revision);
  };

  write = async (owner: string, id: string, revision: number, doc: MindmapDocument, workspaceId?: string | null) => {
    if (!this.active || this.closed || id !== this.id) throw invalidCheckpoint();
    if (!this.session && revision && this.loaded?.draft.revision === revision) await this.keepLocal(this.loaded.draft, doc, false);
    const active = this.active;
    if (!same(active.adapter.getDocument(), doc)) throw new CloudError(409, getWebMessages().editorWorkspace.invalidCheckpoint);
    const checkpoint = makeCheckpoint(active.adapter, active.room, this.session?.cursor ?? 0);
    const version = active.adapter.getVersion();
    const watermark = this.session?.queueWatermark();
    const result = await writeCloud(owner, id, revision, doc, workspaceId, checkpoint);
    if (!this.closed && this.active === active) {
      if (this.session) this.session.saved(result, watermark);
      else this.connect(result, checkpoint.cursor, version);
    }
    return result;
  };
}
