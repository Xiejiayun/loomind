import React, { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand";
import {
  createMindmapStore,
  getPalette,
  getTemplate,
  LayoutEngine,
  type MindmapDocument,
  type MindmapStoreState,
  type SyncAdapter,
} from "@mindmap/core";
import { DomTextMeasurer } from "./canvas/DomMeasurer.js";
import { HybridCanvas } from "./canvas/HybridCanvas.js";
import { Minimap } from "./canvas/Minimap.js";
import { AiModal } from "./chrome/AiModal.js";
import { CommandK } from "./chrome/CommandK.js";
import { ContextMenu } from "./chrome/ContextMenu.js";
import { ExportModal } from "./chrome/ExportModal.js";
import { FormatPanel } from "./chrome/FormatPanel.js";
import { SheetBar } from "./chrome/SheetBar.js";
import { ShortcutsHelp } from "./chrome/ShortcutsHelp.js";
import { TemplateModal } from "./chrome/TemplateModal.js";
import { TopToolbar } from "./chrome/TopToolbar.js";
import { MindmapStoreContext, useMindmapStore } from "./context.js";
import { OutlinerView } from "./outline/OutlinerView.js";
import { PitchOverlay } from "./pitch/PitchOverlay.js";

export interface MindmapEditorProps {
  initialDoc?: MindmapDocument;
  adapter?: SyncAdapter;
  onDocumentChange?: (doc: MindmapDocument) => void;
  accountControl?: React.ReactNode;
  chromeTheme?: "dark" | "light";
  sidebar?: React.ReactNode;
  initialFormatPanelOpen?: boolean;
}

const MindmapEditorInner: React.FC<Pick<MindmapEditorProps, "accountControl" | "chromeTheme">> = ({ accountControl, chromeTheme }) => {
  const doc = useMindmapStore((s) => s.doc);
  const drillRootId = useMindmapStore((s) => s.drillRootId);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const setZenMode = useMindmapStore((s) => s.setZenMode);
  const setFormatPanelOpen = useMindmapStore((s) => s.setFormatPanelOpen);

  // Auto-collapse FormatPanel on mobile screens (< 768px)
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setFormatPanelOpen(false);
    }
  }, [setFormatPanelOpen]);

  const activeSheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const isDark = chromeTheme ? chromeTheme === "dark" : getPalette({ ...doc.theme, ...activeSheet.theme }.paletteId).isDark && viewMode === "canvas";

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ topicId: string; x: number; y: number } | null>(
    null,
  );

  const engineRef = useRef<LayoutEngine | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  if (!engineRef.current) {
    engineRef.current = new LayoutEngine(new DomTextMeasurer());
  }

  const layout = useMemo(
    () => engineRef.current!.compute(doc, doc.activeSheetId, { drillRootId, appearance: chromeTheme }),
    [doc, drillRootId, chromeTheme],
  );

  const exportLayout = useMemo(() => exportOpen && chromeTheme === "dark" && (activeSheet.theme?.paletteId ?? doc.theme.paletteId) === "workspace"
    ? engineRef.current!.compute(doc, doc.activeSheetId, { drillRootId }) : layout,
    [exportOpen, chromeTheme, activeSheet, doc, drillRootId, layout]);

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
      <TopToolbar
        isDark={isDark}
        accountControl={accountControl}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenAi={() => setAiOpen(true)}
        onOpenExport={() => setExportOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {viewMode === "canvas" ? (
          <>
            <HybridCanvas
              viewportRef={viewportRef}
              appearance={chromeTheme}
              layout={layout}
              onOpenContextMenu={(topicId, pos) => setContextMenu({ topicId, ...pos })}
              onOpenAi={() => setAiOpen(true)}
            />
            <Minimap layout={layout} appearance={chromeTheme} />
            {!zenMode && <ShortcutsHelp isDark={isDark} />}
          </>
        ) : (
          <OutlinerView />
        )}
        <FormatPanel isDark={isDark} />
      </div>

      <SheetBar layout={layout} isDark={isDark} viewportRef={viewportRef} />

      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <TemplateModal open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} layout={exportLayout} />
      <AiModal open={aiOpen} onOpenChange={setAiOpen} />
      <CommandK
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        layout={layout}
        onOpenAi={() => setAiOpen(true)}
      />
      <PitchOverlay />
    </div>
  );
};

export const MindmapEditor: React.FC<MindmapEditorProps> = ({
  initialDoc,
  adapter,
  onDocumentChange,
  accountControl,
  chromeTheme,
  sidebar,
  initialFormatPanelOpen,
}) => {
  const storeRef = useRef<StoreApi<MindmapStoreState> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createMindmapStore(adapter ?? initialDoc ?? getTemplate("blank-organic").create());
    if (initialFormatPanelOpen !== undefined) storeRef.current.getState().setFormatPanelOpen(initialFormatPanelOpen);
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
      {sidebar}
      <MindmapEditorInner accountControl={accountControl} chromeTheme={chromeTheme} />
    </MindmapStoreContext.Provider>
  );
};
