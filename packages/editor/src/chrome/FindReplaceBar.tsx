import React, { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Replace, ReplaceAll, Search, X } from "lucide-react";
import { collectAllTopics } from "@mindmap/core";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";
import {
  buildReplaceCommandsForTopic,
  findAncestorTopicIds,
  type TopicSearchMatch,
} from "./find-replace.js";

interface FindReplaceBarProps {
  open: boolean;
  showReplace: boolean;
  isDark: boolean;
  readOnly: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  matches: TopicSearchMatch[];
  activeIndex: number;
  onQueryChange: (q: string) => void;
  onReplacementChange: (r: string) => void;
  onToggleCaseSensitive: () => void;
  onToggleShowReplace: () => void;
  onActiveIndexChange: (idx: number) => void;
  onFocusTopic: (topicId: string) => void;
  onClose: () => void;
}

export const FindReplaceBar: React.FC<FindReplaceBarProps> = ({
  open,
  showReplace,
  isDark,
  readOnly,
  query,
  replacement,
  caseSensitive,
  matches,
  activeIndex,
  onQueryChange,
  onReplacementChange,
  onToggleCaseSensitive,
  onToggleShowReplace,
  onActiveIndexChange,
  onFocusTopic,
  onClose,
}) => {
  const doc = useMindmapStore((s) => s.doc);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const { t } = useEditorI18n();
  const findInputRef = useRef<HTMLInputElement>(null);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    }
  }, [open]);

  if (!open) return null;

  const revealMatch = (match: TopicSearchMatch) => {
    const ancestors = findAncestorTopicIds(sheet, match.topicId);
    const topicMap = collectAllTopics(sheet);
    for (const ancId of ancestors) {
      if (topicMap.get(ancId)?.collapsed) {
        dispatch({ type: "topic/toggleCollapse", sheetId: sheet.id, topicId: ancId, collapsed: false });
      }
    }
    selectTopics([match.topicId]);
    requestAnimationFrame(() => onFocusTopic(match.topicId));
  };

  const stepMatch = (delta: 1 | -1) => {
    if (matches.length === 0) return;
    const nextIdx = (activeIndex + delta + matches.length) % matches.length;
    onActiveIndexChange(nextIdx);
    revealMatch(matches[nextIdx]);
  };

  const handleReplaceCurrent = () => {
    if (readOnly || matches.length === 0 || !query) return;
    const safeIdx = Math.min(activeIndex, matches.length - 1);
    const match = matches[safeIdx];
    const topic = collectAllTopics(sheet).get(match.topicId);
    if (!topic) return;
    const { commands } = buildReplaceCommandsForTopic(sheet.id, topic, query, replacement, { caseSensitive });
    for (const cmd of commands) {
      dispatch(cmd, { coalesceKey: `replace:${topic.id}:${Date.now()}` });
    }
    if (matches.length > 1) {
      const next = matches[(safeIdx + 1) % matches.length];
      revealMatch(next);
    }
  };

  const handleReplaceAll = () => {
    if (readOnly || matches.length === 0 || !query) return;
    const topicMap = collectAllTopics(sheet);
    const batchKey = `replace-all:${Date.now()}`;
    for (const match of matches) {
      const topic = topicMap.get(match.topicId);
      if (!topic) continue;
      const { commands } = buildReplaceCommandsForTopic(sheet.id, topic, query, replacement, { caseSensitive });
      for (const cmd of commands) {
        dispatch(cmd, { coalesceKey: batchKey });
      }
    }
  };

  const inputCls = isDark
    ? "h-7 min-w-0 flex-1 rounded-[5px] border border-white/[0.1] bg-[#101216] px-2 text-xs text-[#f4f5f8] placeholder:text-[#646b78] outline-none focus:border-blue-400/60"
    : "h-7 min-w-0 flex-1 rounded-[5px] border border-slate-900/[0.12] bg-[#f8f9fb] px-2 text-xs text-[#111318] placeholder:text-[#8c95a4] outline-none focus:border-blue-500/60";

  const iconBtnCls = isDark
    ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[#9ca3b0] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
    : "flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[#525b6b] transition hover:bg-slate-900/[0.06] hover:text-[#111318] disabled:opacity-30";

  const displayIdx = matches.length > 0 ? Math.min(activeIndex, matches.length - 1) + 1 : 0;

  return (
    <div
      role="search"
      aria-label={t.findReplace.ariaLabel}
      className={`absolute right-4 top-3 z-40 w-[340px] max-w-[calc(100vw-32px)] rounded-[10px] border p-2 text-xs shadow-2xl backdrop-blur-md ${
        isDark
          ? "border-white/[0.12] bg-[#15171c]/95 text-[#f4f5f8]"
          : "border-slate-900/[0.12] bg-white/95 text-[#111318]"
      }`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* Find Row */}
      <div className="flex items-center gap-1">
        {!readOnly && (
          <button
            type="button"
            onClick={onToggleShowReplace}
            title={t.findReplace.toggleReplaceTitle}
            className={iconBtnCls}
          >
            {showReplace ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 opacity-50" />
          <input
            ref={findInputRef}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              onActiveIndexChange(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder={t.findReplace.findPlaceholder}
            className={`${inputCls} pl-7`}
          />
        </div>
        <button
          type="button"
          onClick={onToggleCaseSensitive}
          title={t.findReplace.caseSensitiveTitle}
          aria-pressed={caseSensitive}
          className={`flex h-6 shrink-0 items-center justify-center rounded-[5px] px-1.5 font-mono text-[11px] font-semibold transition ${
            caseSensitive
              ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40"
              : isDark
                ? "text-[#9ca3b0] hover:bg-white/[0.08] hover:text-white"
                : "text-[#525b6b] hover:bg-slate-900/[0.06] hover:text-[#111318]"
          }`}
        >
          Aa
        </button>
        <span className="min-w-[40px] shrink-0 text-center font-mono text-[11px] opacity-65">
          {displayIdx}/{matches.length}
        </span>
        <button
          type="button"
          disabled={matches.length === 0}
          onClick={() => stepMatch(-1)}
          title={t.findReplace.prevMatch}
          className={iconBtnCls}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={matches.length === 0}
          onClick={() => stepMatch(1)}
          title={t.findReplace.nextMatch}
          className={iconBtnCls}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onClose} title={t.findReplace.closeTitle} className={iconBtnCls}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Replace Row */}
      {showReplace && !readOnly && (
        <div className="mt-1.5 flex items-center gap-1 pl-7">
          <input
            value={replacement}
            onChange={(e) => onReplacementChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                handleReplaceCurrent();
              }
            }}
            placeholder={t.findReplace.replacePlaceholder}
            className={inputCls}
          />
          <button
            type="button"
            disabled={matches.length === 0}
            onClick={handleReplaceCurrent}
            title={t.findReplace.replaceOne}
            className={`flex h-7 shrink-0 items-center gap-1 rounded-[5px] border px-2 text-[11px] font-medium transition disabled:opacity-35 ${
              isDark
                ? "border-white/[0.1] bg-white/[0.06] text-[#f4f5f8] hover:bg-white/[0.12]"
                : "border-slate-900/[0.12] bg-slate-100 text-[#111318] hover:bg-slate-200"
            }`}
          >
            <Replace className="h-3 w-3" />
            <span>{t.findReplace.replaceBtn}</span>
          </button>
          <button
            type="button"
            disabled={matches.length === 0}
            onClick={handleReplaceAll}
            title={t.findReplace.replaceAll}
            className={`flex h-7 shrink-0 items-center gap-1 rounded-[5px] border px-2 text-[11px] font-medium transition disabled:opacity-35 ${
              isDark
                ? "border-white/[0.1] bg-white/[0.06] text-[#f4f5f8] hover:bg-white/[0.12]"
                : "border-slate-900/[0.12] bg-slate-100 text-[#111318] hover:bg-slate-200"
            }`}
          >
            <ReplaceAll className="h-3 w-3" />
            <span>{t.findReplace.replaceAllBtn}</span>
          </button>
        </div>
      )}
    </div>
  );
};
