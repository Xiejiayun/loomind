import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  CheckCircle2,
  Crosshair,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  collectAllTopics,
  richTextToPlainText,
  type MindmapLayoutResult,
} from "@mindmap/core";
import {
  AiClientError,
  runNodeAiAction,
  streamGenerateMindmap,
  type NodeAiActionKind,
} from "@mindmap/ai";
import type { EditorAiRuntime } from "../ai-runtime.js";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  contextLabel?: string;
  upgradePrompt?: boolean;
  mutation?: {
    summary: string;
    targetTopicId?: string;
  };
  pending?: boolean;
}

interface AiChatPanelProps {
  open: boolean;
  isDark: boolean;
  layout: MindmapLayoutResult;
  queuedPrompt?: string;
  aiRuntime?: EditorAiRuntime;
  embedded?: boolean;
  onConsumeQueuedPrompt?: () => void;
  onClose: () => void;
}

export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  open,
  isDark,
  layout,
  queuedPrompt,
  aiRuntime,
  embedded = false,
  onConsumeQueuedPrompt,
  onClose,
}) => {
  const doc = useMindmapStore((s) => s.doc);
  const adapter = useMindmapStore((s) => s.adapter);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const setCamera = useMindmapStore((s) => s.setCamera);
  const camera = useMindmapStore((s) => s.camera);
  const undo = useMindmapStore((s) => s.undo);
  const canUndo = useMindmapStore((s) => s.canUndo);
  const { locale, t } = useEditorI18n();

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ignoreSelection, setIgnoreSelection] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const sheet = useMemo(
    () => doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0],
    [doc],
  );
  const topicMap = useMemo(() => collectAllTopics(sheet), [sheet]);

  const activeTopicId = !ignoreSelection && selectedTopicIds.length > 0 ? selectedTopicIds[0] : null;
  const activeTopic = activeTopicId ? topicMap.get(activeTopicId) : undefined;
  const activeTopicTitle = activeTopic ? richTextToPlainText(activeTopic.title) : null;

  useEffect(() => {
    setIgnoreSelection(false);
  }, [selectedTopicIds.join(",")]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const focusTopic = (topicId: string) => {
    selectTopics([topicId]);
    const node = layout.nodes.get(topicId);
    if (node) {
      const vw = Math.max(320, window.innerWidth - 360);
      const vh = Math.max(320, window.innerHeight - 80);
      setCamera({
        x: vw / 2 - (node.contentBox.x + node.contentBox.width / 2) * camera.scale,
        y: vh / 2 - (node.contentBox.y + node.contentBox.height / 2) * camera.scale,
      });
    }
  };

  const executePrompt = async (
    rawText: string,
    explicitAction?: NodeAiActionKind,
    forceFullMap = false,
  ) => {
    const text = rawText.trim();
    if (!text || busy) return;

    const targetId = forceFullMap ? sheet.rootTopic.id : activeTopicId ?? sheet.rootTopic.id;
    const contextLabel = !forceFullMap && activeTopicTitle
      ? selectedTopicIds.length > 1
        ? t.aiChat.multiContext(activeTopicTitle, selectedTopicIds.length)
        : activeTopicTitle
      : undefined;

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now() + 1}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: text, contextLabel },
      { id: assistantMsgId, role: "assistant", content: t.aiChat.pending, pending: true },
    ]);
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const onEvent = (ev: { event: string; data: unknown }) => {
      if (ev.event === "meta" && aiRuntime?.onMeta) {
        aiRuntime.onMeta(ev.data as Parameters<NonNullable<EditorAiRuntime["onMeta"]>>[0]);
      }
    };

    try {
      let inferredAction: NodeAiActionKind | undefined = explicitAction;
      if (!inferredAction && !forceFullMap) {
        if (/任务|todo|待办|步骤|task|step/i.test(text)) inferredAction = "tasks";
        else if (/概要|总结|归纳|summar/i.test(text)) inferredAction = "summarize";
        else if (/外框|聚类|分组|cluster|boundary|group/i.test(text)) inferredAction = "cluster";
        else if (/备注|说明|详情|笔记|note|elaborate/i.test(text)) inferredAction = "elaborateNote";
        else if (/风格|配色|布局|排版|结构|style|palette|layout/i.test(text)) inferredAction = "restyle";
        else if (activeTopicId && activeTopicId !== sheet.rootTopic.id) inferredAction = "expand";
      }

      if (inferredAction) {
        const resultText = await runNodeAiAction(
          adapter,
          sheet.id,
          targetId,
          inferredAction,
          locale,
          aiRuntime
            ? {
                transport: aiRuntime.transport,
                tier: aiRuntime.tier,
                prompt: text,
                selectedTopicIds,
                signal: controller.signal,
                onEvent,
              }
            : undefined,
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  pending: false,
                  content: resultText,
                  mutation: {
                    summary: t.aiChat.canvasUpdated(resultText),
                    targetTopicId: targetId,
                  },
                }
              : m,
          ),
        );
      } else {
        const result = await streamGenerateMindmap({
          adapter,
          sheetId: sheet.id,
          prompt: text,
          locale,
          transport: aiRuntime?.transport,
          tier: aiRuntime?.tier,
          signal: controller.signal,
          onEvent,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  pending: false,
                  content: result?.message || t.aiChat.generatedFull(text),
                  mutation: {
                    summary: result?.summary || t.aiChat.generatedFullMutation,
                    targetTopicId: sheet.rootTopic.id,
                  },
                }
              : m,
          ),
        );
      }
    } catch (err) {
      if (err instanceof AiClientError && err.code === "ABORTED") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, pending: false, content: t.aiChat.stoppedNotice } : m,
          ),
        );
      } else {
        const msg = err instanceof Error ? err.message : t.aiChat.errorFallback;
        const showUpgrade =
          aiRuntime?.tier === "free" &&
          Boolean(aiRuntime.onUpgradeToPro) &&
          err instanceof AiClientError &&
          err.code === "RATE_LIMITED";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, pending: false, content: t.aiChat.errorPrefix(msg), upgradePrompt: showUpgrade }
              : m,
          ),
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open && queuedPrompt && !busy) {
      const promptToRun = queuedPrompt;
      onConsumeQueuedPrompt?.();
      void executePrompt(promptToRun, undefined, sheet.rootTopic.children.length === 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queuedPrompt]);

  if (!open) return null;

  const borderCls = isDark ? "border-white/[0.075]" : "border-slate-900/[0.08]";
  const mutedTextCls = isDark ? "text-[#646b78]" : "text-[#8c95a4]";

  const content = (
    <>
      {/* Header (shown when standalone, or compact new-chat bar when embedded in unified sidebar) */}
      {!embedded && (
        <div className={`flex h-10 shrink-0 items-center justify-between border-b px-3 ${borderCls}`}>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-[5px] border ${
                isDark
                  ? "border-white/[0.1] bg-white/[0.06] text-[#d5d9e2]"
                  : "border-slate-900/[0.1] bg-slate-900/[0.05] text-[#2c3340]"
              }`}
            >
              <Sparkles className="h-3 w-3" />
            </span>
            <span className="font-medium">{t.aiChat.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={t.aiChat.newChat}
              onClick={() => setMessages([])}
              className={`inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] transition ${
                isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-100"
              }`}
            >
              <Plus className="h-3 w-3" /> {t.aiChat.newChat}
            </button>
            <button
              type="button"
              aria-label={t.aiChat.closeAria}
              onClick={onClose}
              className={`inline-grid h-6 w-6 place-items-center rounded-[5px] transition ${
                isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-100"
              }`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Tier & Quota Status Strip */}
      {(aiRuntime || embedded) && (
        <div
          className={`flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b px-3 py-1.5 text-[10.5px] ${borderCls} ${
            isDark ? "bg-white/[0.025]" : "bg-slate-900/[0.025]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {aiRuntime && (
              <>
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                    aiRuntime.tier === "pro"
                      ? isDark
                        ? "bg-indigo-500/20 text-indigo-200"
                        : "bg-indigo-100 text-indigo-800"
                      : isDark
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {aiRuntime.tier === "pro" ? t.aiChat.tierProBadge : t.aiChat.tierFreeBadge}
                </span>
                {aiRuntime.config?.modelLabel && (
                  <span className={`truncate ${mutedTextCls}`} title={aiRuntime.config.modelLabel}>
                    {aiRuntime.config.modelLabel}
                  </span>
                )}
                {aiRuntime.config?.isMock && (
                  <span
                    className={`rounded border px-1 py-0.25 text-[9.5px] ${
                      isDark
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                        : "border-amber-500/30 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {t.aiChat.mockBadge}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {aiRuntime?.config && (
              <span className={mutedTextCls}>
                {t.aiChat.quotaLabel(aiRuntime.config.remainingToday, aiRuntime.config.dailyLimit)}
              </span>
            )}
            {aiRuntime?.tier === "free" && aiRuntime.onUpgradeToPro && (
              <button
                type="button"
                onClick={aiRuntime.onUpgradeToPro}
                className={`font-medium underline-offset-2 hover:underline ${
                  isDark ? "text-indigo-300 hover:text-indigo-200" : "text-indigo-700 hover:text-indigo-900"
                }`}
              >
                {t.aiChat.upgradeCta}
              </button>
            )}
            {embedded && messages.length > 0 && (
              <button
                type="button"
                title={t.aiChat.newChat}
                onClick={() => setMessages([])}
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] transition ${
                  isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-200/70"
                }`}
              >
                <Plus className="h-3 w-3" /> {t.aiChat.newChat}
              </button>
            )}
            {embedded && (
              <button
                type="button"
                aria-label={t.aiChat.closeAria}
                onClick={onClose}
                className={`inline-grid h-5 w-5 place-items-center rounded-[4px] transition ${
                  isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-200/70"
                }`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Message Stream */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3.5">
        {messages.length === 0 ? (
          <div
            className={`flex min-h-full flex-col justify-center ${
              topicMap.size <= 1 ? "" : "items-center text-center"
            }`}
          >
            <div
              className={`mb-3 inline-flex h-8 w-8 items-center justify-center rounded-[8px] border ${
                isDark
                  ? "border-white/[0.1] bg-white/[0.05] text-[#d5d9e2]"
                  : "border-slate-900/[0.1] bg-slate-900/[0.04] text-[#2c3340]"
              }`}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-[13.5px] font-semibold">{t.aiChat.emptyTitle}</p>
            {topicMap.size <= 1 && (
              <div className="mt-4 grid grid-cols-1 gap-1.5">
                {t.aiChat.starterIdeas.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    disabled={busy}
                    onClick={() => void executePrompt(idea, undefined, true)}
                    className={`group flex items-center justify-between gap-2 rounded-[7px] border px-2.5 py-2 text-left text-[12px] transition ${
                      isDark
                        ? "border-white/[0.075] bg-[#101114] text-[#d5d9e2] hover:border-white/[0.16] hover:bg-[#1c1f26]"
                        : "border-slate-900/[0.08] bg-[#f7f8fa] text-[#2c3340] hover:border-slate-900/[0.16] hover:bg-slate-100"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-3 w-3 shrink-0 opacity-65" />
                      <span>{idea}</span>
                    </span>
                    <ArrowUp className="h-3 w-3 shrink-0 rotate-45 opacity-0 transition group-hover:opacity-60" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              {msg.role === "user" ? (
                <div
                  className={`max-w-[90%] rounded-[8px] px-3 py-2 text-[12.5px] leading-relaxed ${
                    isDark ? "bg-[#1c1f26] text-[#f4f5f8]" : "bg-[#f1f3f6] text-[#111318]"
                  }`}
                >
                  {msg.contextLabel && (
                    <div className={`mb-1 text-[10.5px] ${mutedTextCls}`}>@{msg.contextLabel}</div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              ) : (
                <div className="w-full space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium">
                    <Sparkles className="h-3 w-3 opacity-70" />
                    <span>Loomind</span>
                  </div>
                  <div className={`text-[12.5px] leading-relaxed ${msg.pending ? mutedTextCls : ""}`}>
                    {msg.content}
                  </div>
                  {msg.upgradePrompt && aiRuntime?.onUpgradeToPro && (
                    <button
                      type="button"
                      onClick={aiRuntime.onUpgradeToPro}
                      className={`inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition ${
                        isDark
                          ? "bg-indigo-500/25 text-indigo-100 hover:bg-indigo-500/35"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                      }`}
                    >
                      <Sparkles className="h-3 w-3" /> {t.aiChat.upgradeCta}
                    </button>
                  )}
                  {msg.mutation && (
                    <div
                      className={`rounded-[7px] border p-2.5 text-[11.5px] ${
                        isDark
                          ? "border-white/[0.08] bg-[#101114]"
                          : "border-slate-900/[0.08] bg-[#f7f8fa]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#46a758]" />
                        <span className="truncate">{msg.mutation.summary}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        {msg.mutation.targetTopicId && (
                          <button
                            type="button"
                            onClick={() => focusTopic(msg.mutation!.targetTopicId!)}
                            className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[11px] transition ${
                              isDark
                                ? "border-white/[0.1] bg-[#1c1f26] text-[#d5d9e2] hover:text-white"
                                : "border-slate-900/[0.1] bg-white text-[#2c3340] hover:bg-slate-50"
                            }`}
                          >
                            <Crosshair className="h-3 w-3" /> {t.aiChat.locateNode}
                          </button>
                        )}
                        {canUndo && (
                          <button
                            type="button"
                            onClick={undo}
                            className={`inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11px] transition ${
                              isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-200/70"
                            }`}
                          >
                            <RotateCcw className="h-3 w-3" /> {t.aiChat.undoChange}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Composer Footer */}
      <div className={`shrink-0 border-t p-2.5 ${borderCls}`}>
        {/* Context Chip Bar (only when a node is selected) */}
        {activeTopicTitle && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex max-w-full items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[11px] font-medium ${
                isDark
                  ? "border-white/[0.12] bg-white/[0.08] text-[#f4f5f8]"
                  : "border-slate-900/[0.12] bg-slate-900/[0.06] text-[#111318]"
              }`}
            >
              <span className="truncate">
                @ {activeTopicTitle}
                {selectedTopicIds.length > 1 ? ` +${selectedTopicIds.length - 1}` : ""}
              </span>
              <button
                type="button"
                aria-label={t.aiChat.resetContextAria}
                onClick={() => setIgnoreSelection(true)}
                className="ml-0.5 opacity-70 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        {/* Input Box */}
        <div
          className={`flex items-end gap-1.5 rounded-[8px] border px-2.5 py-2 transition ${
            isDark
              ? "border-white/[0.1] bg-[#101114] focus-within:border-white/[0.26]"
              : "border-slate-900/[0.12] bg-[#f7f8fa] focus-within:border-slate-900/[0.3]"
          }`}
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void executePrompt(input);
              }
            }}
            placeholder={
              activeTopicTitle
                ? t.aiChat.inputPlaceholderTopic(activeTopicTitle)
                : t.aiChat.inputPlaceholderFull
            }
            className="block min-w-0 flex-1 resize-none bg-transparent text-[12.5px] leading-relaxed outline-none placeholder:text-[#646b78]"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              aria-label={t.aiChat.stopAria}
              title={t.aiChat.stopAria}
              className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-[5px] transition ${
                isDark
                  ? "bg-red-500/25 text-red-200 hover:bg-red-500/35"
                  : "bg-red-600 text-white hover:bg-red-700"
              }`}
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!input.trim()}
              onClick={() => void executePrompt(input)}
              aria-label={t.aiChat.sendAria}
              className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-[5px] transition disabled:opacity-35 ${
                isDark
                  ? "bg-[#ededef] text-[#0b0c0e] hover:bg-white"
                  : "bg-[#14161b] text-white hover:bg-[#282c35]"
              }`}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>;
  }

  return (
    <aside
      className={`fixed left-0 top-11 bottom-8 z-40 flex w-[340px] max-w-[88vw] shrink-0 flex-col border-r text-[12.5px] shadow-2xl md:static md:h-full md:shadow-none ${
        isDark
          ? "border-white/[0.075] bg-[#121419] text-[#f4f5f8]"
          : "border-slate-900/[0.08] bg-[#fafbfc] text-[#111318]"
      }`}
      aria-label={t.aiChat.ariaLabel}
    >
      {content}
    </aside>
  );
};
