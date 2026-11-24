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
import { collectAllTopics, richTextToPlainText } from "@mindmap/core";
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
  tint: string;
}> = [
  {
    id: "expand",
    label: "发散扩展子主题",
    desc: "围绕当前节点生成 4 个深度分支",
    icon: <GitBranch className="h-4 w-4" />,
    tint: "bg-blue-50 text-blue-600",
  },
  {
    id: "tasks",
    label: "拆解行动清单",
    desc: "生成带待办勾选框的可执行步骤",
    icon: <CheckSquare className="h-4 w-4" />,
    tint: "bg-emerald-50 text-emerald-600",
  },
  {
    id: "summarize",
    label: "提炼分支概要",
    desc: "为直接子节点自动添加概要括号",
    icon: <Braces className="h-4 w-4" />,
    tint: "bg-amber-50 text-amber-600",
  },
  {
    id: "cluster",
    label: "语义聚类外框",
    desc: "为当前子树包上分组外框",
    icon: <SquareDashedBottom className="h-4 w-4" />,
    tint: "bg-sky-50 text-sky-600",
  },
  {
    id: "elaborateNote",
    label: "生成结构化备注",
    desc: "补充结构化 Markdown 详细说明",
    icon: <FileText className="h-4 w-4" />,
    tint: "bg-indigo-50 text-indigo-600",
  },
  {
    id: "restyle",
    label: "智能推荐风格",
    desc: "根据语义自动切换结构与配色",
    icon: <Wand2 className="h-4 w-4" />,
    tint: "bg-violet-50 text-violet-600",
  },
];

export const AiModal: React.FC<AiModalProps> = ({ open, onOpenChange }) => {
  const adapter = useMindmapStore((s) => s.adapter);
  const doc = useMindmapStore((s) => s.doc);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);

  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <Dialog.Title className="text-base font-bold text-slate-900">AI 流式共创</Dialog.Title>
                <Dialog.Description className="text-xs text-slate-500">
                  输入主题实时生长整张导图，或对当前节点一键扩展
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
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
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-800 outline-none transition focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-100"
            />
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                canGenerate
                  ? "bg-violet-600 text-white shadow-xs hover:bg-violet-700"
                  : "cursor-not-allowed bg-slate-100 text-slate-400"
              }`}
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              流式生成
            </button>
          </div>

          {/* Target node indicator */}
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">节点快捷共创</span>
            <span className="max-w-[260px] truncate rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
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
                className="flex items-start gap-2.5 rounded-xl border border-slate-200/90 bg-white p-3 text-left transition hover:border-violet-400 hover:bg-violet-50/30 hover:shadow-xs disabled:opacity-50"
              >
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${a.tint}`}>
                  {a.icon}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">{a.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{a.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {message && (
            <div className="mt-4 rounded-lg bg-violet-50 py-1.5 text-center text-xs font-medium text-violet-700">
              {message}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
