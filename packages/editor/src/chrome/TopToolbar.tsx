import React from "react";
import {
  Download,
  GitBranch,
  LayoutGrid,
  ListTree,
  Maximize2,
  PanelRight,
  Play,
  Redo2,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useMindmapStore } from "../context.js";

interface TopToolbarProps {
  isDark: boolean;
  accountControl?: React.ReactNode;
  aiOpen?: boolean;
  readOnly?: boolean;
  onOpenTemplates: () => void;
  onToggleAi?: () => void;
  onToggleFormat?: () => void;
  onOpenExport?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  isDark,
  accountControl,
  aiOpen = false,
  readOnly = false,
  onOpenTemplates,
  onToggleAi,
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
        退出禅模式 (Esc)
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
      {/* Left: Account / Navigation + Left AI Chat Toggle */}
      <div className="flex min-w-0 items-center gap-2">
        {accountControl}
        {onToggleAi && !readOnly && (
          <button
            type="button"
            onClick={onToggleAi}
            title="展开/收起左侧 AI 对话 (⌘J)"
            className={`flex shrink-0 items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11.5px] font-medium transition ${focusCls} ${
              aiOpen
                ? isDark
                  ? "border-white/[0.14] bg-white/[0.1] text-[#f4f5f8]"
                  : "border-slate-900/[0.14] bg-slate-900/[0.08] text-[#111318]"
                : borderBtnCls
            }`}
          >
            <Sparkles className="h-3 w-3 opacity-80" />
            <span>对话</span>
          </button>
        )}
      </div>

      {/* Center: View Switcher + Undo/Redo + Templates */}
      <div className="flex items-center gap-1.5">
        <div
          className={`editor-view-switch flex items-center rounded-[6px] border p-0.5 ${
            isDark ? "border-white/[0.075] bg-[#15171c]" : "border-slate-900/[0.08] bg-slate-200/60"
          }`}
        >
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            className={`flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11.5px] font-medium transition ${focusCls} ${
              viewMode === "canvas"
                ? isDark
                  ? "bg-[#22262f] text-white"
                  : "bg-white text-[#111318] shadow-2xs"
                : isDark
                  ? "text-[#9ca3b0] hover:text-white"
                  : "text-[#525b6b] hover:text-[#111318]"
            }`}
          >
            <GitBranch className="h-3 w-3" /> 导图
          </button>
          <button
            type="button"
            onClick={() => setViewMode("outline")}
            className={`flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11.5px] font-medium transition ${focusCls} ${
              viewMode === "outline"
                ? isDark
                  ? "bg-[#22262f] text-white"
                  : "bg-white text-[#111318] shadow-2xs"
                : isDark
                  ? "text-[#9ca3b0] hover:text-white"
                  : "text-[#525b6b] hover:text-[#111318]"
            }`}
          >
            <ListTree className="h-3 w-3" /> 大纲
          </button>
        </div>

        {!readOnly && (
          <>
            <div className={`h-3.5 w-px ${isDark ? "bg-white/[0.08]" : "bg-slate-900/[0.1]"}`} />
            <button
              type="button"
              disabled={!canUndo}
              onClick={undo}
              className={`rounded-[5px] p-1.5 disabled:opacity-30 ${hoverCls} ${focusCls}`}
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={redo}
              className={`rounded-[5px] p-1.5 disabled:opacity-30 ${hoverCls} ${focusCls}`}
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenTemplates}
              className={`hidden items-center gap-1 rounded-[5px] border px-2 py-1 text-[11.5px] font-medium sm:inline-flex ${borderBtnCls} ${focusCls}`}
            >
              <LayoutGrid className="h-3 w-3 opacity-75" /> 模板
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
          title="演说模式"
        >
          <Play className="h-3 w-3" /> 演说
        </button>

        <button
          type="button"
          onClick={() => setZenMode(true)}
          className={`hidden rounded-[5px] p-1.5 sm:inline-flex ${hoverCls} ${focusCls}`}
          title="禅模式"
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
            <span className="hidden sm:inline">导出</span>
          </button>
        )}

        {!readOnly && (
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
            title="格式面板 (⌘I)"
          >
            <PanelRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">格式</span>
          </button>
        )}
      </div>
    </header>
  );
};
