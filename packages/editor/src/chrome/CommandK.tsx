import React, { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { GitBranch, ListTree, Maximize, Palette, Play, Search, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import {
  collectAllTopics,
  getPaletteLabel,
  PALETTE_LIST,
  richTextToPlainText,
  type MindmapLayoutResult,
  type MindmapStructure,
} from "@mindmap/core";
import { computeFitCameraForBounds, resetZoomCentered, stepZoomCamera } from "../canvas/viewport-camera.js";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";

interface CommandKProps {
  open: boolean;
  isDark?: boolean;
  onOpenChange: (open: boolean) => void;
  layout: MindmapLayoutResult;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  onOpenFind?: () => void;
  onOpenAi?: (initialPrompt?: string) => void;
}

const STRUCTURE_IDS: MindmapStructure[] = [
  "mindmap",
  "logic",
  "org",
  "brace",
  "indented",
  "timeline",
  "fishbone",
  "treeTable",
  "matrix",
];

export const CommandK: React.FC<CommandKProps> = ({
  open,
  isDark = false,
  onOpenChange,
  layout,
  viewportRef,
  onOpenFind,
  onOpenAi,
}) => {
  const doc = useMindmapStore((s) => s.doc);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const setCamera = useMindmapStore((s) => s.setCamera);
  const setViewMode = useMindmapStore((s) => s.setViewMode);
  const setPitchMode = useMindmapStore((s) => s.setPitchMode);
  const camera = useMindmapStore((s) => s.camera);
  const { locale, t } = useEditorI18n();
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const sheet = useMemo(
    () => doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0],
    [doc],
  );
  const topics = useMemo(() => Array.from(collectAllTopics(sheet).values()), [sheet]);

  if (!open) return null;

  const jumpToTopic = (topicId: string) => {
    selectTopics([topicId]);
    const node = layout.nodes.get(topicId);
    if (node) {
      const vw = window.innerWidth - 360;
      const vh = window.innerHeight - 80;
      setCamera({
        x: vw / 2 - (node.contentBox.x + node.contentBox.width / 2) * camera.scale,
        y: vh / 2 - (node.contentBox.y + node.contentBox.height / 2) * camera.scale,
      });
    }
    onOpenChange(false);
  };

  const itemCls = isDark
    ? "flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[#d5d9e2] aria-selected:bg-white/[0.08] aria-selected:text-white"
    : "flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[#2c3340] aria-selected:bg-slate-900/[0.06] aria-selected:text-[#111318]";

  const headingCls = isDark
    ? "mb-1.5 px-1 text-[10px] font-medium tracking-wider text-[#646b78] uppercase"
    : "mb-1.5 px-1 text-[10px] font-medium tracking-wider text-[#8c95a4] uppercase";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center pt-[14vh] backdrop-blur-[2px] ${
        isDark ? "bg-black/60" : "bg-slate-950/35"
      }`}
      onClick={() => onOpenChange(false)}
    >
      <div
        className={`w-[540px] max-w-[92vw] overflow-hidden rounded-[10px] border shadow-2xl ${
          isDark
            ? "border-white/[0.12] bg-[#15171c] text-[#f4f5f8]"
            : "border-slate-900/[0.12] bg-white text-[#111318]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label={t.cmdk.ariaLabel}>
          <div
            className={`flex items-center border-b px-3.5 ${
              isDark ? "border-white/[0.075]" : "border-slate-900/[0.08]"
            }`}
          >
            <Search className="mr-2.5 h-4 w-4 shrink-0 text-[#646b78]" />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={t.cmdk.placeholder}
              className={`h-11 w-full bg-transparent text-[13px] outline-none ${
                isDark
                  ? "text-[#f4f5f8] placeholder:text-[#646b78]"
                  : "text-[#111318] placeholder:text-[#8c95a4]"
              }`}
            />
            <kbd
              className={`ml-2 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                isDark
                  ? "border-white/[0.1] bg-[#1c1f26] text-[#9ca3b0]"
                  : "border-slate-900/[0.1] bg-[#f7f8fa] text-[#525b6b]"
              }`}
            >
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-1.5 text-[12px]">
            <Command.Empty className="py-6 text-center text-[#646b78]">{t.cmdk.empty}</Command.Empty>

            {onOpenAi && search.trim() && (
              <Command.Group heading={t.cmdk.groupAi} className={headingCls}>
                <Command.Item
                  value={`ai ask ${search}`}
                  onSelect={() => {
                    onOpenAi(search.trim());
                    onOpenChange(false);
                  }}
                  className={itemCls}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-75" />
                  <span className="truncate">{t.cmdk.askAi(search.trim())}</span>
                </Command.Item>
              </Command.Group>
            )}

            <Command.Group heading={t.cmdk.groupTopics} className={headingCls}>
              {topics.map((t) => {
                const text = richTextToPlainText(t.title);
                const extra = [t.subtitle, t.note?.text, ...(t.labels ?? [])].filter(Boolean).join(" ");
                return (
                  <Command.Item
                    key={t.id}
                    value={`${text} ${extra}`}
                    onSelect={() => jumpToTopic(t.id)}
                    className={`${itemCls} justify-between`}
                  >
                    <span className="truncate font-medium">{text}</span>
                    {t.labels && t.labels.length > 0 && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${
                          isDark ? "bg-white/[0.07] text-[#9ca3b0]" : "bg-slate-100 text-[#525b6b]"
                        }`}
                      >
                        {t.labels[0]}
                      </span>
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group heading={t.cmdk.groupActions} className={headingCls}>
              {onOpenFind && (
                <Command.Item
                  onSelect={() => {
                    onOpenFind();
                    onOpenChange(false);
                  }}
                  className={itemCls}
                >
                  <Search className="h-3.5 w-3.5" /> {t.cmdk.findReplace}
                </Command.Item>
              )}
              {onOpenAi && (
                <Command.Item
                  onSelect={() => {
                    onOpenAi();
                    onOpenChange(false);
                  }}
                  className={itemCls}
                >
                  <Sparkles className="h-3.5 w-3.5 opacity-75" /> {t.cmdk.openAiPanel}
                </Command.Item>
              )}
              <Command.Item
                onSelect={() => {
                  setViewMode("outline");
                  onOpenChange(false);
                }}
                className={itemCls}
              >
                <ListTree className="h-3.5 w-3.5" /> {t.cmdk.switchOutline}
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  setPitchMode(true);
                  onOpenChange(false);
                }}
                className={itemCls}
              >
                <Play className="h-3.5 w-3.5" /> {t.cmdk.enterPitch}
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  const rect = viewportRef?.current?.getBoundingClientRect();
                  const vw = rect?.width || window.innerWidth;
                  const vh = rect?.height || window.innerHeight;
                  setCamera(computeFitCameraForBounds(layout.bounds, vw, vh));
                  onOpenChange(false);
                }}
                className={itemCls}
              >
                <Maximize className="h-3.5 w-3.5" /> {t.cmdk.fitView}
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  const rect = viewportRef?.current?.getBoundingClientRect();
                  const vw = rect?.width || window.innerWidth;
                  const vh = rect?.height || window.innerHeight;
                  setCamera(stepZoomCamera(camera, "in", vw, vh));
                  onOpenChange(false);
                }}
                className={itemCls}
              >
                <ZoomIn className="h-3.5 w-3.5" /> {t.cmdk.zoomIn}
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  const rect = viewportRef?.current?.getBoundingClientRect();
                  const vw = rect?.width || window.innerWidth;
                  const vh = rect?.height || window.innerHeight;
                  setCamera(stepZoomCamera(camera, "out", vw, vh));
                  onOpenChange(false);
                }}
                className={itemCls}
              >
                <ZoomOut className="h-3.5 w-3.5" /> {t.cmdk.zoomOut}
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  const rect = viewportRef?.current?.getBoundingClientRect();
                  const vw = rect?.width || window.innerWidth;
                  const vh = rect?.height || window.innerHeight;
                  setCamera(resetZoomCentered(camera, vw, vh, 1));
                  onOpenChange(false);
                }}
                className={itemCls}
              >
                <Maximize className="h-3.5 w-3.5" /> {t.cmdk.resetZoom}
              </Command.Item>
            </Command.Group>

            <Command.Group heading={t.cmdk.groupStructure} className={headingCls}>
              {STRUCTURE_IDS.map((structureId) => (
                <Command.Item
                  key={structureId}
                  onSelect={() => {
                    dispatch({ type: "sheet/setLayout", sheetId: sheet.id, structure: structureId });
                    onOpenChange(false);
                  }}
                  className={itemCls}
                >
                  <GitBranch className="h-3.5 w-3.5" /> {t.cmdk.switchStructure(t.structures[structureId])}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading={t.cmdk.groupPalette} className={headingCls}>
              {PALETTE_LIST.map((p) => (
                <Command.Item
                  key={p.id}
                  onSelect={() => {
                    dispatch({ type: "theme/set", patch: { paletteId: p.id } });
                    onOpenChange(false);
                  }}
                  className={itemCls}
                >
                  <Palette className="h-3.5 w-3.5" /> {t.cmdk.switchPalette(getPaletteLabel(p.id, locale))}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
};
