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
import { AiChatPanel } from "./chrome/AiChatPanel.js";
import { CanvasDock } from "./chrome/CanvasDock.js";
import { CommandK } from "./chrome/CommandK.js";
import { ContextMenu } from "./chrome/ContextMenu.js";
import { ExportModal } from "./chrome/ExportModal.js";
import { FormatPanel } from "./chrome/FormatPanel.js";
import { InlineAiBar } from "./chrome/InlineAiBar.js";
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
  initialAiPrompt?: string;
  initialRightPanel?: "none" | "ai" | "format";
  readOnly?: boolean;
}

const MindmapEditorInner: React.FC<
  Pick<MindmapEditorProps, "accountControl" | "chromeTheme" | "initialAiPrompt" | "initialRightPanel" | "readOnly">
> = ({ accountControl, chromeTheme, initialAiPrompt, initialRightPanel, readOnly = false }) => {
  const doc = useMindmapStore((s) => s.doc);
  const drillRootId = useMindmapStore((s) => s.drillRootId);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const setZenMode = useMindmapStore((s) => s.setZenMode);
  const formatPanelOpen = useMindmapStore((s) => s.formatPanelOpen);
  const setFormatPanelOpen = useMindmapStore((s) => s.setFormatPanelOpen);

  const [aiPanelOpen, setAiPanelOpen] = useState(() => {
    if (readOnly) return false;
    if (initialAiPrompt || initialRightPanel === "ai") return true;
    return typeof window === "undefined" ? true : window.innerWidth >= 900;
  });
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<string | undefined>(initialAiPrompt);
  const [inlineAiOpen, setInlineAiOpen] = useState(false);

  // Sync initial panels & mobile collapse
  useEffect(() => {
    if (readOnly) {
      setFormatPanelOpen(false);
      setAiPanelOpen(false);
      return;
    }
    if (initialAiPrompt || initialRightPanel === "ai") {
      setAiPanelOpen(true);
    } else if (typeof window !== "undefined" && window.innerWidth < 768) {
      setFormatPanelOpen(false);
    }
  }, [initialAiPrompt, initialRightPanel, readOnly, setFormatPanelOpen]);

  const activeSheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const isDark = chromeTheme
    ? chromeTheme === "dark"
    : getPalette({ ...doc.theme, ...activeSheet.theme }.paletteId).isDark && viewMode === "canvas";

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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

  const exportLayout = useMemo(
    () =>
      exportOpen && chromeTheme === "dark" && (activeSheet.theme?.paletteId ?? doc.theme.paletteId) === "workspace"
        ? engineRef.current!.compute(doc, doc.activeSheetId, { drillRootId })
        : layout,
    [exportOpen, chromeTheme, activeSheet, doc, drillRootId, layout],
  );

  const toggleAiPanel = () => {
    if (readOnly) return;
    setAiPanelOpen((prev) => !prev);
  };

  const toggleFormatPanel = () => {
    if (readOnly) return;
    setFormatPanelOpen(!formatPanelOpen);
  };

  const openAiWithPrompt = (prompt?: string) => {
    if (readOnly) return;
    setAiPanelOpen(true);
    if (prompt) setQueuedAiPrompt(prompt);
  };

  // Global editor shortcuts: Esc (zen), Cmd/Ctrl+J (AI panel), Cmd/Ctrl+I (Format panel)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zenMode) {
        setZenMode(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j" && !readOnly) {
        e.preventDefault();
        if (e.shiftKey) {
          setInlineAiOpen((prev) => !prev);
        } else {
          toggleAiPanel();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i" && !readOnly) {
        e.preventDefault();
        toggleFormatPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zenMode, formatPanelOpen, readOnly]);

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden font-sans ${
        isDark ? "bg-[#101114]" : "bg-[#ffffff]"
      }`}
    >
      <TopToolbar
        isDark={isDark}
        accountControl={accountControl}
        aiOpen={aiPanelOpen}
        readOnly={readOnly}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onToggleAi={toggleAiPanel}
        onToggleFormat={toggleFormatPanel}
        onOpenExport={() => setExportOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {!readOnly && (
          <AiChatPanel
            open={aiPanelOpen && !zenMode}
            isDark={isDark}
            layout={layout}
            queuedPrompt={queuedAiPrompt}
            onConsumeQueuedPrompt={() => setQueuedAiPrompt(undefined)}
            onClose={() => setAiPanelOpen(false)}
          />
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {viewMode === "canvas" ? (
            <>
              <HybridCanvas
                viewportRef={viewportRef}
                appearance={chromeTheme}
                layout={layout}
                onOpenContextMenu={(topicId, pos) => setContextMenu({ topicId, ...pos })}
                onOpenAi={() => openAiWithPrompt()}
              />
              {!readOnly && (
                <>
                  <CanvasDock isDark={isDark} onOpenInlineAi={() => setInlineAiOpen((v) => !v)} />
                  <InlineAiBar
                    open={inlineAiOpen}
                    isDark={isDark}
                    onClose={() => setInlineAiOpen(false)}
                    onContinueInPanel={(p) => openAiWithPrompt(p)}
                  />
                </>
              )}
              <Minimap layout={layout} appearance={chromeTheme} />
              {!zenMode && <ShortcutsHelp isDark={isDark} />}
            </>
          ) : (
            <OutlinerView />
          )}
        </div>

        {!readOnly && <FormatPanel isDark={isDark} />}
      </div>

      <SheetBar layout={layout} isDark={isDark} viewportRef={viewportRef} />

      <ContextMenu
        menu={contextMenu}
        isDark={isDark}
        onClose={() => setContextMenu(null)}
        onOpenAiForTopic={readOnly ? undefined : () => setInlineAiOpen(true)}
      />
      <TemplateModal open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} layout={exportLayout} />
      <CommandK
        open={cmdkOpen}
        isDark={isDark}
        onOpenChange={setCmdkOpen}
        layout={layout}
        onOpenAi={readOnly ? undefined : (p) => openAiWithPrompt(p)}
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
  initialFormatPanelOpen = false,
  initialAiPrompt,
  initialRightPanel,
  readOnly = false,
}) => {
  const storeRef = useRef<StoreApi<MindmapStoreState> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createMindmapStore(adapter ?? initialDoc ?? getTemplate("blank-organic").create());
    storeRef.current.getState().setFormatPanelOpen(initialFormatPanelOpen);
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
      <MindmapEditorInner
        accountControl={accountControl}
        chromeTheme={chromeTheme}
        initialAiPrompt={initialAiPrompt}
        initialRightPanel={initialRightPanel}
        readOnly={readOnly}
      />
    </MindmapStoreContext.Provider>
  );
};
