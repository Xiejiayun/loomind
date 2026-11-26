import { applyPatches, type Patch } from "immer";
import type { MindmapDocument } from "../model/document.js";
import type { MindmapCommand } from "./commands.js";
import { applyMindmapCommand, type CommandRejection } from "./reducer.js";

export interface SyncAdapter {
  getDocument(): MindmapDocument;
  applyCommand(cmd: MindmapCommand, options?: { coalesceKey?: string }): CommandRejection | void;
  replaceDocument(doc: MindmapDocument): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  subscribe(listener: (doc: MindmapDocument, dirtyTopicIds: ReadonlySet<string>) => void): () => void;
}

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
  coalesceKey?: string;
  timestamp: number;
}

const COALESCE_WINDOW_MS = 600;
const MAX_HISTORY = 100;

export class LocalImmerSyncAdapter implements SyncAdapter {
  private doc: MindmapDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(doc: MindmapDocument, dirtyTopicIds: ReadonlySet<string>) => void>();

  constructor(initialDoc: MindmapDocument) {
    this.doc = initialDoc;
  }

  getDocument(): MindmapDocument {
    return this.doc;
  }

  replaceDocument(doc: MindmapDocument): void {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.notify(new Set());
  }

  applyCommand(cmd: MindmapCommand, options?: { coalesceKey?: string }): CommandRejection | undefined {
    const { nextDoc, patches, inversePatches, dirtyTopicIds, rejected } = applyMindmapCommand(this.doc, cmd);
    if (rejected) return rejected;
    if (patches.length === 0) return undefined;

    this.doc = nextDoc;
    this.redoStack = [];
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];

    if (
      options?.coalesceKey &&
      top &&
      top.coalesceKey === options.coalesceKey &&
      now - top.timestamp < COALESCE_WINDOW_MS
    ) {
      top.patches = [...top.patches, ...patches];
      top.inversePatches = [...inversePatches, ...top.inversePatches];
      top.timestamp = now;
    } else {
      this.undoStack.push({
        patches,
        inversePatches,
        coalesceKey: options?.coalesceKey,
        timestamp: now,
      });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    }

    this.notify(dirtyTopicIds);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.doc = applyPatches(this.doc, entry.inversePatches);
    this.redoStack.push(entry);
    this.notify(new Set());
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.doc = applyPatches(this.doc, entry.patches);
    this.undoStack.push(entry);
    this.notify(new Set());
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe(listener: (doc: MindmapDocument, dirtyTopicIds: ReadonlySet<string>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(dirty: ReadonlySet<string>): void {
    for (const l of this.listeners) l(this.doc, dirty);
  }
}
