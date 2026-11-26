import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { HelpCircle } from "lucide-react";

const SHORTCUTS: Array<[string, string]> = [
  ["Tab", "插入子主题"],
  ["Enter", "插入同级主题"],
  ["Ctrl + Enter", "插入父主题"],
  ["F2 / 双击节点", "原地富文本编辑"],
  ["双击空白处", "新建自由主题"],
  ["Alt + 拖拽", "自由微调节点位置"],
  ["Shift + 框选", "多选节点批量操作"],
  ["⌘K / Ctrl+K", "全局搜索与命令面板"],
  ["F6", "聚焦下钻当前分支"],
  ["Space", "折叠 / 展开子分支"],
  ["Ctrl + V", "粘贴图片到选中节点"],
];

export const ShortcutsHelp: React.FC<{ isDark: boolean }> = ({ isDark }) => (
  <Popover.Root>
    <Popover.Trigger asChild>
      <button
        type="button"
        title="快捷键指南"
        className={`absolute bottom-3 left-3 z-30 flex h-8 w-8 items-center justify-center rounded-md border transition ${
          isDark
            ? "border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:text-white"
            : "border-slate-200 bg-white/95 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        }`}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        className={`z-50 w-64 rounded-2xl border p-3.5 text-xs shadow-2xl ${
          isDark
            ? "border-slate-700 bg-slate-900 text-slate-200"
            : "border-slate-200 bg-white text-slate-700"
        }`}
      >
        <div className="mb-2.5 font-bold">快捷键与操作指南</div>
        <div className="space-y-1.5">
          {SHORTCUTS.map(([k, desc]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className={isDark ? "text-slate-400" : "text-slate-500"}>{desc}</span>
              <kbd
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  isDark
                    ? "border-slate-700 bg-slate-800 text-slate-200"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {k}
              </kbd>
            </div>
          ))}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
);
