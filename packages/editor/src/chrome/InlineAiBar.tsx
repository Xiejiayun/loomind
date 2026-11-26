import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Braces, FileText, ListChecks, Sparkles, X } from "lucide-react";
import { collectAllTopics, richTextToPlainText } from "@mindmap/core";
import { runNodeAiAction, type NodeAiActionKind } from "@mindmap/ai";
import { useMindmapStore } from "../context.js";

interface InlineAiBarProps {
  open: boolean;
  isDark: boolean;
  onClose: () => void;
  onContinueInPanel: (prompt?: string) => void;
}

export const InlineAiBar: React.FC<InlineAiBarProps> = ({
  open,
  isDark,
  onClose,
  onContinueInPanel,
}) => {
  const doc = useMindmapStore((s) => s.doc);
  const adapter = useMindmapStore((s) => s.adapter);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const topicMap = collectAllTopics(sheet);
  const targetId = selectedTopicIds[0] ?? sheet.rootTopic.id;
  const targetTopic = topicMap.get(targetId);
  const targetTitle = targetTopic ? richTextToPlainText(targetTopic.title) : "当前节点";

  const triggerQuick = async (action: NodeAiActionKind) => {
    if (busy) return;
    setBusy(true);
    try {
      await runNodeAiAction(adapter, sheet.id, targetId, action);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    onClose();
    onContinueInPanel(clean);
  };

  return (
    <div
      className={`pointer-events-auto absolute top-4 left-1/2 z-40 w-[500px] max-w-[92vw] -translate-x-1/2 rounded-[10px] border p-2 text-xs shadow-2xl backdrop-blur-md ${
        isDark
          ? "border-white/[0.14] bg-[#15171c]/95 text-[#f4f5f8]"
          : "border-slate-900/[0.12] bg-white/95 text-[#111318]"
      }`}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-75" />
        <span
          className={`max-w-[110px] shrink-0 truncate rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${
            isDark
              ? "border-white/[0.12] bg-white/[0.08] text-[#f4f5f8]"
              : "border-slate-900/[0.12] bg-slate-900/[0.06] text-[#111318]"
          }`}
        >
          @{targetTitle}
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入对当前节点的 AI 指令，回车发送…"
          className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[#646b78]"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className={`inline-grid h-6 w-6 place-items-center rounded-[5px] ${
            isDark ? "text-[#9ca3b0] hover:bg-white/[0.08]" : "text-[#525b6b] hover:bg-slate-100"
          }`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </form>

      <div
        className={`mt-2 flex flex-wrap items-center justify-between gap-1 border-t pt-2 ${
          isDark ? "border-white/[0.075]" : "border-slate-900/[0.08]"
        }`}
      >
        <div className="flex items-center gap-1">
          {(
            [
              ["expand", "扩展子节点", <Sparkles key="e" className="h-3 w-3" />],
              ["tasks", "拆任务", <ListChecks key="t" className="h-3 w-3" />],
              ["summarize", "概要", <Braces key="s" className="h-3 w-3" />],
              ["elaborateNote", "备注", <FileText key="n" className="h-3 w-3" />],
            ] as const
          ).map(([kind, label, icon]) => (
            <button
              key={kind}
              type="button"
              disabled={busy}
              onClick={() => void triggerQuick(kind)}
              className={`inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11px] font-medium transition ${
                isDark
                  ? "bg-white/[0.05] text-[#d5d9e2] hover:bg-white/[0.1] hover:text-white"
                  : "bg-slate-100 text-[#2c3340] hover:bg-slate-200/80"
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            onContinueInPanel(text.trim() || undefined);
          }}
          className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
            isDark ? "text-[#d5d9e2] hover:text-white hover:underline" : "text-[#2c3340] hover:text-[#111318] hover:underline"
          }`}
        >
          侧栏继续聊 <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};
