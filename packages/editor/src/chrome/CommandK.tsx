import React, { useEffect, useMemo } from "react";
import { Command } from "cmdk";
import { GitBranch, ListTree, Palette, Play, Search, Sparkles } from "lucide-react";
import {
  collectAllTopics,
  PALETTE_LIST,
  richTextToPlainText,
  type MindmapLayoutResult,
  type MindmapStructure,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface CommandKProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: MindmapLayoutResult;
  onOpenAi?: () => void;
}

const STRUCTURE_ITEMS: Array<{ id: MindmapStructure; label: string }> = [
  { id: "mindmap", label: "思维导图" },
  { id: "logic", label: "逻辑图" },
  { id: "org", label: "组织结构图" },
  { id: "brace", label: "括号图" },
  { id: "indented", label: "缩进目录" },
  { id: "timeline", label: "时间轴" },
  { id: "fishbone", label: "鱼骨图" },
  { id: "treeTable", label: "树型表格" },
  { id: "matrix", label: "矩阵图" },
];

export const CommandK: React.FC<CommandKProps> = ({ open, onOpenChange, layout, onOpenAi }) => {
  const doc = useMindmapStore((s) => s.doc);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const setCamera = useMindmapStore((s) => s.setCamera);
  const setViewMode = useMindmapStore((s) => s.setViewMode);
  const setPitchMode = useMindmapStore((s) => s.setPitchMode);
  const camera = useMindmapStore((s) => s.camera);

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
      const vw = window.innerWidth - 280;
      const vh = window.innerHeight - 80;
      setCamera({
        x: vw / 2 - (node.contentBox.x + node.contentBox.width / 2) * camera.scale,
        y: vh / 2 - (node.contentBox.y + node.contentBox.height / 2) * camera.scale,
      });
    }
    onOpenChange(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/35 pt-20 backdrop-blur-xs"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-[540px] max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="全局命令与节点搜索">
          <div className="flex items-center border-b border-slate-100 px-3.5">
            <Search className="mr-2 h-4 w-4 text-slate-400" />
            <Command.Input
              autoFocus
              placeholder="搜索主题、备注、标签，或输入命令 (⌘K)..."
              className="h-11 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2 text-xs">
            <Command.Empty className="py-6 text-center text-slate-400">未找到匹配结果</Command.Empty>

            <Command.Group heading="跳转到主题" className="mb-2 text-[11px] font-semibold text-slate-400">
              {topics.map((t) => {
                const text = richTextToPlainText(t.title);
                const extra = [t.subtitle, t.note?.text, ...(t.labels ?? [])].filter(Boolean).join(" ");
                return (
                  <Command.Item
                    key={t.id}
                    value={`${text} ${extra}`}
                    onSelect={() => jumpToTopic(t.id)}
                    className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-slate-700 aria-selected:bg-blue-50 aria-selected:text-blue-700"
                  >
                    <span className="truncate font-medium">{text}</span>
                    {t.labels && t.labels.length > 0 && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {t.labels[0]}
                      </span>
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group heading="快捷动作" className="mb-2 text-[11px] font-semibold text-slate-400">
              <Command.Item
                onSelect={() => {
                  setViewMode("outline");
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-slate-700 aria-selected:bg-blue-50 aria-selected:text-blue-700"
              >
                <ListTree className="h-3.5 w-3.5" /> 切换至全屏大纲视图
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  setPitchMode(true);
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-slate-700 aria-selected:bg-blue-50 aria-selected:text-blue-700"
              >
                <Play className="h-3.5 w-3.5" /> 进入演说模式
              </Command.Item>
              {onOpenAi && (
                <Command.Item
                  onSelect={() => {
                    onOpenAi();
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-violet-700 aria-selected:bg-violet-50"
                >
                  <Sparkles className="h-3.5 w-3.5" /> 打开 AI 共创面板
                </Command.Item>
              )}
            </Command.Group>

            <Command.Group heading="切换画布结构" className="mb-2 text-[11px] font-semibold text-slate-400">
              {STRUCTURE_ITEMS.map((st) => (
                <Command.Item
                  key={st.id}
                  onSelect={() => {
                    dispatch({ type: "sheet/setLayout", sheetId: sheet.id, structure: st.id });
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-700 aria-selected:bg-blue-50 aria-selected:text-blue-700"
                >
                  <GitBranch className="h-3.5 w-3.5" /> 切换结构：{st.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="切换配色主题" className="text-[11px] font-semibold text-slate-400">
              {PALETTE_LIST.map((p) => (
                <Command.Item
                  key={p.id}
                  onSelect={() => {
                    dispatch({ type: "theme/set", patch: { paletteId: p.id } });
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-700 aria-selected:bg-blue-50 aria-selected:text-blue-700"
                >
                  <Palette className="h-3.5 w-3.5" /> 配色：{p.name}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
};
