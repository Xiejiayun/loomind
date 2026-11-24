import React, { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand";
import {
  createMindmapStore,
  getTemplate,
  LayoutEngine,
  type MindmapDocument,
  type MindmapStoreState,
  type SyncAdapter,
} from "@mindmap/core";
import { DomTextMeasurer } from "./canvas/DomMeasurer.js";
import { HybridCanvas } from "./canvas/HybridCanvas.js";
import { ContextMenu } from "./chrome/ContextMenu.js";
import { FormatPanel } from "./chrome/FormatPanel.js";
import { SheetBar } from "./chrome/SheetBar.js";
import { TemplateModal } from "./chrome/TemplateModal.js";
import { TopToolbar } from "./chrome/TopToolbar.js";
import { MindmapStoreContext, useMindmapStore } from "./context.js";

export interface MindmapEditorProps {
  initialDoc?: MindmapDocument;
  adapter?: SyncAdapter;
  onDocumentChange?: (doc: MindmapDocument) => void;
}

const MindmapEditorInner: React.FC = () => {
  const doc = useMindmapStore((s) => s.doc);
  const drillRootId = useMindmapStore((s) => s.drillRootId);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const setZenMode = useMindmapStore((s) => s.setZenMode);

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ topicId: string; x: number; y: number } | null>(
    null,
  );

  const engineRef = useRef<LayoutEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new LayoutEngine(new DomTextMeasurer());
  }

  const layout = useMemo(
    () => engineRef.current!.compute(doc, doc.activeSheetId, { drillRootId }),
    [doc, drillRootId],
  );

  // Escape exits Zen Mode
  useEffect(() => {
    if (!zenMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZenMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zenMode, setZenMode]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 font-sans">
      <TopToolbar onOpenTemplates={() => setTemplatesOpen(true)} />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {viewMode === "canvas" ? (
          <HybridCanvas
            layout={layout}
            onOpenContextMenu={(topicId, pos) => setContextMenu({ topicId, ...pos })}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-white text-sm text-slate-400">
            大纲视图将在 M2 里程碑上线
          </div>
        )}
        <FormatPanel />
      </div>

      <SheetBar layout={layout} />

      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <TemplateModal open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </div>
  );
};

export const MindmapEditor: React.FC<MindmapEditorProps> = ({
  initialDoc,
  adapter,
  onDocumentChange,
}) => {
  const storeRef = useRef<StoreApi<MindmapStoreState> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createMindmapStore(adapter ?? initialDoc ?? getTemplate("blank-organic").create());
  }

  useEffect(() => {
    if (!onDocumentChange || !storeRef.current) return;
    let prevDoc = storeRef.current.getState().doc;
    return storeRef.current.subscribe((state) => {
      if (state.doc !== prevDoc) {
        prevDoc = state.doc;
        onDocumentChange(state.doc);
      }
    });
  }, [onDocumentChange]);

  return (
    <MindmapStoreContext.Provider value={storeRef.current}>
      <MindmapEditorInner />
    </MindmapStoreContext.Provider>
  );
};
