import React, { useState } from "react";
import { Map, Maximize, Minus, Plus, X } from "lucide-react";
import { createSheet, generateId, type MindmapLayoutResult } from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface SheetBarProps {
  layout: MindmapLayoutResult;
}

export const SheetBar: React.FC<SheetBarProps> = ({ layout }) => {
  const doc = useMindmapStore((s) => s.doc);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const camera = useMindmapStore((s) => s.camera);
  const setCamera = useMindmapStore((s) => s.setCamera);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const formatPanelOpen = useMindmapStore((s) => s.formatPanelOpen);
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
    const vw = window.innerWidth - (formatPanelOpen ? 280 : 0);
    const vh = window.innerHeight - 76;
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
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-2 text-xs text-slate-600">
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
              className={`group flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 transition ${
                active
                  ? "bg-white font-semibold text-slate-900 shadow-xs"
                  : "text-slate-500 hover:bg-slate-200/60"
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
                  className="w-20 rounded border border-blue-400 px-1 text-xs outline-none"
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
                  className="opacity-0 hover:text-red-500 group-hover:opacity-100"
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
          className="rounded p-1 hover:bg-slate-200"
          title="新建画布"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Right: Zoom & Minimap (Canvas mode only) */}
      {viewMode === "canvas" ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCamera({ scale: Math.max(0.15, camera.scale - 0.15) })}
            className="rounded p-1 hover:bg-slate-200"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setCamera({ scale: 1 })}
            className="w-11 text-center font-mono text-[11px] hover:underline"
            title="重置 100%"
          >
            {Math.round(camera.scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setCamera({ scale: Math.min(3, camera.scale + 0.15) })}
            className="rounded p-1 hover:bg-slate-200"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleFitView}
            className="rounded p-1 hover:bg-slate-200"
            title="适应画布"
          >
            <Maximize className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setMinimapOpen(!minimapOpen)}
            className={`rounded p-1 ${minimapOpen ? "bg-blue-100 text-blue-600" : "hover:bg-slate-200"}`}
            title="小地图"
          >
            <Map className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="text-[11px] text-slate-400">大纲写作模式</div>
      )}
    </footer>
  );
};
