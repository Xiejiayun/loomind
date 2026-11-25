import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Braces,
  CheckSquare,
  FileText,
  GitBranch,
  Loader2,
  Sparkles,
  SquareDashedBottom,
  Wand2,
  X,
} from "lucide-react";
import { collectAllTopics, getPalette, richTextToPlainText } from "@mindmap/core";
import {
  runNodeAiAction,
  streamGenerateMindmap,
  type NodeAiActionKind,
} from "@mindmap/ai";
import { useMindmapStore } from "../context.js";

interface AiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NODE_ACTIONS: Array<{
  id: NodeAiActionKind;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    id: "expand",
    label: "发散扩展子主题",
    desc: "围绕当前节点生成 4 个深度分支",
    icon: <GitBranch className="h-4 w-4" />,
  },
  {
    id: "tasks",
    label: "拆解行动清单",
    desc: "生成带待办勾选框的可执行步骤",
    icon: <CheckSquare className="h-4 w-4" />,
  },
  {
    id: "summarize",
    label: "提炼分支概要",
    desc: "为直接子节点自动添加概要括号",
    icon: <Braces className="h-4 w-4" />,
  },
  {
    id: "cluster",
    label: "语义聚类外框",
    desc: "为当前子树包上分组外框",
    icon: <SquareDashedBottom className="h-4 w-4" />,
  },
  {
    id: "elaborateNote",
    label: "生成结构化备注",
    desc: "补充结构化 Markdown 详细说明",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: "restyle",
    label: "智能推荐风格",
    desc: "根据语义自动切换结构与配色",
    icon: <Wand2 className="h-4 w-4" />,
  },
];

export const AiModal: React.FC<AiModalProps> = ({ open, onOpenChange }) => {
  const adapter = useMindmapStore((s) => s.adapter);
  const doc = useMindmapStore((s) => s.doc);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);

  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const isDark = getPalette({ ...doc.theme, ...sheet.theme }.paletteId).isDark && viewMode === "canvas";
  const focusCls = isDark
    ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111317]"
    : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white";
  const primaryId = selectedTopicIds[0] ?? sheet.rootTopic.id;
  const primaryTopic = collectAllTopics(sheet).get(primaryId);
  const primaryTitle = primaryTopic ? richTextToPlainText(primaryTopic.title) : sheet.title;

  const handleGenerate = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setMessage("正在流式生成思维导图...");
    try {
      await streamGenerateMindmap({ adapter, sheetId: sheet.id, prompt });
      setMessage("生成完成！");
      setTimeout(() => onOpenChange(false), 300);
    } finally {
      setRunning(false);
    }
  };

  const handleNodeAction = async (kind: NodeAiActionKind) => {
    if (running) return;
    setRunning(true);
    try {
      const msg = await runNodeAiAction(adapter, sheet.id, primaryId, kind);
      setMessage(msg);
      setTimeout(() => onOpenChange(false), 300);
    } finally {
      setRunning(false);
    }
  };

  const canGenerate = prompt.trim().length > 0 && !running;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-50 backdrop-blur-xs ${isDark ? "bg-black/70" : "bg-zinc-950/45"}`} />
        <Dialog.Content className={`fixed left-1/2 top-1/2 z-50 w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-2xl ${
          isDark ? "border-zinc-800 bg-[#111317] text-zinc-100" : "border-zinc-200 bg-white text-zinc-900"
        }`}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${isDark ? "bg-zinc-800 text-sky-300" : "bg-zinc-100 text-sky-700"}`}>
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <Dialog.Title className={`text-base font-semibold ${isDark ? "text-zinc-100" : "text-zinc-950"}`}>AI 流式共创</Dialog.Title>
                <Dialog.Description className={`text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
                  输入主题实时生长整张导图，或对当前节点一键扩展
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className={`rounded-lg p-1.5 transition ${focusCls} ${
              isDark ? "text-zinc-400 hover:bg-zinc-800 hover:text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            }`}>
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Full-map streaming generation */}
          <div className="mb-5 flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleGenerate();
              }}
              placeholder="输入主题，如：2026 AI Agent 产品发布计划..."
              className={`flex-1 rounded-xl border px-3.5 py-2.5 text-xs outline-none transition ${
                isDark
                  ? "border-zinc-700 bg-zinc-900/80 text-zinc-100 placeholder:text-zinc-500 focus:border-sky-400 focus:bg-zinc-900 focus:ring-2 focus:ring-sky-400/30"
                  : "border-zinc-300 bg-zinc-50/60 text-zinc-900 placeholder:text-zinc-500 focus:border-sky-600 focus:bg-white focus:ring-2 focus:ring-sky-600/20"
              }`}
            />
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${focusCls} ${
                canGenerate
                  ? isDark
                    ? "bg-zinc-100 text-zinc-950 shadow-xs hover:bg-white"
                    : "bg-zinc-950 text-white shadow-xs hover:bg-zinc-800"
                  : isDark
                    ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                    : "cursor-not-allowed bg-zinc-100 text-zinc-400"
              }`}
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              流式生成
            </button>
          </div>

          {/* Target node indicator */}
          <div className="mb-2.5 flex items-center justify-between">
            <span className={`text-[11px] font-semibold ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>节点快捷共创</span>
            <span className={`max-w-[260px] truncate rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              isDark ? "bg-zinc-800 text-zinc-300" : "bg-zinc-100 text-zinc-600"
            }`}>
              目标节点：{primaryTitle}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            {NODE_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={running}
                onClick={() => void handleNodeAction(a.id)}
                className={`group flex items-start gap-2.5 rounded-xl border p-3 text-left transition hover:shadow-xs disabled:opacity-50 ${focusCls} ${
                  isDark
                    ? "border-zinc-800 bg-[#181b20] hover:border-sky-600 hover:bg-zinc-800"
                    : "border-zinc-200 bg-white hover:border-sky-300 hover:bg-zinc-50"
                }`}
              >
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  isDark ? "bg-zinc-800 text-zinc-300 group-hover:text-sky-300" : "bg-zinc-100 text-zinc-600 group-hover:text-sky-700"
                }`}>
                  {a.icon}
                </span>
                <div className="min-w-0">
                  <div className={`font-semibold ${isDark ? "text-zinc-100" : "text-zinc-900"}`}>{a.label}</div>
                  <div className={`mt-0.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>{a.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {message && (
            <div className={`mt-4 rounded-lg py-1.5 text-center text-xs font-medium ${
              isDark ? "bg-sky-950/60 text-sky-200" : "bg-sky-50 text-sky-800"
            }`}>
              {message}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
