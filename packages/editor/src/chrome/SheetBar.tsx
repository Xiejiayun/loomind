import React, { useState } from "react";
import { Map, Maximize, Minus, Plus, X } from "lucide-react";
import { createSheet, generateId, type MindmapLayoutResult } from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface SheetBarProps {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  isDark: boolean;
  layout: MindmapLayoutResult;
}

export const SheetBar: React.FC<SheetBarProps> = ({ layout, isDark, viewportRef }) => {
  const doc = useMindmapStore((s) => s.doc);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const camera = useMindmapStore((s) => s.camera);
  const setCamera = useMindmapStore((s) => s.setCamera);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const minimapOpen = useMindmapStore((s) => s.minimapOpen);
  const setMinimapOpen = useMindmapStore((s) => s.setMinimapOpen);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  if (zenMode) return null;

  const handleAddSheet = () => {
    const id = generateId("sheet", new Set(doc.deletedIds));
    const idx = doc.sheets.length + 1;
    dispatch({ type: "sheet/add", sheet: createSheet(id, `画布 ${idx}`) });
  };

  const handleFitView = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { width: vw, height: vh } = viewport.getBoundingClientRect();
    const scaleX = (vw - 72) / Math.max(160, layout.bounds.width);
    const scaleY = (vh - 72) / Math.max(120, layout.bounds.height);
    const scale = Math.max(0.25, Math.min(1.6, Math.min(scaleX, scaleY)));
    const cx = layout.bounds.x + layout.bounds.width / 2;
    const cy = layout.bounds.y + layout.bounds.height / 2;
    setCamera({
      scale,
      x: vw / 2 - cx * scale,
      y: vh / 2 - cy * scale,
    });
  };

  return (
    <footer
      className={`flex h-8 shrink-0 items-center justify-between border-t px-2.5 text-[11px] transition-colors ${
        isDark
          ? "border-white/[0.075] bg-[#0b0c0e] text-[#9ca3b0]"
          : "border-slate-900/[0.08] bg-[#f7f8fa] text-[#525b6b]"
      }`}
    >
      {/* Multi-sheet tabs */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {doc.sheets.map((s) => {
          const active = s.id === doc.activeSheetId;
          return (
            <div
              key={s.id}
              onClick={() => dispatch({ type: "sheet/switch", sheetId: s.id })}
              onDoubleClick={() => {
                setRenamingId(s.id);
                setRenameText(s.title);
              }}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-[5px] px-2 py-0.5 transition ${
                active
                  ? isDark
                    ? "bg-[#1c1f26] font-medium text-[#f4f5f8]"
                    : "bg-white font-medium text-[#111318] shadow-2xs ring-1 ring-slate-900/10"
                  : isDark
                    ? "text-[#9ca3b0] hover:bg-white/[0.05] hover:text-[#f4f5f8]"
                    : "text-[#525b6b] hover:bg-slate-900/[0.04] hover:text-[#111318]"
              }`}
            >
              {renamingId === s.id ? (
                <input
                  value={renameText}
                  autoFocus
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => {
                    dispatch({ type: "sheet/rename", sheetId: s.id, title: renameText || s.title });
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      dispatch({ type: "sheet/rename", sheetId: s.id, title: renameText || s.title });
                      setRenamingId(null);
                    }
                  }}
                  className="w-20 rounded border border-white/30 bg-transparent px-1 text-[11px] outline-none"
                />
              ) : (
                <span>{s.title}</span>
              )}
              {doc.sheets.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "sheet/remove", sheetId: s.id });
                  }}
                  className="opacity-0 hover:text-red-400 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={handleAddSheet}
          className={`rounded p-1 transition ${isDark ? "hover:bg-white/[0.07] hover:text-white" : "hover:bg-slate-900/[0.06]"}`}
          title="新建画布"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Right: Zoom & Minimap (Canvas mode only) */}
      {viewMode === "canvas" ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCamera({ scale: Math.max(0.15, camera.scale - 0.15) })}
            className={`rounded p-1 transition ${isDark ? "hover:bg-white/[0.07] hover:text-white" : "hover:bg-slate-900/[0.06]"}`}
            title="缩小"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setCamera({ scale: 1 })}
            className="w-10 text-center font-mono text-[11px] hover:underline"
            title="重置 100%"
          >
            {Math.round(camera.scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setCamera({ scale: Math.min(3, camera.scale + 0.15) })}
            className={`rounded p-1 transition ${isDark ? "hover:bg-white/[0.07] hover:text-white" : "hover:bg-slate-900/[0.06]"}`}
            title="放大"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleFitView}
            className={`rounded p-1 transition ${isDark ? "hover:bg-white/[0.07] hover:text-white" : "hover:bg-slate-900/[0.06]"}`}
            title="适应画布"
          >
            <Maximize className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setMinimapOpen(!minimapOpen)}
            className={`rounded p-1 transition ${
              minimapOpen
                ? isDark
                  ? "bg-white/[0.12] text-white"
                  : "bg-slate-900/[0.1] text-[#111318]"
                : isDark
                  ? "hover:bg-white/[0.07] hover:text-white"
                  : "hover:bg-slate-900/[0.06]"
            }`}
            title="小地图"
          >
            <Map className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="text-[11px] opacity-60">大纲写作模式</div>
      )}
    </footer>
  );
};
