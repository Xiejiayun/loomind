import { LoroDoc, UndoManager, type LoroTree, type LoroTreeNode, type TreeID, type VersionVector } from "loro-crdt";
import {
  DEFAULT_THEME_CONFIG,
  type InlineAsset,
  type MindmapBoundary,
  type MindmapDocument,
  type MindmapRelationship,
  type MindmapSheet,
  type MindmapSummary,
  type MindmapThemeConfig,
  type MindmapTopic,
} from "../model/document.js";
import type { MindmapCommand } from "./commands.js";
import { applyMindmapCommand, type CommandRejection } from "./reducer.js";
import type { PeerPresence, SyncAdapter } from "./sync-adapter.js";

export type { PeerPresence };

interface SheetMeta {
  id: string;
  title: string;
  structure: MindmapSheet["structure"];
  direction: MindmapSheet["direction"];
  spacing: MindmapSheet["spacing"];
  theme?: Partial<MindmapThemeConfig>;
  rootTopicId: string;
  floatingTopics: MindmapTopic[];
  boundaries: MindmapBoundary[];
  summaries: MindmapSummary[];
  relationships: MindmapRelationship[];
}

export class LoroSyncAdapter implements SyncAdapter {
  private loro: LoroDoc;
  private tree: LoroTree;
  private undoManager: UndoManager;
  private cachedDoc: MindmapDocument;
  private topicIdToTreeId = new Map<string, TreeID>();
  private listeners = new Set<(doc: MindmapDocument, dirtyTopicIds: ReadonlySet<string>) => void>();
  private presences = new Map<string, PeerPresence>();
  private presenceListeners = new Set<(peers: PeerPresence[]) => void>();

  constructor(initialDoc?: MindmapDocument, peerId?: number | bigint) {
    this.loro = new LoroDoc();
    if (peerId !== undefined) this.loro.setPeerId(peerId);
    this.tree = this.loro.getTree("topics");
    this.tree.enableFractionalIndex(0);
    this.undoManager = new UndoManager(this.loro, { maxUndoSteps: 100, mergeInterval: 0 });
    this.cachedDoc = initialDoc ?? {
      format: "mindmap-document",
      version: 1,
      activeSheetId: "",
      theme: DEFAULT_THEME_CONFIG,
      sheets: [],
      assets: {},
      deletedIds: [],
    };
    if (initialDoc) {
      this.writeDocumentToLoro(initialDoc);
      this.loro.commit();
      this.undoManager.clear();
      this.cachedDoc = this.readDocumentFromLoro();
    }
  }

  static fromSnapshot(snapshot: Uint8Array, peerId?: number | bigint): LoroSyncAdapter {
    const adapter = new LoroSyncAdapter(undefined, peerId);
    adapter.importUpdates(snapshot);
    adapter.undoManager.clear();
    return adapter;
  }

  getDocument(): MindmapDocument {
    return this.cachedDoc;
  }

  getLoroDoc(): LoroDoc {
    return this.loro;
  }

  getVersion(): VersionVector {
    return this.loro.oplogVersion();
  }

  exportSnapshot(): Uint8Array {
    return this.loro.export({ mode: "snapshot" });
  }

  exportUpdates(from?: VersionVector): Uint8Array {
    return this.loro.export(from ? { mode: "update", from } : { mode: "update" });
  }

  importUpdates(bytes: Uint8Array): void {
    this.loro.import(bytes);
    this.rebuildIndexFromTree();
    this.cachedDoc = this.readDocumentFromLoro();
    this.notify(new Set());
  }

  replaceDocument(doc: MindmapDocument): void {
    this.writeDocumentToLoro(doc);
    this.loro.commit();
    this.undoManager.clear();
    this.cachedDoc = this.readDocumentFromLoro();
    this.notify(new Set());
  }

  applyCommand(cmd: MindmapCommand, _options?: { coalesceKey?: string }): CommandRejection | undefined {
    const { nextDoc, patches, dirtyTopicIds, rejected } = applyMindmapCommand(this.cachedDoc, cmd);
    if (rejected) return rejected;
    if (patches.length === 0) return undefined;

    this.syncCommandToLoro(cmd, nextDoc);
    this.loro.commit();
    this.rebuildIndexFromTree();
    this.cachedDoc = this.readDocumentFromLoro();
    this.notify(dirtyTopicIds);
    return undefined;
  }

  undo(): void {
    if (!this.undoManager.canUndo()) return;
    this.undoManager.undo();
    this.rebuildIndexFromTree();
    this.cachedDoc = this.readDocumentFromLoro();
    this.notify(new Set());
  }

  redo(): void {
    if (!this.undoManager.canRedo()) return;
    this.undoManager.redo();
    this.rebuildIndexFromTree();
    this.cachedDoc = this.readDocumentFromLoro();
    this.notify(new Set());
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  subscribe(listener: (doc: MindmapDocument, dirtyTopicIds: ReadonlySet<string>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setPeerPresence(presence: PeerPresence): void {
    this.presences.set(presence.peerId, { ...presence, updatedAt: Date.now() });
    const list = Array.from(this.presences.values());
    for (const l of this.presenceListeners) l(list);
  }

  getPeerPresences(): PeerPresence[] {
    return Array.from(this.presences.values());
  }

  subscribePresence(listener: (peers: PeerPresence[]) => void): () => void {
    this.presenceListeners.add(listener);
    return () => {
      this.presenceListeners.delete(listener);
    };
  }

  private notify(dirty: ReadonlySet<string>): void {
    for (const l of this.listeners) l(this.cachedDoc, dirty);
  }

  private writeMetaToLoro(doc: MindmapDocument): void {
    const meta = this.loro.getMap("meta");
    meta.set("activeSheetId", doc.activeSheetId);
    meta.set("theme", JSON.stringify(doc.theme));
    meta.set("assets", JSON.stringify(doc.assets));
    meta.set("deletedIds", JSON.stringify(doc.deletedIds));
    const sheetsMeta: SheetMeta[] = doc.sheets.map((s) => ({
      id: s.id,
      title: s.title,
      structure: s.structure,
      direction: s.direction,
      spacing: s.spacing,
      theme: s.theme,
      rootTopicId: s.rootTopic.id,
      floatingTopics: s.floatingTopics,
      boundaries: s.boundaries,
      summaries: s.summaries,
      relationships: s.relationships,
    }));
    meta.set("sheetsMeta", JSON.stringify(sheetsMeta));
  }

  private setNodePayload(node: LoroTreeNode, sheetId: string, topic: MindmapTopic): void {
    const { children: _children, ...rest } = topic;
    node.data.set("topicId", topic.id);
    node.data.set("sheetId", sheetId);
    node.data.set("payload", JSON.stringify(rest));
  }

  private writeDocumentToLoro(doc: MindmapDocument): void {
    // Clear existing tree roots
    for (const root of this.tree.roots()) {
      this.tree.delete(root.id);
    }
    this.topicIdToTreeId.clear();

    const insertSubtree = (sheetId: string, topic: MindmapTopic, parentTreeId?: TreeID) => {
      const node = this.tree.createNode(parentTreeId);
      this.setNodePayload(node, sheetId, topic);
      this.topicIdToTreeId.set(topic.id, node.id);
      for (const c of topic.children) {
        insertSubtree(sheetId, c, node.id);
      }
    };

    for (const sheet of doc.sheets) {
      insertSubtree(sheet.id, sheet.rootTopic);
    }
    this.writeMetaToLoro(doc);
  }

  /**
   * Maps MindmapCommand mutations onto LoroTree operations (createNode, move, delete)
   * so concurrent edits & reparents merge conflict-free via Loro's Movable Tree CRDT.
   */
  private syncCommandToLoro(cmd: MindmapCommand, nextDoc: MindmapDocument): void {
    this.writeMetaToLoro(nextDoc);

    if (cmd.type === "topic/reparent") {
      const srcTreeId = this.topicIdToTreeId.get(cmd.topicId);
      const dstTreeId = this.topicIdToTreeId.get(cmd.newParentId);
      if (srcTreeId && dstTreeId) {
        this.tree.move(srcTreeId, dstTreeId, cmd.index);
        return;
      }
    }

    if (cmd.type === "topic/delete") {
      for (const id of cmd.topicIds) {
        const tid = this.topicIdToTreeId.get(id);
        if (tid) {
          this.tree.delete(tid);
          this.topicIdToTreeId.delete(id);
        }
      }
      return;
    }

    // Reconcile sheet tree nodes incrementally against LoroTree
    for (const sheet of nextDoc.sheets) {
      const syncTopic = (topic: MindmapTopic, parentTreeId?: TreeID, index?: number) => {
        let tid = this.topicIdToTreeId.get(topic.id);
        if (!tid) {
          const created = this.tree.createNode(parentTreeId, index);
          this.setNodePayload(created, sheet.id, topic);
          this.topicIdToTreeId.set(topic.id, created.id);
          tid = created.id;
        } else {
          const existing = this.tree.getNodeByID(tid);
          if (existing) {
            const curParentId = existing.parent()?.id;
            if (parentTreeId && curParentId !== parentTreeId) {
              this.tree.move(tid, parentTreeId, index);
            }
            const { children: _c, ...rest } = topic;
            const nextPayload = JSON.stringify(rest);
            if (existing.data.get("payload") !== nextPayload) {
              existing.data.set("payload", nextPayload);
            }
          }
        }
        topic.children.forEach((c, idx) => syncTopic(c, tid, idx));
      };
      syncTopic(sheet.rootTopic);
    }
  }

  private rebuildIndexFromTree(): void {
    this.topicIdToTreeId.clear();
    for (const node of this.tree.getNodes()) {
      const topicId = node.data.get("topicId");
      if (typeof topicId === "string") {
        this.topicIdToTreeId.set(topicId, node.id);
      }
    }
  }

  private readDocumentFromLoro(): MindmapDocument {
    const meta = this.loro.getMap("meta");
    const activeSheetId = String(meta.get("activeSheetId") ?? this.cachedDoc.activeSheetId);
    const theme: MindmapThemeConfig = meta.get("theme")
      ? JSON.parse(String(meta.get("theme")))
      : DEFAULT_THEME_CONFIG;
    const assets: Record<string, InlineAsset> = meta.get("assets")
      ? JSON.parse(String(meta.get("assets")))
      : {};
    const deletedIds: string[] = meta.get("deletedIds")
      ? JSON.parse(String(meta.get("deletedIds")))
      : [];
    const sheetsMeta: SheetMeta[] = meta.get("sheetsMeta")
      ? JSON.parse(String(meta.get("sheetsMeta")))
      : [];

    const readSubtree = (node: LoroTreeNode): MindmapTopic => {
      const rawPayload = node.data.get("payload");
      const base: Omit<MindmapTopic, "children"> = rawPayload
        ? JSON.parse(String(rawPayload))
        : { id: String(node.data.get("topicId") ?? node.id), title: { type: "doc", content: [{ type: "paragraph" }] } };
      const children = (node.children() ?? []).map(readSubtree);
      return { ...base, children };
    };

    const rootsByTopicId = new Map<string, LoroTreeNode>();
    for (const root of this.tree.roots()) {
      const tid = root.data.get("topicId");
      if (typeof tid === "string") rootsByTopicId.set(tid, root);
    }

    const sheets: MindmapSheet[] = sheetsMeta.map((sm) => {
      const rootTreeNode = rootsByTopicId.get(sm.rootTopicId);
      const rootTopic = rootTreeNode
        ? readSubtree(rootTreeNode)
        : this.cachedDoc.sheets.find((s) => s.id === sm.id)?.rootTopic ?? this.cachedDoc.sheets[0].rootTopic;
      return {
        id: sm.id,
        title: sm.title,
        structure: sm.structure,
        direction: sm.direction,
        spacing: sm.spacing,
        theme: sm.theme,
        rootTopic,
        floatingTopics: sm.floatingTopics,
        boundaries: sm.boundaries,
        summaries: sm.summaries,
        relationships: sm.relationships,
      };
    });

    return {
      format: "mindmap-document",
      version: 1,
      activeSheetId,
      theme,
      sheets: sheets.length > 0 ? sheets : this.cachedDoc.sheets,
      assets,
      deletedIds,
    };
  }
}
