import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Sparkles, X } from "lucide-react";
import type { StoreApi } from "zustand";
import {
  createMindmapStore,
  getPalette,
  getTemplate,
  LayoutEngine,
  setLocale,
  type Locale,
  type MindmapDocument,
  type MindmapStoreState,
  type SyncAdapter,
} from "@mindmap/core";
import { DomTextMeasurer } from "./canvas/DomMeasurer.js";
import type { EditorAiRuntime } from "./ai-runtime.js";
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
import { TopToolbar } from "./chrome/TopToolbar.js";
import { MindmapStoreContext, useMindmapStore } from "./context.js";
import { useEditorI18n } from "./i18n.js";
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
  locale?: Locale;
  aiRuntime?: EditorAiRuntime;
}

const MindmapEditorInner: React.FC<
  Pick<MindmapEditorProps, "accountControl" | "chromeTheme" | "initialAiPrompt" | "initialRightPanel" | "readOnly" | "aiRuntime">
> = ({ accountControl, chromeTheme, initialAiPrompt, initialRightPanel, readOnly = false, aiRuntime }) => {
  const doc = useMindmapStore((s) => s.doc);
  const drillRootId = useMindmapStore((s) => s.drillRootId);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const setViewMode = useMindmapStore((s) => s.setViewMode);
  const camera = useMindmapStore((s) => s.camera);
  const setCamera = useMindmapStore((s) => s.setCamera);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const setZenMode = useMindmapStore((s) => s.setZenMode);
  const formatPanelOpen = useMindmapStore((s) => s.formatPanelOpen);
  const setFormatPanelOpen = useMindmapStore((s) => s.setFormatPanelOpen);
  const lastRejection = useMindmapStore((s) => s.lastRejection);
  const clearRejection = useMindmapStore((s) => s.clearRejection);
  const { t } = useEditorI18n();

  useEffect(() => {
    if (!lastRejection) return;
    const timer = setTimeout(() => clearRejection(), 3500);
    return () => clearTimeout(timer);
  }, [lastRejection, clearRejection]);

  const [leftPanel, setLeftPanel] = useState<"none" | "ai" | "outline">(() => {
    if (readOnly) return "none";
    if (initialAiPrompt || initialRightPanel === "ai") return "ai";
    return typeof window === "undefined" ? "ai" : window.innerWidth >= 900 ? "ai" : "none";
  });
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<string | undefined>(initialAiPrompt);
  const [inlineAiOpen, setInlineAiOpen] = useState(false);

  // Sync initial panels & mobile collapse
  useEffect(() => {
    if (readOnly) {
      setFormatPanelOpen(false);
      setLeftPanel((prev) => (prev === "ai" ? "none" : prev));
      return;
    }
    if (initialAiPrompt || initialRightPanel === "ai") {
      setLeftPanel("ai");
    } else if (typeof window !== "undefined" && window.innerWidth < 768) {
      setFormatPanelOpen(false);
    }
  }, [initialAiPrompt, initialRightPanel, readOnly, setFormatPanelOpen]);

  // Auto-collapse irrelevant right Format panel & duplicate left outline in fullscreen Outline mode
  useEffect(() => {
    if (viewMode === "outline") {
      setFormatPanelOpen(false);
      setLeftPanel((prev) => (prev === "outline" ? "none" : prev));
    }
  }, [viewMode, setFormatPanelOpen]);

  const activeSheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const isDark = chromeTheme
    ? chromeTheme === "dark"
    : getPalette({ ...doc.theme, ...activeSheet.theme }.paletteId).isDark;

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
    setLeftPanel((prev) => (prev === "ai" ? "none" : "ai"));
  };

  const toggleOutlineSidebar = () => {
    if (viewMode === "outline") {
      setViewMode("canvas");
      setLeftPanel("outline");
      return;
    }
    setLeftPanel((prev) => (prev === "outline" ? "none" : "outline"));
  };

  const toggleFormatPanel = () => {
    if (readOnly || viewMode !== "canvas") return;
    setFormatPanelOpen(!formatPanelOpen);
  };

  const openAiWithPrompt = (prompt?: string) => {
    if (readOnly) return;
    setLeftPanel("ai");
    if (prompt) setQueuedAiPrompt(prompt);
  };

  const focusTopicOnCanvas = useCallback(
    (topicId: string) => {
      const node = layout.nodes.get(topicId);
      if (!node) return;
      const rect = viewportRef.current?.getBoundingClientRect();
      const vw = Math.max(320, rect?.width ?? window.innerWidth - 360);
      const vh = Math.max(320, rect?.height ?? window.innerHeight - 80);
      setCamera({
        x: vw / 2 - (node.contentBox.x + node.contentBox.width / 2) * camera.scale,
        y: vh / 2 - (node.contentBox.y + node.contentBox.height / 2) * camera.scale,
      });
    },
    [layout, camera.scale, setCamera],
  );

  // Global editor shortcuts: Esc (zen), Cmd/Ctrl+J (AI), Cmd/Ctrl+O (Outline), Cmd/Ctrl+I (Format)
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
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        toggleOutlineSidebar();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i" && !readOnly && viewMode === "canvas") {
        e.preventDefault();
        toggleFormatPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zenMode, formatPanelOpen, readOnly, viewMode]);

  const showLeftSidebar = !zenMode && leftPanel !== "none" && !(leftPanel === "ai" && readOnly);
  const borderCls = isDark ? "border-white/[0.075]" : "border-slate-900/[0.08]";

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden font-sans ${
        isDark ? "bg-[#101114]" : "bg-[#ffffff]"
      }`}
    >
      <TopToolbar
        isDark={isDark}
        accountControl={accountControl}
        leftPanel={showLeftSidebar ? leftPanel : "none"}
        readOnly={readOnly}
        onToggleAi={toggleAiPanel}
        onToggleOutlineSidebar={toggleOutlineSidebar}
        onToggleFormat={toggleFormatPanel}
        onOpenExport={() => setExportOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {showLeftSidebar && (
          <aside
            className={`fixed left-0 top-11 bottom-8 z-40 flex w-[340px] max-w-[88vw] shrink-0 flex-col border-r text-[12.5px] shadow-2xl md:static md:h-full md:shadow-none ${
              isDark
                ? "border-white/[0.075] bg-[#121419] text-[#f4f5f8]"
                : "border-slate-900/[0.08] bg-[#fafbfc] text-[#111318]"
            }`}
            aria-label={leftPanel === "ai" ? t.aiChat.ariaLabel : t.outliner.title}
          >
            {/* Unified Left Panel Header: Chat | Outline switcher */}
            <div className={`flex h-10 shrink-0 items-center justify-between gap-2 border-b px-2.5 ${borderCls}`}>
              {!readOnly && viewMode === "canvas" ? (
                <div
                  className={`flex items-center rounded-[6px] border p-0.5 ${
                    isDark ? "border-white/[0.08] bg-[#0b0c0e]" : "border-slate-900/[0.08] bg-slate-200/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setLeftPanel("ai")}
                    className={`flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11.5px] font-medium transition ${
                      leftPanel === "ai"
                        ? isDark
                          ? "bg-[#22262f] text-white"
                          : "bg-white text-[#111318] shadow-2xs"
                        : isDark
                          ? "text-[#9ca3b0] hover:text-white"
                          : "text-[#525b6b] hover:text-[#111318]"
                    }`}
                  >
                    <Sparkles className="h-3 w-3" /> {t.toolbar.chat}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeftPanel("outline")}
                    className={`flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11.5px] font-medium transition ${
                      leftPanel === "outline"
                        ? isDark
                          ? "bg-[#22262f] text-white"
                          : "bg-white text-[#111318] shadow-2xs"
                        : isDark
                          ? "text-[#9ca3b0] hover:text-white"
                          : "text-[#525b6b] hover:text-[#111318]"
                    }`}
                  >
                    <ListTree className="h-3 w-3" /> {t.toolbar.outlineSidebar}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-1 text-xs font-medium">
                  {leftPanel === "ai" ? (
                    <>
                      <Sparkles className="h-3.5 w-3.5 opacity-75" />
                      <span>{t.aiChat.title}</span>
                    </>
                  ) : (
                    <>
                      <ListTree className="h-3.5 w-3.5 opacity-75" />
                      <span>{t.outliner.title}</span>
                    </>
                  )}
                </div>
              )}

              <button
                type="button"
                aria-label={t.outliner.closeSidebarAria}
                onClick={() => setLeftPanel("none")}
                className={`inline-grid h-6 w-6 place-items-center rounded-[5px] transition ${
                  isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-100"
                }`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {leftPanel === "ai" && !readOnly ? (
              <AiChatPanel
                open
                embedded
                isDark={isDark}
                layout={layout}
                queuedPrompt={queuedAiPrompt}
                aiRuntime={aiRuntime}
                onConsumeQueuedPrompt={() => setQueuedAiPrompt(undefined)}
                onClose={() => setLeftPanel("none")}
              />
            ) : (
              <OutlinerView
                variant="sidebar"
                isDark={isDark}
                readOnly={readOnly}
                onSelectTopic={focusTopicOnCanvas}
                onExpandFullscreen={() => {
                  setLeftPanel("none");
                  setFormatPanelOpen(false);
                  setViewMode("outline");
                }}
              />
            )}
          </aside>
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
                    aiRuntime={aiRuntime}
                    onClose={() => setInlineAiOpen(false)}
                    onContinueInPanel={(p) => openAiWithPrompt(p)}
                  />
                </>
              )}
              <Minimap layout={layout} appearance={chromeTheme} />
              {!zenMode && <ShortcutsHelp isDark={isDark} />}
            </>
          ) : (
            <OutlinerView variant="full" isDark={isDark} readOnly={readOnly} />
          )}
        </div>

        {!readOnly && viewMode === "canvas" && <FormatPanel isDark={isDark} />}
      </div>

      <SheetBar layout={layout} isDark={isDark} viewportRef={viewportRef} />

      <ContextMenu
        menu={contextMenu}
        isDark={isDark}
        onClose={() => setContextMenu(null)}
        onOpenAiForTopic={readOnly ? undefined : () => setInlineAiOpen(true)}
      />
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} layout={exportLayout} />
      <CommandK
        open={cmdkOpen}
        isDark={isDark}
        onOpenChange={setCmdkOpen}
        layout={layout}
        onOpenAi={readOnly ? undefined : (p) => openAiWithPrompt(p)}
      />
      <PitchOverlay />
      {lastRejection && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-12 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-amber-300/60 bg-amber-50/95 px-3.5 py-2 text-xs font-medium text-amber-950 shadow-lg backdrop-blur dark:border-amber-500/40 dark:bg-amber-950/90 dark:text-amber-100"
        >
          {lastRejection.message}
        </div>
      )}
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
  locale,
  aiRuntime,
}) => {
  useEffect(() => {
    if (locale) setLocale(locale);
  }, [locale]);

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
        aiRuntime={aiRuntime}
      />
    </MindmapStoreContext.Provider>
  );
};
