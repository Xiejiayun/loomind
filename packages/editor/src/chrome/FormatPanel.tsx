import React from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ClipboardCopy, ClipboardPaste, Eraser, Pencil } from "lucide-react";
import {
  collectAllTopics,
  hex8ToCss,
  PALETTE_LIST,
  SKELETON_LIST,
  type MindmapStructure,
  type TopicShape,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";

const STRUCTURES: Array<{ id: MindmapStructure; label: string }> = [
  { id: "mindmap", label: "思维导图" },
  { id: "logic", label: "逻辑图" },
  { id: "org", label: "组织结构" },
  { id: "brace", label: "括号图" },
  { id: "indented", label: "缩进目录" },
  { id: "timeline", label: "时间轴" },
  { id: "fishbone", label: "鱼骨图" },
  { id: "treeTable", label: "树型表格" },
  { id: "matrix", label: "矩阵图" },
];

const SHAPES: Array<{ id: TopicShape; label: string }> = [
  { id: "auto", label: "自动" },
  { id: "rounded", label: "圆角" },
  { id: "pill", label: "药丸" },
  { id: "capsule", label: "胶囊" },
  { id: "underline", label: "下划线" },
  { id: "diamond", label: "菱形" },
  { id: "hexagon", label: "六边形" },
  { id: "cloud", label: "云朵" },
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

export const FormatPanel: React.FC = () => {
  const open = useMindmapStore((s) => s.formatPanelOpen);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const doc = useMindmapStore((s) => s.doc);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const styleClipboard = useMindmapStore((s) => s.styleClipboard);
  const setStyleClipboard = useMindmapStore((s) => s.setStyleClipboard);
  const dispatch = useMindmapStore((s) => s.dispatch);

  if (!open || zenMode) return null;

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const theme = { ...doc.theme, ...sheet.theme };
  const topicMap = collectAllTopics(sheet);
  const primaryId = selectedTopicIds[0] ?? sheet.rootTopic.id;
  const primaryTopic = topicMap.get(primaryId);
  const targetIds = selectedTopicIds.length > 0 ? selectedTopicIds : [sheet.rootTopic.id];

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-slate-200 bg-white text-xs text-slate-700">
      <Tabs.Root defaultValue="canvas" className="flex h-full flex-col">
        <Tabs.List className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1">
          <Tabs.Trigger
            value="style"
            className="rounded py-1.5 font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
          >
            样式
          </Tabs.Trigger>
          <Tabs.Trigger
            value="canvas"
            className="rounded py-1.5 font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
          >
            画布
          </Tabs.Trigger>
          <Tabs.Trigger
            value="markers"
            className="rounded py-1.5 font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
          >
            图标贴纸
          </Tabs.Trigger>
        </Tabs.List>

        {/* TAB 1: Node Style */}
        <Tabs.Content value="style" className="flex-1 space-y-4 overflow-y-auto p-3">
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
              <ClipboardCopy className="h-3.5 w-3.5" /> 复制样式
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
              <ClipboardPaste className="h-3.5 w-3.5" /> 粘贴样式
            </button>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "topic/setStyle", sheetId: sheet.id, topicIds: targetIds, clear: true })
              }
              className="rounded border border-slate-200 p-1.5 hover:bg-slate-50"
              title="清除样式"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Shape Grid */}
          <Section title="节点形状">
            <div className="grid grid-cols-4 gap-1.5">
              {SHAPES.map((sh) => (
                <button
                  key={sh.id}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "topic/setStyle",
                      sheetId: sheet.id,
                      topicIds: targetIds,
                      shape: sh.id,
                    })
                  }
                  className={`rounded border py-1.5 text-[11px] hover:bg-slate-50 ${
                    (primaryTopic?.shape ?? "auto") === sh.id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200"
                  }`}
                >
                  {sh.label}
                </button>
              ))}
            </div>
          </Section>

          {/* Fill Color */}
          <Section title="填充色">
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
          <Section title="文字颜色">
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
          <Section title="字号与粗细">
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
          <Section title="分支独立结构（混排）">
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
              <option value="">继承画布默认结构</option>
              {STRUCTURES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          </Section>
        </Tabs.Content>

        {/* TAB 2: Canvas Structure & Theme */}
        <Tabs.Content value="canvas" className="flex-1 space-y-4 overflow-y-auto p-3">
          <Section title="画布结构">
            <div className="grid grid-cols-3 gap-1.5">
              {STRUCTURES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() =>
                    dispatch({ type: "sheet/setLayout", sheetId: sheet.id, structure: st.id })
                  }
                  className={`flex flex-col items-center rounded-lg border p-2 text-[11px] transition ${
                    sheet.structure === st.id
                      ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span>{st.label}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="布局间距">
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["compact", "紧凑"],
                  ["balanced", "均衡"],
                  ["spacious", "宽松"],
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

          <Section title="视觉骨架 (Skeleton)">
            <div className="space-y-1.5">
              {SKELETON_LIST.map((sk) => (
                <button
                  key={sk.id}
                  type="button"
                  onClick={() => dispatch({ type: "theme/set", patch: { skeletonId: sk.id } })}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                    theme.skeletonId === sk.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-semibold text-slate-800">{sk.name}</div>
                  <div className="text-[10px] text-slate-500">{sk.description}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="配色方案 (Palette)">
            <div className="grid grid-cols-2 gap-1.5">
              {PALETTE_LIST.map((pal) => (
                <button
                  key={pal.id}
                  type="button"
                  onClick={() => dispatch({ type: "theme/set", patch: { paletteId: pal.id } })}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${
                    theme.paletteId === pal.id
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
                  <span className="truncate text-[11px] font-medium">{pal.name}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="风格开关">
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center justify-between">
                <span>彩虹分支配色</span>
                <input
                  type="checkbox"
                  checked={theme.rainbowBranches}
                  onChange={(e) =>
                    dispatch({ type: "theme/set", patch: { rainbowBranches: e.target.checked } })
                  }
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-1">
                  <Pencil className="h-3.5 w-3.5" /> 手绘草图风格
                </span>
                <input
                  type="checkbox"
                  checked={theme.handdrawn}
                  onChange={(e) =>
                    dispatch({ type: "theme/set", patch: { handdrawn: e.target.checked } })
                  }
                />
              </label>
            </div>
          </Section>
        </Tabs.Content>

        {/* TAB 3: Markers & Stickers */}
        <Tabs.Content value="markers" className="flex-1 space-y-4 overflow-y-auto p-3">
          <Section title="矢量标记 (Markers)">
            <div className="grid grid-cols-6 gap-1.5">
              {MARKERS.map((m) => (
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
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shadow-xs transition hover:scale-110"
                  style={{ backgroundColor: m.bg, color: m.fg }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="贴纸 (Stickers)">
            <div className="grid grid-cols-4 gap-2">
              {STICKERS.map((st) => (
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
                  className={`flex h-10 items-center justify-center rounded-lg border text-xl transition hover:scale-105 ${
                    primaryTopic?.stickerId === st.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {st.emoji}
                </button>
              ))}
            </div>
          </Section>

          <Section title="任务状态">
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: primaryId, status: "todo" })
                }
                className="rounded border border-slate-200 py-1.5 hover:bg-slate-50"
              >
                待办
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: primaryId, status: "done" })
                }
                className="rounded border border-slate-200 py-1.5 hover:bg-slate-50"
              >
                已完成
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: primaryId, status: null })
                }
                className="rounded border border-slate-200 py-1.5 hover:bg-slate-50"
              >
                移除
              </button>
            </div>
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
