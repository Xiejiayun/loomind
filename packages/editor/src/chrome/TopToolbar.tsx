import React from "react";
import {
  Download,
  GitBranch,
  ListTree,
  Maximize2,
  PanelRight,
  Play,
  Redo2,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";

interface TopToolbarProps {
  isDark: boolean;
  accountControl?: React.ReactNode;
  leftPanel?: "none" | "ai" | "outline";
  readOnly?: boolean;
  onToggleAi?: () => void;
  onToggleOutlineSidebar?: () => void;
  onToggleFormat?: () => void;
  onOpenExport?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  isDark,
  accountControl,
  leftPanel = "none",
  readOnly = false,
  onToggleAi,
  onToggleOutlineSidebar,
  onToggleFormat,
  onOpenExport,
}) => {
  const viewMode = useMindmapStore((s) => s.viewMode);
  const setViewMode = useMindmapStore((s) => s.setViewMode);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const setZenMode = useMindmapStore((s) => s.setZenMode);
  const setPitchMode = useMindmapStore((s) => s.setPitchMode);
  const formatPanelOpen = useMindmapStore((s) => s.formatPanelOpen);
  const setFormatPanelOpen = useMindmapStore((s) => s.setFormatPanelOpen);
  const canUndo = useMindmapStore((s) => s.canUndo);
  const canRedo = useMindmapStore((s) => s.canRedo);
  const undo = useMindmapStore((s) => s.undo);
  const redo = useMindmapStore((s) => s.redo);
  const { t } = useEditorI18n();

  const focusCls = isDark
    ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b0c0e]"
    : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/30 focus-visible:ring-offset-1 focus-visible:ring-offset-white";

  if (zenMode) {
    return (
      <button
        type="button"
        onClick={() => setZenMode(false)}
        className={`fixed right-4 top-3 z-50 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur ${focusCls} ${
          isDark
            ? "border-white/[0.12] bg-[#15171c]/95 text-[#f4f5f8] hover:bg-[#1c1f26]"
            : "border-slate-900/[0.12] bg-white/95 text-[#111318] hover:bg-slate-50"
        }`}
      >
        {t.toolbar.exitZen}
      </button>
    );
  }

  const hoverCls = isDark
    ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-[#f4f5f8]"
    : "text-[#525b6b] hover:bg-slate-900/[0.05] hover:text-[#111318]";

  const borderBtnCls = isDark
    ? "border-white/[0.08] bg-transparent text-[#d5d9e2] hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
    : "border-slate-900/[0.1] bg-white text-[#2c3340] hover:border-slate-900/[0.18] hover:bg-slate-50";

  return (
    <header
      className={`flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3 text-xs transition-colors ${
        isDark
          ? "border-white/[0.075] bg-[#0b0c0e] text-[#f4f5f8]"
          : "border-slate-900/[0.08] bg-[#f7f8fa] text-[#111318]"
      }`}
    >
      {/* Left: Account / Navigation + Left AI Chat / Outline Sidebar Toggles */}
      <div className="flex min-w-0 items-center gap-1.5">
        {accountControl}
        {onToggleAi && !readOnly && (
          <button
            type="button"
            onClick={onToggleAi}
            title={t.toolbar.toggleAiTitle}
            className={`flex shrink-0 items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11.5px] font-medium transition ${focusCls} ${
              leftPanel === "ai"
                ? isDark
                  ? "border-white/[0.14] bg-white/[0.1] text-[#f4f5f8]"
                  : "border-slate-900/[0.14] bg-slate-900/[0.08] text-[#111318]"
                : borderBtnCls
            }`}
          >
            <Sparkles className="h-3 w-3 opacity-80" />
            <span>{t.toolbar.chat}</span>
          </button>
        )}
        {onToggleOutlineSidebar && viewMode === "canvas" && (
          <button
            type="button"
            onClick={onToggleOutlineSidebar}
            title={t.toolbar.toggleOutlineTitle}
            className={`flex shrink-0 items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11.5px] font-medium transition ${focusCls} ${
              leftPanel === "outline"
                ? isDark
                  ? "border-white/[0.14] bg-white/[0.1] text-[#f4f5f8]"
                  : "border-slate-900/[0.14] bg-slate-900/[0.08] text-[#111318]"
                : borderBtnCls
            }`}
          >
            <ListTree className="h-3 w-3 opacity-80" />
            <span className="hidden sm:inline">{t.toolbar.outlineSidebar}</span>
          </button>
        )}
      </div>

      {/* Center: Back-to-Map (when in fullscreen outline) + Undo/Redo */}
      <div className="flex items-center gap-1.5">
        {viewMode === "outline" && (
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            className={`flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[11.5px] font-medium transition ${borderBtnCls} ${focusCls}`}
          >
            <GitBranch className="h-3 w-3" /> {t.outliner.backToMap}
          </button>
        )}

        {!readOnly && (
          <>
            {viewMode === "outline" && (
              <div className={`h-3.5 w-px ${isDark ? "bg-white/[0.08]" : "bg-slate-900/[0.1]"}`} />
            )}
            <button
              type="button"
              disabled={!canUndo}
              onClick={undo}
              className={`rounded-[5px] p-1.5 disabled:opacity-30 ${hoverCls} ${focusCls}`}
              title={t.toolbar.undo}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={redo}
              className={`rounded-[5px] p-1.5 disabled:opacity-30 ${hoverCls} ${focusCls}`}
              title={t.toolbar.redo}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Right: Pitch / Zen / Export / Format */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPitchMode(true)}
          className={`hidden items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px] font-medium md:inline-flex ${hoverCls} ${focusCls}`}
          title={t.toolbar.pitchTitle}
        >
          <Play className="h-3 w-3" /> {t.toolbar.pitch}
        </button>

        <button
          type="button"
          onClick={() => setZenMode(true)}
          className={`hidden rounded-[5px] p-1.5 sm:inline-flex ${hoverCls} ${focusCls}`}
          title={t.toolbar.zenTitle}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>

        {onOpenExport && (
          <button
            type="button"
            onClick={onOpenExport}
            className={`flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[11.5px] font-medium ${borderBtnCls} ${focusCls}`}
          >
            <Download className="h-3 w-3" />
            <span className="hidden sm:inline">{t.toolbar.export}</span>
          </button>
        )}

        {!readOnly && viewMode === "canvas" && (
          <button
            type="button"
            onClick={() => (onToggleFormat ? onToggleFormat() : setFormatPanelOpen(!formatPanelOpen))}
            className={`flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px] font-medium transition ${focusCls} ${
              formatPanelOpen
                ? isDark
                  ? "bg-white/[0.1] text-white"
                  : "bg-slate-900/[0.08] text-[#111318]"
                : hoverCls
            }`}
            title={t.toolbar.formatTitle}
          >
            <PanelRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.toolbar.format}</span>
          </button>
        )}
      </div>
    </header>
  );
};
