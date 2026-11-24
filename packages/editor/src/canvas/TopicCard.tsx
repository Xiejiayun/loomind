import React from "react";
import { Check, ExternalLink, FileText, Plus, Minus } from "lucide-react";
import {
  hex8ToCss,
  isDarkFill,
  richTextToPlainText,
  type InlineAsset,
  type LayoutNode,
  type MindmapTopic,
  type RichTextDoc,
} from "@mindmap/core";
import { MARKER_BY_ID, STICKER_BY_ID } from "../chrome/markers-catalog.js";
import { EquationView } from "./EquationView.js";
import { TopicEditor } from "./TopicEditor.js";

const MARKER_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  "priority:1": { label: "1", bg: "#EF4444", fg: "#FFF" },
  "priority:2": { label: "2", bg: "#F97316", fg: "#FFF" },
  "priority:3": { label: "3", bg: "#EAB308", fg: "#FFF" },
  "priority:4": { label: "4", bg: "#22C55E", fg: "#FFF" },
  "priority:5": { label: "5", bg: "#3B82F6", fg: "#FFF" },
  "priority:6": { label: "6", bg: "#8B5CF6", fg: "#FFF" },
  "priority:7": { label: "7", bg: "#64748B", fg: "#FFF" },
  "flag:red": { label: "⚑", bg: "#FEE2E2", fg: "#DC2626" },
  "flag:blue": { label: "⚑", bg: "#DBEAFE", fg: "#2563EB" },
  "flag:green": { label: "⚑", bg: "#DCFCE7", fg: "#16A34A" },
  "flag:yellow": { label: "⚑", bg: "#FEF9C3", fg: "#CA8A04" },
  "star:gold": { label: "★", bg: "#FEF3C7", fg: "#D97706" },
  "progress:start": { label: "◔", bg: "#E0F2FE", fg: "#0284C7" },
  "progress:half": { label: "◑", bg: "#DBEAFE", fg: "#2563EB" },
  "progress:done": { label: "●", bg: "#DCFCE7", fg: "#16A34A" },
};

const STICKER_EMOJI: Record<string, string> = {
  rocket: "🚀",
  lightbulb: "💡",
  target: "🎯",
  fire: "🔥",
  trophy: "🏆",
  chart: "📈",
  brain: "🧠",
  sparkles: "✨",
};

function renderRichText(doc: RichTextDoc, nowrap: boolean): React.ReactNode {
  return doc.content.map((p, pi) => (
    <div key={pi} className={nowrap ? "whitespace-nowrap" : "whitespace-pre-wrap break-words"}>
      {p.content && p.content.length > 0
        ? p.content.map((node, ni) => {
            let el: React.ReactNode = node.text;
            const style: React.CSSProperties = {};
            if (node.marks) {
              for (const m of node.marks) {
                if (m.type === "bold") el = <strong key={`b-${ni}`}>{el}</strong>;
                else if (m.type === "italic") el = <em key={`i-${ni}`}>{el}</em>;
                else if (m.type === "strike") el = <s key={`s-${ni}`}>{el}</s>;
                else if (m.type === "code")
                  el = (
                    <code key={`c-${ni}`} className="rounded bg-black/10 px-1 font-mono text-[0.9em]">
                      {el}
                    </code>
                  );
                else if (m.type === "textStyle" && m.attrs?.color) style.color = m.attrs.color;
                else if (m.type === "highlight")
                  style.backgroundColor = m.attrs?.backgroundColor ?? "#FEF08A";
              }
            }
            return (
              <span key={ni} style={style}>
                {el}
              </span>
            );
          })
        : "\u00A0"}
    </div>
  ));
}

export interface TopicCardProps {
  topic: MindmapTopic;
  layoutNode: LayoutNode;
  selected: boolean;
  editing: boolean;
  initialEditChar?: string;
  lodLow: boolean;
  asset?: InlineAsset;
  onSelect: (topicId: string, e: React.MouseEvent) => void;
  onStartEdit: (topicId: string) => void;
  onCommitEdit: (topicId: string, doc: RichTextDoc) => void;
  onCancelEdit: () => void;
  onToggleCollapse: (topicId: string) => void;
  onToggleTask: (topicId: string) => void;
  onStartDrag: (topicId: string, e: React.PointerEvent) => void;
  onStartResizeWidth: (topicId: string, e: React.PointerEvent) => void;
  onContextMenu: (topicId: string, e: React.MouseEvent) => void;
}

export const TopicCard: React.FC<TopicCardProps> = React.memo(
  ({
    topic,
    layoutNode,
    selected,
    editing,
    initialEditChar,
    lodLow,
    asset,
    onSelect,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onToggleCollapse,
    onToggleTask,
    onStartDrag,
    onStartResizeWidth,
    onContextMenu,
  }) => {
    const darkBg = !layoutNode.underlineMode && isDarkFill(layoutNode.fillColor);
    const fillCss = layoutNode.underlineMode ? "transparent" : hex8ToCss(layoutNode.fillColor);
    const strokeCss = hex8ToCss(layoutNode.strokeColor);
    const textCss = hex8ToCss(layoutNode.textColor);
    const accentCss = hex8ToCss(layoutNode.accentColor);

    const relContentTop = layoutNode.contentBox.y - layoutNode.box.y;

    const cardStyle: React.CSSProperties = {
      width: layoutNode.contentBox.width,
      minHeight: layoutNode.contentBox.height,
      marginTop: relContentTop,
      backgroundColor: fillCss,
      color: textCss,
      borderRadius: layoutNode.underlineMode ? 0 : layoutNode.cornerRadius,
      borderBottom: layoutNode.underlineMode
        ? `${Math.max(1.2, layoutNode.strokeWidth)}px solid ${strokeCss}`
        : layoutNode.strokeWidth > 0
          ? `${layoutNode.strokeWidth}px solid ${strokeCss}`
          : "none",
      borderTop:
        !layoutNode.underlineMode && layoutNode.strokeWidth > 0
          ? `${layoutNode.strokeWidth}px solid ${strokeCss}`
          : "none",
      borderLeft:
        !layoutNode.underlineMode && layoutNode.strokeWidth > 0
          ? `${layoutNode.strokeWidth}px solid ${strokeCss}`
          : "none",
      borderRight:
        !layoutNode.underlineMode && layoutNode.strokeWidth > 0
          ? `${layoutNode.strokeWidth}px solid ${strokeCss}`
          : "none",
      boxShadow:
        layoutNode.depth === 0
          ? "0 8px 24px -6px rgba(15,23,42,0.22)"
          : layoutNode.depth === 1 && !layoutNode.underlineMode
            ? "0 2px 8px -2px rgba(15,23,42,0.08)"
            : undefined,
      clipPath:
        layoutNode.shape === "diamond"
          ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
          : layoutNode.shape === "hexagon"
            ? "polygon(12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%, 0% 50%)"
            : undefined,
    };

    return (
      <div
        data-topic-id={topic.id}
        className="group relative select-none"
        style={{ width: layoutNode.box.width, height: layoutNode.box.height }}
        onClick={(e) => onSelect(topic.id, e)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEdit(topic.id);
        }}
        onPointerDown={(e) => {
          if (e.button === 0 && !editing) onStartDrag(topic.id, e);
        }}
        onContextMenu={(e) => onContextMenu(topic.id, e)}
      >
        {/* Callout Bubble above contentBox */}
        {topic.callout && layoutNode.calloutBox && !lodLow && (
          <div
            className="absolute flex items-center justify-center rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 shadow-sm ring-1 ring-amber-300"
            style={{
              left: layoutNode.calloutBox.x - layoutNode.box.x,
              top: 0,
              width: layoutNode.calloutBox.width,
              height: layoutNode.calloutBox.height,
            }}
          >
            <span className="truncate">{richTextToPlainText(topic.callout.title)}</span>
            <span className="absolute -bottom-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-amber-300 bg-amber-100" />
          </div>
        )}

        {/* Main Topic Card */}
        <div
          className={`relative box-border flex flex-col justify-center ${
            selected ? "ring-2 ring-blue-500 ring-offset-2" : "hover:ring-1 hover:ring-blue-300/70"
          }`}
          style={{
            ...cardStyle,
            padding: `${layoutNode.paddingY}px ${layoutNode.paddingX}px`,
          }}
        >
          {/* Top Image */}
          {topic.image?.pos === "top" && asset && !lodLow && (
            <img
              src={`data:${asset.mimeType};base64,${asset.dataBase64}`}
              alt=""
              className="mx-auto mb-2 rounded object-contain"
              style={{ maxWidth: Math.min(topic.image.width, 220), maxHeight: Math.min(topic.image.height, 140) }}
              draggable={false}
            />
          )}

          {/* Main Horizontal Row */}
          <div className="flex items-center gap-1.5">
            {!lodLow && layoutNode.taskSummary && (
              <svg width={16} height={16} viewBox="0 0 20 20" className="shrink-0">
                <circle
                  cx={10}
                  cy={10}
                  r={7.5}
                  fill="none"
                  stroke={darkBg ? "rgba(248,250,252,0.28)" : "rgba(15,23,42,0.16)"}
                  strokeWidth={2.5}
                />
                <circle
                  cx={10}
                  cy={10}
                  r={7.5}
                  fill="none"
                  stroke={darkBg ? "#34D399" : accentCss}
                  strokeWidth={2.5}
                  strokeDasharray={`${(layoutNode.taskSummary.done / layoutNode.taskSummary.total) * 47.1} 47.1`}
                  transform="rotate(-90 10 10)"
                />
              </svg>
            )}

            {!lodLow && !layoutNode.taskSummary && topic.task && (
              <button
                type="button"
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  topic.task.status === "done"
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : darkBg
                      ? "border-slate-300 bg-transparent"
                      : "border-slate-400 bg-white"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTask(topic.id);
                }}
                title="切换任务状态"
              >
                {topic.task.status === "done" && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
            )}

            {!lodLow &&
              topic.markers?.map((m) => {
                const info = MARKER_BY_ID.get(m);
                if (!info) return null;
                return (
                  <span
                    key={m}
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: info.bg, color: info.fg }}
                  >
                    {info.label}
                  </span>
                );
              })}

            {!lodLow && topic.stickerId && STICKER_BY_ID.has(topic.stickerId) && (
              <span className="shrink-0 text-lg leading-none">
                {STICKER_BY_ID.get(topic.stickerId)!.emoji}
              </span>
            )}

            {/* Title or TipTap Editor */}
            <div
              className={`min-w-0 flex-1 ${topic.task?.status === "done" ? "line-through opacity-65" : ""}`}
              style={{
                fontSize: layoutNode.fontSize,
                fontWeight: layoutNode.fontWeight,
                lineHeight: 1.42,
              }}
            >
              {editing ? (
                <TopicEditor
                  initialDoc={topic.title}
                  initialChar={initialEditChar}
                  fontSize={layoutNode.fontSize}
                  fontWeight={layoutNode.fontWeight}
                  textColor={textCss}
                  onCommit={(d) => onCommitEdit(topic.id, d)}
                  onCancel={onCancelEdit}
                />
              ) : (
                renderRichText(
                  topic.title,
                  !topic.customWidth && !richTextToPlainText(topic.title).includes("\n") && richTextToPlainText(topic.title).length <= 24,
                )
              )}
            </div>

            {!lodLow && topic.href && (
              <a
                href={topic.href.kind === "url" ? topic.href.target : undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 opacity-70 hover:opacity-100"
                title={topic.href.label ?? topic.href.target}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            {!lodLow && topic.note && (
              <span className="shrink-0 opacity-70" title={topic.note.text}>
                <FileText className="h-3.5 w-3.5" />
              </span>
            )}
          </div>

          {/* Labels */}
          {!lodLow && topic.labels && topic.labels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {topic.labels.map((label) => (
                <span
                  key={label}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: darkBg ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.07)",
                    color: darkBg ? "#F8FAFC" : "#334155",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Subtitle */}
          {!lodLow && topic.subtitle && (
            <div
              className="mt-1 text-[11px]"
              style={{ color: darkBg ? "rgba(248,250,252,0.75)" : "rgba(71,85,105,0.8)" }}
            >
              {topic.subtitle}
            </div>
          )}

          {/* KaTeX Equation (lazy loaded) */}
          {!lodLow && topic.equation?.latex && <EquationView latex={topic.equation.latex} />}

          {/* Right-edge Width Resize Handle */}
          {selected && !editing && (
            <div
              className="absolute -right-1 top-1 bottom-1 w-2 cursor-ew-resize rounded hover:bg-blue-400/50"
              onPointerDown={(e) => {
                e.stopPropagation();
                onStartResizeWidth(topic.id, e);
              }}
              title="拖动调整宽度"
            />
          )}

          {/* Collapse / Expand Badge */}
          {topic.children.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(topic.id);
              }}
              className={`absolute top-1/2 z-20 flex h-5 min-w-[20px] -translate-y-1/2 items-center justify-center rounded-full px-1 text-[10px] font-semibold shadow-sm transition-opacity ${
                layoutNode.side === "left" ? "-left-3" : "-right-3"
              } ${
                topic.collapsed
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
              style={{
                backgroundColor: darkBg ? "#334155" : "#FFFFFF",
                color: darkBg ? "#F8FAFC" : accentCss,
                border: `1.5px solid ${accentCss}`,
              }}
              title={topic.collapsed ? "展开子分支" : "折叠子分支"}
            >
              {topic.collapsed ? (
                <span>+{layoutNode.hiddenCount}</span>
              ) : (
                <Minus className="h-2.5 w-2.5" />
              )}
            </button>
          )}
        </div>
      </div>
    );
  },
);
TopicCard.displayName = "TopicCard";
