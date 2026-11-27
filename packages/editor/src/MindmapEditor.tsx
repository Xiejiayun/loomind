import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  type PeerPresence,
  type SyncAdapter,
} from "@mindmap/core";
import { DomTextMeasurer } from "./canvas/DomMeasurer.js";
import type { AiChatMessage, AiChatPersistence, EditorAiRuntime } from "./ai-runtime.js";
import { HybridCanvas } from "./canvas/HybridCanvas.js";
import { Minimap } from "./canvas/Minimap.js";
import { AiChatPanel, type QueuedAiRequest } from "./chrome/AiChatPanel.js";
import type { NodeAiActionKind } from "@mindmap/ai";
import { CanvasDock } from "./chrome/CanvasDock.js";
import { CommandK } from "./chrome/CommandK.js";
import { ContextMenu } from "./chrome/ContextMenu.js";
import { ExportModal } from "./chrome/ExportModal.js";
import { findTopicsInSheet } from "./chrome/find-replace.js";
import { FindReplaceBar } from "./chrome/FindReplaceBar.js";
import { FormatPanel } from "./chrome/FormatPanel.js";
import { InlineAiBar } from "./chrome/InlineAiBar.js";
import { SheetBar } from "./chrome/SheetBar.js";
import { ShortcutsHelp } from "./chrome/ShortcutsHelp.js";
import { TopToolbar } from "./chrome/TopToolbar.js";
import { MindmapStoreContext, useMindmapStore } from "./context.js";
import { useEditorI18n } from "./i18n.js";
import { OutlinerView } from "./outline/OutlinerView.js";
import { PitchOverlay } from "./pitch/PitchOverlay.js";

const compactEditorQuery = "(width < 48rem)";
const isCompactEditor = () => window.matchMedia(compactEditorQuery).matches;
function subscribeToEditorWidth(notify: () => void) {
  const media = window.matchMedia(compactEditorQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

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
  chatPersistence?: AiChatPersistence;
  onAiMessagesChange?: (messages: AiChatMessage[]) => void;
  remotePeers?: PeerPresence[];
  onSelectionChange?: (topicIds: string[]) => void;
}

const MindmapEditorInner: React.FC<
  Pick<
    MindmapEditorProps,
    | "accountControl"
    | "chromeTheme"
    | "initialAiPrompt"
    | "initialRightPanel"
    | "readOnly"
    | "aiRuntime"
    | "chatPersistence"
    | "onAiMessagesChange"
    | "remotePeers"
  >
> = ({
  accountControl,
  chromeTheme,
  initialAiPrompt,
  initialRightPanel,
  readOnly = false,
  aiRuntime,
  chatPersistence,
  onAiMessagesChange,
  remotePeers,
}) => {
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
  const compact = useSyncExternalStore(subscribeToEditorWidth, isCompactEditor, () => false);
  const formatCoversLeft = compact && formatPanelOpen;
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
  const [queuedAiRequest, setQueuedAiRequest] = useState<QueuedAiRequest | undefined>(() =>
    initialAiPrompt ? { prompt: initialAiPrompt } : undefined,
  );
  const [inlineAiOpen, setInlineAiOpen] = useState(false);
  const canOpenAiPanel = !readOnly || Boolean(chatPersistence);

  // Sync initial panels & mobile collapse
  useEffect(() => {
    if (readOnly) {
      setFormatPanelOpen(false);
      if (!chatPersistence) {
        setLeftPanel((prev) => (prev === "ai" ? "none" : prev));
      }
      return;
    }
    if (initialAiPrompt || initialRightPanel === "ai") {
      setLeftPanel("ai");
    } else if (typeof window !== "undefined" && window.innerWidth < 768) {
      setFormatPanelOpen(false);
    }
  }, [initialAiPrompt, initialRightPanel, readOnly, chatPersistence, setFormatPanelOpen]);

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
  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ topicId: string; x: number; y: number } | null>(
    null,
  );

  const searchMatches = useMemo(
    () => (findOpen && findQuery ? findTopicsInSheet(activeSheet, findQuery, { caseSensitive: findCaseSensitive }) : []),
    [findOpen, findQuery, findCaseSensitive, activeSheet],
  );
  const searchMatchedIds = useMemo(() => new Set(searchMatches.map((m) => m.topicId)), [searchMatches]);
  const activeSearchMatchId =
    searchMatches.length > 0 ? searchMatches[Math.min(findActiveIndex, searchMatches.length - 1)].topicId : null;

  const engineRef = useRef<LayoutEngine | null>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  if (!engineRef.current) {
    engineRef.current = new LayoutEngine(new DomTextMeasurer());
  }

  // Prevent mobile browsers from triggering whole-page visual-viewport pinch zoom
  // when a multi-touch gesture starts near toolbars, dock, or canvas edges.
  useEffect(() => {
    const rootEl = editorRootRef.current;
    if (!rootEl) return;
    const blockMultiTouch = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    const blockGesture = (e: Event) => e.preventDefault();
    rootEl.addEventListener("touchmove", blockMultiTouch, { passive: false });
    rootEl.addEventListener("gesturestart", blockGesture, { passive: false });
    rootEl.addEventListener("gesturechange", blockGesture, { passive: false });
    rootEl.addEventListener("gestureend", blockGesture, { passive: false });
    return () => {
      rootEl.removeEventListener("touchmove", blockMultiTouch);
      rootEl.removeEventListener("gesturestart", blockGesture);
      rootEl.removeEventListener("gesturechange", blockGesture);
      rootEl.removeEventListener("gestureend", blockGesture);
    };
  }, []);

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
    if (!canOpenAiPanel) return;
    if (formatCoversLeft) setFormatPanelOpen(false);
    setLeftPanel((prev) => (prev === "ai" && !formatCoversLeft ? "none" : "ai"));
  };

  const toggleOutlineSidebar = () => {
    if (formatCoversLeft) setFormatPanelOpen(false);
    if (viewMode === "outline") {
      setViewMode("canvas");
      setLeftPanel("outline");
      return;
    }
    setLeftPanel((prev) => (prev === "outline" && !formatCoversLeft ? "none" : "outline"));
  };

  const toggleFormatPanel = () => {
    if (readOnly || viewMode !== "canvas") return;
    setFormatPanelOpen(!formatPanelOpen);
  };

  const openAiWithPrompt = (prompt?: string, action?: NodeAiActionKind) => {
    if (readOnly) return;
    if (formatCoversLeft) setFormatPanelOpen(false);
    setLeftPanel("ai");
    if (prompt) setQueuedAiRequest({ prompt, action });
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

  // Global editor shortcuts: Esc (zen), Cmd/Ctrl+F/H (Find/Replace), Cmd/Ctrl+J (AI), Cmd/Ctrl+O (Outline), Cmd/Ctrl+I (Format)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zenMode) {
        setZenMode(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setFindOpen(true);
        setShowReplace(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h" && !e.shiftKey && !e.altKey && !readOnly) {
        e.preventDefault();
        setFindOpen(true);
        setShowReplace(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j" && !readOnly) {
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
  }, [zenMode, formatPanelOpen, formatCoversLeft, canOpenAiPanel, readOnly, viewMode]);

  const showLeftSidebar = !zenMode && leftPanel !== "none" && !(leftPanel === "ai" && !canOpenAiPanel);

  return (
    <div
      ref={editorRootRef}
      className={`flex h-full w-full flex-col overflow-hidden overscroll-none touch-manipulation font-sans ${
        isDark ? "bg-[#101114]" : "bg-[#ffffff]"
      }`}
    >
      <TopToolbar
        isDark={isDark}
        accountControl={accountControl}
        leftPanel={showLeftSidebar && !formatCoversLeft ? leftPanel : "none"}
        readOnly={readOnly}
        onToggleAi={canOpenAiPanel ? toggleAiPanel : undefined}
        onToggleOutlineSidebar={toggleOutlineSidebar}
        onToggleFormat={toggleFormatPanel}
        onOpenExport={() => setExportOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {showLeftSidebar && (
          <aside
            className={`absolute inset-y-0 left-0 z-40 ${formatCoversLeft ? "hidden" : "flex"} w-[340px] max-w-full shrink-0 flex-col border-r text-[12.5px] shadow-2xl md:static md:h-full md:shadow-none ${
              isDark
                ? "border-white/[0.075] bg-[#121419] text-[#f4f5f8]"
                : "border-slate-900/[0.08] bg-[#fafbfc] text-[#111318]"
            }`}
            aria-label={leftPanel === "ai" ? t.aiChat.ariaLabel : t.outliner.title}
          >
            {leftPanel === "ai" && canOpenAiPanel ? (
              <AiChatPanel
                open
                embedded
                isDark={isDark}
                layout={layout}
                queuedRequest={queuedAiRequest}
                aiRuntime={aiRuntime}
                chatPersistence={chatPersistence}
                readOnly={readOnly}
                onConsumeQueuedPrompt={() => setQueuedAiRequest(undefined)}
                onMessagesChange={onAiMessagesChange}
                onClose={() => setLeftPanel("none")}
              />
            ) : (
              <OutlinerView
                variant="sidebar"
                isDark={isDark}
                readOnly={readOnly}
                onSelectTopic={focusTopicOnCanvas}
                onClose={() => setLeftPanel("none")}
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
                readOnly={readOnly}
                remotePeers={remotePeers}
                searchMatchedIds={searchMatchedIds}
                activeSearchMatchId={activeSearchMatchId}
                onOpenContextMenu={(topicId, pos) => setContextMenu({ topicId, ...pos })}
                onOpenAi={() => openAiWithPrompt()}
              />
              <FindReplaceBar
                open={findOpen}
                showReplace={showReplace}
                isDark={isDark}
                readOnly={readOnly}
                query={findQuery}
                replacement={replaceText}
                caseSensitive={findCaseSensitive}
                matches={searchMatches}
                activeIndex={findActiveIndex}
                onQueryChange={setFindQuery}
                onReplacementChange={setReplaceText}
                onToggleCaseSensitive={() => setFindCaseSensitive((v) => !v)}
                onToggleShowReplace={() => setShowReplace((v) => !v)}
                onActiveIndexChange={setFindActiveIndex}
                onFocusTopic={focusTopicOnCanvas}
                onClose={() => setFindOpen(false)}
              />
              {!readOnly && (
                <>
                  <CanvasDock isDark={isDark} onOpenInlineAi={() => setInlineAiOpen((v) => !v)} />
                  <InlineAiBar
                    open={inlineAiOpen}
                    isDark={isDark}
                    aiRuntime={aiRuntime}
                    onClose={() => setInlineAiOpen(false)}
                    onContinueInPanel={(p, action) => openAiWithPrompt(p, action)}
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

      <SheetBar layout={layout} isDark={isDark} viewportRef={viewportRef} readOnly={readOnly} />

      <ContextMenu
        menu={contextMenu}
        isDark={isDark}
        readOnly={readOnly}
        onClose={() => setContextMenu(null)}
        onOpenAiForTopic={readOnly ? undefined : () => setInlineAiOpen(true)}
      />
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} layout={exportLayout} />
      <CommandK
        open={cmdkOpen}
        isDark={isDark}
        onOpenChange={setCmdkOpen}
        layout={layout}
        viewportRef={viewportRef}
        onOpenFind={() => {
          setFindOpen(true);
          setShowReplace(!readOnly);
        }}
        onOpenAi={readOnly ? undefined : (p) => openAiWithPrompt(p)}
      />
      <PitchOverlay />
      {lastRejection && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-12 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-amber-300/60 bg-amber-50/95 px-3.5 py-2 text-xs font-medium text-amber-950 shadow-lg backdrop-blur dark:border-amber-500/40 dark:bg-amber-950/90 dark:text-amber-100"
        >
          {t.rejections[lastRejection.code] ?? lastRejection.message}
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
  chatPersistence,
  onAiMessagesChange,
  remotePeers,
  onSelectionChange,
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

  useEffect(() => {
    if (!onSelectionChange || !storeRef.current) return;
    let prevSel = storeRef.current.getState().selectedTopicIds;
    return storeRef.current.subscribe((state) => {
      if (state.selectedTopicIds !== prevSel) {
        prevSel = state.selectedTopicIds;
        onSelectionChange(state.selectedTopicIds);
      }
    });
  }, [onSelectionChange]);

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
        chatPersistence={chatPersistence}
        onAiMessagesChange={onAiMessagesChange}
        remotePeers={remotePeers}
      />
    </MindmapStoreContext.Provider>
  );
};
