import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crosshair,
  ListChecks,
  Loader2,
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
  runNodeAiActionDetailed,
  streamGenerateMindmap,
  type AiChatHistoryTurn,
  type AiExecutionStep,
  type AiStreamEvent,
  type NodeAiActionKind,
} from "@mindmap/ai";
import type { AiChatMessage, AiChatPersistence, EditorAiRuntime } from "../ai-runtime.js";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";

export type { AiChatMessage };

export interface QueuedAiRequest {
  prompt: string;
  action?: NodeAiActionKind;
  forceFullMap?: boolean;
}

interface AiChatPanelProps {
  open: boolean;
  isDark: boolean;
  layout: MindmapLayoutResult;
  queuedPrompt?: string;
  queuedRequest?: QueuedAiRequest;
  aiRuntime?: EditorAiRuntime;
  chatPersistence?: AiChatPersistence;
  readOnly?: boolean;
  embedded?: boolean;
  onConsumeQueuedPrompt?: () => void;
  onMessagesChange?: (messages: AiChatMessage[]) => void;
  onClose: () => void;
}

function upsertStepList(list: AiExecutionStep[] | undefined, next: AiExecutionStep): AiExecutionStep[] {
  const current = list ?? [];
  const idx = current.findIndex((s) => s.id === next.id);
  if (idx === -1) return [...current, next];
  const copy = current.slice();
  copy[idx] = next;
  return copy;
}

function buildMultiTurnHistory(messages: AiChatMessage[]): AiChatHistoryTurn[] {
  return messages
    .filter((m) => !m.pending && m.content.trim().length > 0)
    .slice(-6)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 400),
      ...(m.plan?.goal ? { planSummary: m.plan.goal.slice(0, 200) } : {}),
      ...(m.outcome?.summary ? { resultSummary: m.outcome.summary.slice(0, 200) } : {}),
    }));
}

export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  open,
  isDark,
  layout,
  queuedPrompt,
  queuedRequest,
  aiRuntime,
  chatPersistence,
  readOnly = false,
  embedded = false,
  onConsumeQueuedPrompt,
  onMessagesChange,
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

  const [messages, setMessages] = useState<AiChatMessage[]>(() => chatPersistence?.loadCached?.() ?? []);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ignoreSelection, setIgnoreSelection] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AiChatMessage[]>(messages);
  messagesRef.current = messages;

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Load persisted messages (local cache immediately, then remote cloud sync)
  useEffect(() => {
    if (!chatPersistence) return;
    let active = true;
    const cached = chatPersistence.loadCached?.() ?? [];
    if (cached.length > 0) {
      setMessages((prev) => {
        if (prev.some((m) => m.pending)) return prev;
        return cached;
      });
    }
    if (chatPersistence.loadRemote) {
      void chatPersistence.loadRemote().then((remote) => {
        if (!active || !remote) return;
        setMessages((prev) => {
          if (prev.some((m) => m.pending)) {
            const existingIds = new Set(prev.map((m) => m.id));
            const prefix = remote.filter((m) => !existingIds.has(m.id));
            return prefix.length > 0 ? [...prefix, ...prev] : prev;
          }
          return remote;
        });
      });
    }
    return () => { active = false; };
  }, [chatPersistence]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

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
    if (open && !readOnly) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, readOnly]);

  const focusTopic = (topicId: string) => {
    if (!topicMap.has(topicId)) return;
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

  const persistSnapshot = (nextMessages: AiChatMessage[]) => {
    if (!chatPersistence || readOnly) return;
    void chatPersistence.saveMessages(nextMessages);
  };

  const handleClearChat = () => {
    if (readOnly || busy) return;
    if (messages.length > 0 && typeof window !== "undefined" && !window.confirm(t.aiChat.clearConfirm)) {
      return;
    }
    setMessages([]);
    setExpandedRuns({});
    void chatPersistence?.clearMessages();
  };

  const executePrompt = async (
    rawText: string,
    explicitAction?: NodeAiActionKind,
    forceFullMap = false,
  ) => {
    const text = rawText.trim();
    if (!text || busy || readOnly) return;

    const targetId = forceFullMap ? sheet.rootTopic.id : activeTopicId ?? sheet.rootTopic.id;
    const contextLabel = !forceFullMap && activeTopicTitle
      ? selectedTopicIds.length > 1
        ? t.aiChat.multiContext(activeTopicTitle, selectedTopicIds.length)
        : activeTopicTitle
      : undefined;

    const nowIso = new Date().toISOString();
    const userMsgId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantMsgId = `a-${Date.now() + 1}-${Math.random().toString(36).slice(2, 6)}`;
    const history = buildMultiTurnHistory(messagesRef.current);

    const userMessage: AiChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      contextLabel,
      createdAt: nowIso,
    };
    const pendingAssistant: AiChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: t.aiChat.pending,
      status: "running",
      pending: true,
      steps: [],
      createdAt: nowIso,
    };

    setMessages((prev) => [...prev, userMessage, pendingAssistant]);
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const onEvent = (ev: AiStreamEvent) => {
      if (ev.event === "meta" && aiRuntime?.onMeta) {
        aiRuntime.onMeta(ev.data);
      } else if (ev.event === "plan") {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, plan: ev.data } : m)),
        );
      } else if (ev.event === "step") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, steps: upsertStepList(m.steps, ev.data) } : m,
          ),
        );
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
        const result = await runNodeAiActionDetailed(
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
                history,
                signal: controller.signal,
                onEvent,
              }
            : { prompt: text, history, onEvent },
        );
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  pending: false,
                  status: "done" as const,
                  content: result.message,
                  plan: result.plan ?? m.plan,
                  steps: result.steps ?? m.steps,
                  outcome: result.outcome ?? m.outcome,
                  mutation: {
                    summary: t.aiChat.canvasUpdated(result.summary || result.message),
                    targetTopicId: targetId,
                  },
                }
              : m,
          );
          persistSnapshot(next);
          return next;
        });
      } else {
        const result = await streamGenerateMindmap({
          adapter,
          sheetId: sheet.id,
          prompt: text,
          locale,
          transport: aiRuntime?.transport,
          tier: aiRuntime?.tier,
          history,
          signal: controller.signal,
          onEvent,
        });
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  pending: false,
                  status: "done" as const,
                  content: result?.message || t.aiChat.generatedFull(text),
                  plan: result?.plan ?? m.plan,
                  steps: result?.steps ?? m.steps,
                  outcome: result?.outcome ?? m.outcome,
                  mutation: {
                    summary: result?.summary || t.aiChat.generatedFullMutation,
                    targetTopicId: sheet.rootTopic.id,
                  },
                }
              : m,
          );
          persistSnapshot(next);
          return next;
        });
      }
    } catch (err) {
      if (err instanceof AiClientError && err.code === "ABORTED") {
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  pending: false,
                  status: "stopped" as const,
                  content: t.aiChat.stoppedNotice,
                  steps: (m.steps ?? []).map((s) =>
                    s.status === "running" ? { ...s, status: "error" as const } : s,
                  ),
                }
              : m,
          );
          persistSnapshot(next);
          return next;
        });
      } else {
        const msg = err instanceof Error ? err.message : t.aiChat.errorFallback;
        const isRateLimited = err instanceof AiClientError && err.code === "RATE_LIMITED";
        const showUpgrade =
          aiRuntime?.tier === "free" &&
          Boolean(aiRuntime.onUpgradeToPro) &&
          isRateLimited;
        if (aiRuntime?.onRefreshConfig && (isRateLimited || (err instanceof AiClientError && err.code === "UPSTREAM_ERROR"))) {
          aiRuntime.onRefreshConfig();
        }
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  pending: false,
                  status: "error" as const,
                  content: t.aiChat.errorPrefix(msg),
                  upgradePrompt: showUpgrade,
                  steps: (m.steps ?? []).map((s) =>
                    s.status === "running" ? { ...s, status: "error" as const } : s,
                  ),
                }
              : m,
          );
          persistSnapshot(next);
          return next;
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || busy || readOnly) return;
    if (queuedRequest?.prompt) {
      const req = queuedRequest;
      onConsumeQueuedPrompt?.();
      void executePrompt(
        req.prompt,
        req.action,
        req.forceFullMap ?? (!req.action && sheet.rootTopic.children.length === 0),
      );
      return;
    }
    if (queuedPrompt) {
      const promptToRun = queuedPrompt;
      onConsumeQueuedPrompt?.();
      void executePrompt(promptToRun, undefined, sheet.rootTopic.children.length === 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queuedPrompt, queuedRequest]);

  if (!open) return null;

  const borderCls = isDark ? "border-white/[0.075]" : "border-slate-900/[0.08]";
  const mutedTextCls = isDark ? "text-[#9ca3b0]" : "text-[#525b6b]";
  const isTrialMode = aiRuntime?.tier === "free";
  const trialRemaining = !readOnly && isTrialMode && aiRuntime?.config ? aiRuntime.config.remainingToday : null;
  const trialExhausted = trialRemaining !== null && trialRemaining <= 0;
  const showStrip = embedded || trialRemaining !== null || readOnly;

  const renderProcessTrace = (msg: AiChatMessage) => {
    const steps = msg.steps ?? [];
    const hasTrace = Boolean(msg.plan || steps.length > 0);
    if (!hasTrace) return null;

    const isRunning = Boolean(msg.pending || msg.status === "running");
    const isExpanded = expandedRuns[msg.id] ?? isRunning;
    const doneSteps = steps.filter((s) => s.status === "done").length;
    const added = msg.outcome?.stats.addedNodes ?? 0;
    const updated = msg.outcome?.stats.updatedNodes ?? 0;
    const durationMs = msg.outcome?.stats.durationMs;

    const summaryLabel = isRunning
      ? t.aiChat.runningSummary(doneSteps, steps.length)
      : msg.status === "stopped"
        ? t.aiChat.stoppedSummary(doneSteps)
        : msg.status === "error"
          ? t.aiChat.errorSummary(doneSteps)
          : t.aiChat.doneSummary(steps.length || (msg.plan?.steps.length ?? 0), added, updated, durationMs);

    return (
      <div
        className={`rounded-[7px] border text-[11.5px] ${
          isDark
            ? "border-white/[0.08] bg-[#101114]/90"
            : "border-slate-900/[0.08] bg-[#f6f7f9]"
        }`}
      >
        <button
          type="button"
          onClick={() => setExpandedRuns((prev) => ({ ...prev, [msg.id]: !isExpanded }))}
          aria-expanded={isExpanded}
          className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition ${
            isDark ? "hover:bg-white/[0.04]" : "hover:bg-slate-900/[0.03]"
          }`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {isRunning ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-400" />
            ) : msg.status === "error" || msg.status === "stopped" ? (
              <AlertCircle className="h-3 w-3 shrink-0 text-amber-500" />
            ) : (
              <ListChecks className="h-3 w-3 shrink-0 text-[#46a758]" />
            )}
            <span className="truncate font-medium">{summaryLabel}</span>
          </span>
          {isExpanded ? (
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${mutedTextCls}`} />
          ) : (
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${mutedTextCls}`} />
          )}
        </button>

        {isExpanded && (
          <div className={`space-y-2.5 border-t px-2.5 py-2 ${borderCls}`}>
            {msg.plan && (
              <div className="space-y-1">
                <div className={`text-[10.5px] font-semibold uppercase tracking-wide ${mutedTextCls}`}>
                  {t.aiChat.planHeading}
                </div>
                {msg.plan.goal && <p className="font-medium leading-snug">{msg.plan.goal}</p>}
                {msg.plan.approach && (
                  <p className={`text-[11px] leading-relaxed ${mutedTextCls}`}>{msg.plan.approach}</p>
                )}
                {msg.plan.steps.length > 0 && (
                  <ol className={`list-decimal space-y-0.5 pl-4 text-[11px] ${mutedTextCls}`}>
                    {msg.plan.steps.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {steps.length > 0 && (
              <div className="space-y-1">
                <div className={`text-[10.5px] font-semibold uppercase tracking-wide ${mutedTextCls}`}>
                  {t.aiChat.stepsHeading}
                </div>
                <ul className="space-y-1">
                  {steps.map((step) => {
                    const canFocus = Boolean(step.topicId && topicMap.has(step.topicId));
                    return (
                      <li key={step.id} className="flex items-start justify-between gap-2 text-[11px]">
                        <div className="flex min-w-0 items-start gap-1.5">
                          <span className="mt-0.5 shrink-0">
                            {step.status === "running" ? (
                              <Loader2 className="h-3 w-3 animate-spin text-sky-400" />
                            ) : step.status === "error" ? (
                              <AlertCircle className="h-3 w-3 text-amber-500" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 text-[#46a758]" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <span
                              className={`mr-1.5 inline-block rounded px-1 py-px text-[9.5px] font-medium ${
                                isDark ? "bg-white/[0.07] text-[#c4cad4]" : "bg-slate-200/80 text-[#3c4454]"
                              }`}
                            >
                              {t.aiChat.phaseLabels[step.phase]}
                            </span>
                            <span className="leading-snug">{step.title}</span>
                            {step.detail && (
                              <div className={`truncate text-[10.5px] ${mutedTextCls}`}>{step.detail}</div>
                            )}
                          </div>
                        </div>
                        {canFocus && (
                          <button
                            type="button"
                            onClick={() => focusTopic(step.topicId!)}
                            title={t.aiChat.locateNode}
                            aria-label={t.aiChat.locateNode}
                            className={`mt-0.5 shrink-0 rounded p-0.5 transition ${
                              isDark ? "text-[#9ca3b0] hover:bg-white/[0.08] hover:text-white" : "text-[#525b6b] hover:bg-slate-200/70"
                            }`}
                          >
                            <Crosshair className="h-3 w-3" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const content = (
    <>
      {/* Header (shown when standalone) */}
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
            {!readOnly && (
              <button
                type="button"
                title={t.aiChat.newChat}
                onClick={handleClearChat}
                className={`inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] transition ${
                  isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-100"
                }`}
              >
                <Plus className="h-3 w-3" /> {t.aiChat.newChat}
              </button>
            )}
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

      {/* Compact Status / Action Strip */}
      {showStrip && (
        <div
          className={`flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5 text-[11px] ${borderCls} ${
            isDark ? "bg-white/[0.02]" : "bg-slate-900/[0.02]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {readOnly ? (
              <span className={`truncate text-[11px] ${mutedTextCls}`}>{t.aiChat.readOnlyHint}</span>
            ) : trialRemaining !== null ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  isDark
                    ? "border-white/[0.1] bg-white/[0.04] text-[#d5d9e2]"
                    : "border-slate-900/[0.1] bg-slate-900/[0.04] text-[#2c3340]"
                }`}
              >
                {t.aiChat.trialRemaining(trialRemaining)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {embedded && !readOnly && messages.length > 0 && (
              <button
                type="button"
                title={t.aiChat.newChat}
                onClick={handleClearChat}
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] transition ${
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
              readOnly || topicMap.size > 1 ? "items-center text-center" : ""
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
            <p className="text-[13.5px] font-semibold">
              {readOnly ? t.aiChat.emptyReadOnlyTitle : t.aiChat.emptyTitle}
            </p>
            {!readOnly && isTrialMode && (
              <p className={`mt-1.5 text-[11.5px] leading-relaxed ${mutedTextCls}`}>
                {t.aiChat.trialEmptyHint}
              </p>
            )}
            {!readOnly && topicMap.size <= 1 && (
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
                  {renderProcessTrace(msg)}
                  <div className={`text-[12.5px] leading-relaxed ${msg.pending ? mutedTextCls : ""}`}>
                    {msg.content}
                  </div>
                  {msg.upgradePrompt && aiRuntime?.onUpgradeToPro && (
                    <button
                      type="button"
                      onClick={aiRuntime.onUpgradeToPro}
                      className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[11.5px] font-medium transition ${
                        isDark
                          ? "bg-[#ededef] text-[#0b0c0e] hover:bg-white"
                          : "bg-[#14161b] text-white hover:bg-[#282c35]"
                      }`}
                    >
                      <Sparkles className="h-3 w-3" /> {t.aiChat.upgradeCta}
                    </button>
                  )}
                  {(msg.outcome || msg.mutation) && !msg.pending && (
                    <div
                      className={`rounded-[7px] border p-2.5 text-[11.5px] ${
                        isDark
                          ? "border-white/[0.08] bg-[#101114]"
                          : "border-slate-900/[0.08] bg-[#f7f8fa]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#46a758]" />
                        <span className="truncate">{msg.mutation?.summary || msg.outcome?.summary}</span>
                      </div>
                      {msg.outcome && (
                        <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] ${mutedTextCls}`}>
                          {msg.outcome.stats.addedNodes > 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 ${
                                isDark ? "bg-white/[0.06]" : "bg-slate-200/70"
                              }`}
                            >
                              {t.aiChat.statsAdded(msg.outcome.stats.addedNodes)}
                            </span>
                          )}
                          {msg.outcome.stats.updatedNodes > 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 ${
                                isDark ? "bg-white/[0.06]" : "bg-slate-200/70"
                              }`}
                            >
                              {t.aiChat.statsUpdated(msg.outcome.stats.updatedNodes)}
                            </span>
                          )}
                          {msg.outcome.stats.layoutChanged && (
                            <span
                              className={`rounded px-1.5 py-0.5 ${
                                isDark ? "bg-white/[0.06]" : "bg-slate-200/70"
                              }`}
                            >
                              {t.aiChat.statsLayout(msg.outcome.stats.layoutChanged)}
                            </span>
                          )}
                        </div>
                      )}
                      {msg.outcome && msg.outcome.highlights.filter((h) => topicMap.has(h.topicId)).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {msg.outcome.highlights
                            .filter((h) => topicMap.has(h.topicId))
                            .slice(0, 4)
                            .map((h) => (
                              <button
                                key={h.topicId}
                                type="button"
                                onClick={() => focusTopic(h.topicId)}
                                className={`max-w-[140px] truncate rounded-[5px] border px-1.5 py-0.5 text-[10.5px] transition ${
                                  isDark
                                    ? "border-white/[0.08] bg-[#181b22] text-[#d5d9e2] hover:border-white/[0.18] hover:text-white"
                                    : "border-slate-900/[0.08] bg-white text-[#2c3340] hover:bg-slate-100"
                                }`}
                              >
                                {h.title}
                              </button>
                            ))}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        {msg.mutation?.targetTopicId && topicMap.has(msg.mutation.targetTopicId) && (
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
                        {!readOnly && canUndo && (
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

      {/* Composer Footer (hidden in readOnly viewer mode) */}
      {!readOnly && (
        <div className={`shrink-0 border-t p-2.5 ${borderCls}`}>
          {trialExhausted && aiRuntime?.onUpgradeToPro ? (
            <div
              className={`rounded-[8px] border p-3 ${
                isDark
                  ? "border-white/[0.1] bg-[#15171c] text-[#f4f5f8]"
                  : "border-slate-900/[0.1] bg-[#f7f8fa] text-[#111318]"
              }`}
            >
              <p className="text-[12.5px] font-semibold">{t.aiChat.trialExhaustedTitle}</p>
              <p className={`mt-1 text-[11.5px] leading-relaxed ${mutedTextCls}`}>
                {t.aiChat.trialExhaustedDesc}
              </p>
              <button
                type="button"
                onClick={aiRuntime.onUpgradeToPro}
                className={`mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition ${
                  isDark
                    ? "bg-[#ededef] text-[#0b0c0e] hover:bg-white"
                    : "bg-[#14161b] text-white hover:bg-[#282c35]"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" /> {t.aiChat.upgradeCta}
              </button>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
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
