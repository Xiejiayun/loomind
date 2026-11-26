import { createStore, type StoreApi } from "zustand/vanilla";
import type { MindmapDocument, MindmapSheet, TopicShape, TopicStyleOverride } from "../model/document.js";
import type { MindmapCommand } from "./commands.js";
import type { CommandRejection } from "./reducer.js";
import { LocalImmerSyncAdapter, type SyncAdapter } from "./sync-adapter.js";

export interface CameraState {
  x: number;
  y: number;
  scale: number;
}

export interface StyleClipboard {
  shape?: TopicShape;
  style?: TopicStyleOverride;
}

export interface MindmapStoreState {
  doc: MindmapDocument;
  dirtyTopicIds: ReadonlySet<string>;
  selectedTopicIds: string[];
  selectedRelationshipId: string | null;
  selectedBoundaryId: string | null;
  editingTopicId: string | null;
  drillRootId: string | null;
  camera: CameraState;
  viewMode: "canvas" | "outline";
  zenMode: boolean;
  pitchMode: boolean;
  formatPanelOpen: boolean;
  minimapOpen: boolean;
  styleClipboard: StyleClipboard | null;
  canUndo: boolean;
  canRedo: boolean;
  lastRejection: (CommandRejection & { id: number }) | null;
  adapter: SyncAdapter;

  dispatch: (cmd: MindmapCommand, options?: { coalesceKey?: string }) => CommandRejection | void;
  clearRejection: () => void;
  replaceDocument: (doc: MindmapDocument) => void;
  undo: () => void;
  redo: () => void;
  selectTopics: (ids: string[]) => void;
  selectRelationship: (id: string | null) => void;
  selectBoundary: (id: string | null) => void;
  setEditingTopicId: (id: string | null) => void;
  setDrillRootId: (id: string | null) => void;
  setCamera: (patch: Partial<CameraState>) => void;
  setViewMode: (mode: "canvas" | "outline") => void;
  setZenMode: (open: boolean) => void;
  setPitchMode: (open: boolean) => void;
  setFormatPanelOpen: (open: boolean) => void;
  setMinimapOpen: (open: boolean) => void;
  setStyleClipboard: (clip: StyleClipboard | null) => void;
  getActiveSheet: () => MindmapSheet;
}

export function createMindmapStore(
  initialDocOrAdapter: MindmapDocument | SyncAdapter,
): StoreApi<MindmapStoreState> {
  const adapter: SyncAdapter =
    "applyCommand" in initialDocOrAdapter
      ? initialDocOrAdapter
      : new LocalImmerSyncAdapter(initialDocOrAdapter);

  const store = createStore<MindmapStoreState>((set, get) => ({
    doc: adapter.getDocument(),
    dirtyTopicIds: new Set<string>(),
    selectedTopicIds: [],
    selectedRelationshipId: null,
    selectedBoundaryId: null,
    editingTopicId: null,
    drillRootId: null,
    camera: { x: 0, y: 0, scale: 1 },
    viewMode: "canvas",
    zenMode: false,
    pitchMode: false,
    formatPanelOpen: true,
    minimapOpen: false,
    styleClipboard: null,
    canUndo: adapter.canUndo(),
    canRedo: adapter.canRedo(),
    lastRejection: null,
    adapter,

    dispatch: (cmd, options) => {
      const rejected = adapter.applyCommand(cmd, options);
      if (rejected) {
        set({ lastRejection: { ...rejected, id: Date.now() } });
      }
      return rejected;
    },
    clearRejection: () => set({ lastRejection: null }),
    replaceDocument: (doc) => {
      adapter.replaceDocument(doc);
      const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
      set({
        selectedTopicIds: [sheet.rootTopic.id],
        selectedRelationshipId: null,
        selectedBoundaryId: null,
        editingTopicId: null,
        drillRootId: null,
      });
    },
    undo: () => adapter.undo(),
    redo: () => adapter.redo(),
    selectTopics: (ids) =>
      set({ selectedTopicIds: ids, selectedRelationshipId: null, selectedBoundaryId: null }),
    selectRelationship: (id) =>
      set({ selectedRelationshipId: id, selectedTopicIds: [], selectedBoundaryId: null }),
    selectBoundary: (id) =>
      set({ selectedBoundaryId: id, selectedTopicIds: [], selectedRelationshipId: null }),
    setEditingTopicId: (id) => set({ editingTopicId: id }),
    setDrillRootId: (id) => set({ drillRootId: id }),
    setCamera: (patch) => set((s) => ({ camera: { ...s.camera, ...patch } })),
    setViewMode: (viewMode) => set({ viewMode }),
    setZenMode: (zenMode) => set({ zenMode }),
    setPitchMode: (pitchMode) => set({ pitchMode }),
    setFormatPanelOpen: (formatPanelOpen) => set({ formatPanelOpen }),
    setMinimapOpen: (minimapOpen) => set({ minimapOpen }),
    setStyleClipboard: (styleClipboard) => set({ styleClipboard }),
    getActiveSheet: () => {
      const { doc } = get();
      return doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
    },
  }));

  adapter.subscribe((doc, dirtyTopicIds) => {
    store.setState({
      doc,
      dirtyTopicIds,
      canUndo: adapter.canUndo(),
      canRedo: adapter.canRedo(),
    });
  });

  return store;
}
