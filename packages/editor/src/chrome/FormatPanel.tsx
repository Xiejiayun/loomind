import React, { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ClipboardCopy, ClipboardPaste, Eraser, Palette, Pencil } from "lucide-react";
import {
  collectAllTopics,
  getPaletteLabel,
  getSkeletonInfo,
  hex8ToCss,
  PALETTE_LIST,
  SKELETON_LIST,
  type MindmapStructure,
  type MindmapThemeConfig,
  type MindmapTopic,
  type TopicShape,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";
import { MARKER_CATALOG, STICKER_CATALOG } from "./markers-catalog.js";
import { StructureIcon } from "./structure-icons.js";

function collectIdsByDepth(root: MindmapTopic, targetDepth: number): string[] {
  const out: string[] = [];
  const walk = (t: MindmapTopic, d: number) => {
    if (d === targetDepth) out.push(t.id);
    for (const c of t.children) walk(c, d + 1);
  };
  walk(root, 0);
  return out;
}

function findTopicDepth(root: MindmapTopic, id: string, d = 0): number {
  if (root.id === id) return d;
  for (const c of root.children) {
    const found = findTopicDepth(c, id, d + 1);
    if (found >= 0) return found;
  }
  return -1;
}

const ShapeIcon: React.FC<{ shape: TopicShape }> = ({ shape }) => {
  switch (shape) {
    case "auto":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <rect x="2" y="2" width="28" height="14" rx="4" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 2" />
        </svg>
      );
    case "rounded":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <rect x="2" y="2" width="28" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "capsule":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <rect x="2" y="2" width="28" height="14" rx="6" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "pill":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <rect x="2" y="2" width="28" height="14" rx="7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "underline":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <line x1="3" y1="14" x2="29" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "diamond":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <polygon points="16,1.5 30,9 16,16.5 2,9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "hexagon":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <polygon points="7,2 25,2 30,9 25,16 7,16 2,9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 32 18" className="h-4 w-7" fill="none">
          <path d="M9 15 H23 A4.5 4.5 0 0 0 23.5 6.2 A6 6 0 0 0 12 4.5 A4.5 4.5 0 0 0 9 15 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
  }
};

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

const SHAPE_IDS: TopicShape[] = [
  "auto",
  "rounded",
  "pill",
  "capsule",
  "underline",
  "diamond",
  "hexagon",
  "cloud",
];

const SWATCHES = [
  "#0F172AFF",
  "#EF4444FF",
  "#F97316FF",
  "#F59E0BFF",
  "#10B981FF",
  "#3B82F6FF",
  "#8B5CF6FF",
  "#EC4899FF",
  "#EFF6FFFF",
  "#FEF3C7FF",
  "#ECFDF5FF",
  "#FFFFFFFF",
];

const MARKERS = [
  { id: "priority:1", label: "P1", bg: "#EF4444", fg: "#FFF" },
  { id: "priority:2", label: "P2", bg: "#F97316", fg: "#FFF" },
  { id: "priority:3", label: "P3", bg: "#EAB308", fg: "#FFF" },
  { id: "priority:4", label: "P4", bg: "#22C55E", fg: "#FFF" },
  { id: "priority:5", label: "P5", bg: "#3B82F6", fg: "#FFF" },
  { id: "flag:red", label: "⚑", bg: "#FEE2E2", fg: "#DC2626" },
  { id: "flag:blue", label: "⚑", bg: "#DBEAFE", fg: "#2563EB" },
  { id: "flag:green", label: "⚑", bg: "#DCFCE7", fg: "#16A34A" },
  { id: "star:gold", label: "★", bg: "#FEF3C7", fg: "#D97706" },
  { id: "progress:start", label: "◔", bg: "#E0F2FE", fg: "#0284C7" },
  { id: "progress:half", label: "◑", bg: "#DBEAFE", fg: "#2563EB" },
  { id: "progress:done", label: "●", bg: "#DCFCE7", fg: "#16A34A" },
];

const STICKERS = [
  { id: "rocket", emoji: "🚀" },
  { id: "lightbulb", emoji: "💡" },
  { id: "target", emoji: "🎯" },
  { id: "fire", emoji: "🔥" },
  { id: "trophy", emoji: "🏆" },
  { id: "chart", emoji: "📈" },
  { id: "brain", emoji: "🧠" },
  { id: "sparkles", emoji: "✨" },
];

export const FormatPanel: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const open = useMindmapStore((s) => s.formatPanelOpen);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const doc = useMindmapStore((s) => s.doc);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const styleClipboard = useMindmapStore((s) => s.styleClipboard);
  const setStyleClipboard = useMindmapStore((s) => s.setStyleClipboard);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const { locale, t } = useEditorI18n();

  const [manualScope, setManualScope] = useState<"selected" | "level" | "all" | null>(null);
  const selKey = selectedTopicIds.join(",");
  useEffect(() => {
    setManualScope(null);
  }, [selKey]);

  const styleScope: "selected" | "level" | "all" =
    manualScope ?? (selectedTopicIds.length > 0 ? "selected" : "all");

  if (!open || zenMode || viewMode === "outline") return null;

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const theme = { ...doc.theme, ...sheet.theme };
  const setTheme = (patch: Partial<MindmapThemeConfig>) => dispatch({ type: "theme/set", sheetId: sheet.theme ? sheet.id : undefined, patch });
  const topicMap = collectAllTopics(sheet);
  const primaryId = selectedTopicIds[0] ?? sheet.rootTopic.id;
  const primaryTopic = topicMap.get(primaryId);
  const primaryDepth = Math.max(0, findTopicDepth(sheet.rootTopic, primaryId));
  const targetIds =
    styleScope === "all"
      ? Array.from(topicMap.keys())
      : styleScope === "level"
        ? collectIdsByDepth(sheet.rootTopic, primaryDepth)
        : selectedTopicIds.length > 0
          ? selectedTopicIds
          : Array.from(topicMap.keys());

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-40 flex w-[300px] max-w-full shrink-0 flex-col border-l text-xs shadow-xl transition-colors md:static md:h-full md:shadow-none ${
        isDark
          ? "dark-panel border-white/[0.075] bg-[#15171c] text-[#f4f5f8]"
          : "border-slate-900/[0.08] bg-white text-[#111318]"
      }`}
    >
      <Tabs.Root defaultValue="canvas" className="flex h-full flex-col">
        <Tabs.List
          className={`grid grid-cols-3 border-b p-1 ${
            isDark ? "border-white/[0.075] bg-[#0b0c0e]" : "border-slate-900/[0.08] bg-[#f7f8fa]"
          }`}
        >
          <Tabs.Trigger
            value="style"
            className={`rounded-[5px] py-1.5 text-[11px] font-medium transition ${
              isDark
                ? "text-[#9ca3b0] data-[state=active]:bg-[#1c1f26] data-[state=active]:text-[#f4f5f8]"
                : "text-[#525b6b] data-[state=active]:bg-white data-[state=active]:text-[#111318] data-[state=active]:shadow-2xs"
            }`}
          >
            {t.format.tabStyle}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="canvas"
            className={`rounded-[5px] py-1.5 text-[11px] font-medium transition ${
              isDark
                ? "text-[#9ca3b0] data-[state=active]:bg-[#1c1f26] data-[state=active]:text-[#f4f5f8]"
                : "text-[#525b6b] data-[state=active]:bg-white data-[state=active]:text-[#111318] data-[state=active]:shadow-2xs"
            }`}
          >
            {t.format.tabCanvas}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="markers"
            className={`rounded-[5px] py-1.5 text-[11px] font-medium transition ${
              isDark
                ? "text-[#9ca3b0] data-[state=active]:bg-[#1c1f26] data-[state=active]:text-[#f4f5f8]"
                : "text-[#525b6b] data-[state=active]:bg-white data-[state=active]:text-[#111318] data-[state=active]:shadow-2xs"
            }`}
          >
            {t.format.tabMarkers}
          </Tabs.Trigger>
        </Tabs.List>

        {/* TAB 1: Node Style */}
        <Tabs.Content value="style" className="flex-1 space-y-4 overflow-y-auto p-3">
          {/* Apply Scope Selector */}
          <Section title={t.format.scopeTitle(targetIds.length)}>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px]">
              {(
                [
                  ["selected", t.format.scopeSelected],
                  ["level", t.format.scopeLevel],
                  ["all", t.format.scopeAll],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setManualScope(id)}
                  className={`rounded-md py-1 font-medium transition ${
                    styleScope === id
                      ? "bg-white text-blue-600 shadow-2xs"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          {/* Format Painter */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                primaryTopic &&
                setStyleClipboard({ shape: primaryTopic.shape, style: primaryTopic.style })
              }
              className="flex flex-1 items-center justify-center gap-1 rounded border border-slate-200 py-1.5 hover:bg-slate-50"
            >
              <ClipboardCopy className="h-3.5 w-3.5" /> {t.format.copyStyle}
            </button>
            <button
              type="button"
              disabled={!styleClipboard}
              onClick={() =>
                styleClipboard &&
                dispatch({
                  type: "topic/setStyle",
                  sheetId: sheet.id,
                  topicIds: targetIds,
                  shape: styleClipboard.shape,
                  style: styleClipboard.style,
                })
              }
              className="flex flex-1 items-center justify-center gap-1 rounded border border-slate-200 py-1.5 hover:bg-slate-50 disabled:opacity-40"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t.format.pasteStyle}
            </button>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "topic/setStyle", sheetId: sheet.id, topicIds: targetIds, clear: true })
              }
              className="rounded border border-slate-200 p-1.5 hover:bg-slate-50"
              title={t.format.clearStyle}
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Shape Grid */}
          <Section title={t.format.nodeShape}>
            <div className="grid grid-cols-4 gap-1.5">
              {SHAPE_IDS.map((shapeId) => {
                const active = (primaryTopic?.shape ?? "auto") === shapeId;
                return (
                  <button
                    key={shapeId}
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "topic/setStyle",
                        sheetId: sheet.id,
                        topicIds: targetIds,
                        shape: shapeId,
                      })
                    }
                    className={`flex flex-col items-center gap-1 rounded-lg border py-1.5 text-[10px] transition ${
                      active
                        ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <ShapeIcon shape={shapeId} />
                    <span>{t.shapes[shapeId]}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Fill Color */}
          <Section title={t.format.fillColor}>
            <div className="grid grid-cols-6 gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "topic/setStyle",
                      sheetId: sheet.id,
                      topicIds: targetIds,
                      style: { fillColor: c },
                    })
                  }
                  className="h-6 w-full rounded border border-slate-200 transition hover:scale-110"
                  style={{ backgroundColor: hex8ToCss(c) }}
                />
              ))}
            </div>
          </Section>

          {/* Text Color */}
          <Section title={t.format.textColor}>
            <div className="grid grid-cols-6 gap-1.5">
              {SWATCHES.slice(0, 6)
                .concat(["#FFFFFFFF", "#64748BFF"])
                .map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "topic/setStyle",
                        sheetId: sheet.id,
                        topicIds: targetIds,
                        style: { textColor: c },
                      })
                    }
                    className="h-6 w-full rounded border border-slate-200 transition hover:scale-110"
                    style={{ backgroundColor: hex8ToCss(c) }}
                  />
                ))}
            </div>
          </Section>

          {/* Font Size */}
          <Section title={t.format.fontSize}>
            <div className="flex items-center gap-1.5">
              {[12, 14, 16, 20, 24].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "topic/setStyle",
                      sheetId: sheet.id,
                      topicIds: targetIds,
                      style: { fontSize: sz },
                    })
                  }
                  className="flex-1 rounded border border-slate-200 py-1 hover:bg-slate-50"
                >
                  {sz}
                </button>
              ))}
            </div>
          </Section>

          {/* Per-branch Structure Override */}
          <Section title={t.format.branchStructure}>
            <select
              value={primaryTopic?.structure ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "topic/setStructure",
                  sheetId: sheet.id,
                  topicId: primaryId,
                  structure: (e.target.value || undefined) as MindmapStructure | undefined,
                })
              }
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5"
            >
              <option value="">{t.format.inheritStructure}</option>
              {STRUCTURE_IDS.map((structureId) => (
                <option key={structureId} value={structureId}>
                  {t.structures[structureId]}
                </option>
              ))}
            </select>
          </Section>
        </Tabs.Content>

        {/* TAB 2: Canvas Structure & Theme */}
        <Tabs.Content value="canvas" className="flex-1 space-y-4 overflow-y-auto p-3">
          <Section title={t.format.canvasStructure}>
            <div className="grid grid-cols-3 gap-1.5">
              {STRUCTURE_IDS.map((structureId) => {
                const active = sheet.structure === structureId;
                return (
                  <button
                    key={structureId}
                    type="button"
                    onClick={() =>
                      dispatch({ type: "sheet/setLayout", sheetId: sheet.id, structure: structureId })
                    }
                    className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-[11px] transition ${
                      active
                        ? "border-blue-500 bg-blue-50/90 font-semibold text-blue-700 shadow-xs"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <StructureIcon
                      structure={structureId}
                      rootColor={active ? "#1D4ED8" : "#334155"}
                      accentColor={active ? "#3B82F6" : "#64748B"}
                      secondaryColor={active ? "#10B981" : "#94A3B8"}
                      className="h-6 w-10"
                    />
                    <span>{t.structures[structureId]}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title={t.format.spacing}>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["compact", t.format.spacingCompact],
                  ["balanced", t.format.spacingBalanced],
                  ["spacious", t.format.spacingSpacious],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    dispatch({ type: "sheet/setLayout", sheetId: sheet.id, spacing: id })
                  }
                  className={`rounded border py-1.5 ${
                    sheet.spacing === id
                      ? "border-blue-500 bg-blue-50 font-medium text-blue-700"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t.format.skeleton}>
            <div className="space-y-1.5">
              {SKELETON_LIST.map((sk) => {
                const info = getSkeletonInfo(sk.id, locale);
                return (
                  <button
                    key={sk.id}
                    type="button"
                    onClick={() => setTheme({ skeletonId: sk.id })}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                      theme.skeletonId === sk.id && !theme.topicStyles
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-semibold text-slate-800">{info.name}</div>
                    <div className="text-[10px] text-slate-500">{info.description}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title={t.format.palette}>
            <div className="grid grid-cols-2 gap-1.5">
              {PALETTE_LIST.map((pal) => (
                <button
                  key={pal.id}
                  type="button"
                  onClick={() => setTheme({ paletteId: pal.id })}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${
                    theme.paletteId === pal.id && !theme.canvasColor && !theme.branchColors
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 overflow-hidden rounded-full border border-black/10"
                    style={{ backgroundColor: hex8ToCss(pal.canvasBg) }}
                  >
                    <span
                      className="h-full w-1/2"
                      style={{ backgroundColor: hex8ToCss(pal.rootFill) }}
                    />
                    <span
                      className="h-full w-1/2"
                      style={{ backgroundColor: hex8ToCss(pal.branches[0]) }}
                    />
                  </span>
                  <span className="truncate text-[11px] font-medium">{getPaletteLabel(pal.id, locale)}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title={t.format.styleSwitches}>
            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
              <label className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-2 font-medium text-slate-700">
                  <Palette className="h-3.5 w-3.5 text-slate-500" /> {t.format.rainbowBranches}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={theme.rainbowBranches}
                  onClick={() =>
                    setTheme({ rainbowBranches: !theme.rainbowBranches })
                  }
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    theme.rainbowBranches ? "bg-blue-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
                      theme.rainbowBranches ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-2 font-medium text-slate-700">
                  <Pencil className="h-3.5 w-3.5 text-slate-500" /> {t.format.handdrawn}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={theme.handdrawn}
                  onClick={() =>
                    setTheme({ handdrawn: !theme.handdrawn })
                  }
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    theme.handdrawn ? "bg-blue-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
                      theme.handdrawn ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
            </div>
          </Section>
        </Tabs.Content>

        {/* TAB 3: Markers, Stickers & Rich Content */}
        <Tabs.Content value="markers" className="flex-1 space-y-4 overflow-y-auto p-3">
          <Section title={t.format.vectorMarkers(MARKER_CATALOG.length)}>
            <div className="grid grid-cols-7 gap-1.5">
              {MARKER_CATALOG.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "topic/toggleMarker",
                      sheetId: sheet.id,
                      topicId: primaryId,
                      marker: m.id,
                    })
                  }
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold shadow-xs transition hover:scale-110"
                  style={{ backgroundColor: m.bg, color: m.fg }}
                  title={`${t.markerGroups[m.group] ?? m.group}: ${m.id}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t.format.stickers}>
            <div className="grid grid-cols-4 gap-1.5">
              {STICKER_CATALOG.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "topic/setSticker",
                      sheetId: sheet.id,
                      topicId: primaryId,
                      stickerId: primaryTopic?.stickerId === st.id ? undefined : st.id,
                    })
                  }
                  className={`flex h-9 items-center justify-center rounded-lg border text-lg transition hover:scale-105 ${
                    primaryTopic?.stickerId === st.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                  title={t.stickers[st.id] ?? st.label}
                >
                  {st.emoji}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t.format.taskStatus}>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: primaryId, status: "todo" })
                }
                className="rounded border border-slate-200 py-1.5 hover:bg-slate-50"
              >
                {t.format.taskTodo}
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: primaryId, status: "done" })
                }
                className="rounded border border-slate-200 py-1.5 hover:bg-slate-50"
              >
                {t.format.taskDone}
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: primaryId, status: null })
                }
                className="rounded border border-slate-200 py-1.5 hover:bg-slate-50"
              >
                {t.format.taskRemove}
              </button>
            </div>
          </Section>

          <Section title={t.format.equation}>
            <input
              type="text"
              placeholder={t.format.equationPlaceholder}
              value={primaryTopic?.equation?.latex ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "topic/setEquation",
                  sheetId: sheet.id,
                  topicId: primaryId,
                  latex: e.target.value,
                })
              }
              className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-[11px] outline-none focus:border-blue-500"
            />
          </Section>

          <Section title={t.format.labels}>
            <input
              type="text"
              placeholder={t.format.labelsPlaceholder}
              value={(primaryTopic?.labels ?? []).join(", ")}
              onChange={(e) =>
                dispatch({
                  type: "topic/setLabels",
                  sheetId: sheet.id,
                  topicId: primaryId,
                  labels: e.target.value.split(/[,，]/),
                })
              }
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-[11px] outline-none focus:border-blue-500"
            />
          </Section>

          <Section title={t.format.note}>
            <textarea
              rows={3}
              placeholder={t.format.notePlaceholder}
              value={primaryTopic?.note?.text ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "topic/setNote",
                  sheetId: sheet.id,
                  topicId: primaryId,
                  text: e.target.value,
                })
              }
              className="w-full rounded border border-slate-200 p-2 text-[11px] outline-none focus:border-blue-500"
            />
          </Section>
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-1.5">
    <div className="text-[11px] font-semibold text-slate-500">{title}</div>
    {children}
  </div>
);
