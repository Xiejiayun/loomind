import React, { useEffect } from "react";
import {
  Braces,
  CornerDownRight,
  Focus,
  MessageSquare,
  Plus,
  Sparkles,
  SquareDashedBottom,
  Trash2,
} from "lucide-react";
import { createRichText, createTopic, findTopicLocation, generateId } from "@mindmap/core";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";

interface ContextMenuProps {
  menu: { topicId: string; x: number; y: number } | null;
  isDark?: boolean;
  onClose: () => void;
  onOpenAiForTopic?: (topicId: string) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  menu,
  isDark = false,
  onClose,
  onOpenAiForTopic,
}) => {
  const doc = useMindmapStore((s) => s.doc);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const setEditingTopicId = useMindmapStore((s) => s.setEditingTopicId);
  const setDrillRootId = useMindmapStore((s) => s.setDrillRootId);
  const { t } = useEditorI18n();

  useEffect(() => {
    if (!menu) return;
    const hide = () => onClose();
    window.addEventListener("click", hide);
    return () => window.removeEventListener("click", hide);
  }, [menu, onClose]);

  if (!menu) return null;

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const isRoot = menu.topicId === sheet.rootTopic.id;
  const deletedSet = new Set(doc.deletedIds);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  const sepCls = isDark ? "my-1 h-px bg-white/[0.075]" : "my-1 h-px bg-slate-900/[0.08]";

  return (
    <div
      className={`fixed z-50 min-w-[196px] rounded-lg border p-1 text-xs shadow-2xl ${
        isDark
          ? "border-white/[0.12] bg-[#15171c] text-[#f4f5f8]"
          : "border-slate-900/[0.1] bg-white text-[#111318]"
      }`}
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {onOpenAiForTopic && (
        <>
          <MenuItem
            icon={<Sparkles className="h-3.5 w-3.5 opacity-80" />}
            label={t.contextMenu.aiQuick}
            isDark={isDark}
            onClick={() =>
              run(() => {
                selectTopics([menu.topicId]);
                onOpenAiForTopic(menu.topicId);
              })
            }
          />
          <div className={sepCls} />
        </>
      )}
      <MenuItem
        icon={<CornerDownRight className="h-3.5 w-3.5" />}
        label={t.contextMenu.addChild}
        isDark={isDark}
        onClick={() =>
          run(() => {
            const newId = generateId("t", deletedSet);
            dispatch({ type: "topic/addChild", sheetId: sheet.id, parentId: menu.topicId, newId });
            selectTopics([newId]);
            requestAnimationFrame(() => setEditingTopicId(newId));
          })
        }
      />
      {!isRoot && (
        <MenuItem
          icon={<Plus className="h-3.5 w-3.5" />}
          label={t.contextMenu.addSibling}
          isDark={isDark}
          onClick={() =>
            run(() => {
              const newId = generateId("t", deletedSet);
              dispatch({
                type: "topic/addSibling",
                sheetId: sheet.id,
                targetId: menu.topicId,
                position: "after",
                newId,
              });
              selectTopics([newId]);
              requestAnimationFrame(() => setEditingTopicId(newId));
            })
          }
        />
      )}
      <div className={sepCls} />
      <MenuItem
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        label={t.contextMenu.addCallout}
        isDark={isDark}
        onClick={() =>
          run(() =>
            dispatch({
              type: "topic/setCallout",
              sheetId: sheet.id,
              topicId: menu.topicId,
              callout: { id: generateId("co", deletedSet), title: createRichText(t.contextMenu.defaultCallout) },
            }),
          )
        }
      />
      <MenuItem
        icon={<SquareDashedBottom className="h-3.5 w-3.5" />}
        label={t.contextMenu.addBoundary}
        isDark={isDark}
        onClick={() =>
          run(() =>
            dispatch({
              type: "boundary/upsert",
              sheetId: sheet.id,
              boundary: {
                id: generateId("bnd", deletedSet),
                target: { kind: "subtree", topicId: menu.topicId },
                shape: "rounded",
                title: t.contextMenu.defaultBoundary,
              },
            }),
          )
        }
      />
      {!isRoot && (
        <MenuItem
          icon={<Braces className="h-3.5 w-3.5" />}
          label={t.contextMenu.addSummary}
          isDark={isDark}
          onClick={() =>
            run(() => {
              const loc = findTopicLocation(sheet, menu.topicId);
              if (!loc?.parent) return;
              dispatch({
                type: "summary/upsert",
                sheetId: sheet.id,
                summary: {
                  id: generateId("sum", deletedSet),
                  parentId: loc.parent.id,
                  startIndex: loc.index,
                  endIndex: loc.index,
                  brace: "curly",
                  topic: createTopic(generateId("sumt", deletedSet), t.contextMenu.defaultSummary),
                },
              });
            })
          }
        />
      )}
      {!isRoot && (
        <MenuItem
          icon={<Focus className="h-3.5 w-3.5" />}
          label={t.contextMenu.drillDown}
          isDark={isDark}
          onClick={() => run(() => setDrillRootId(menu.topicId))}
        />
      )}
      {!isRoot && (
        <>
          <div className={sepCls} />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label={t.contextMenu.deleteTopic}
            danger
            isDark={isDark}
            onClick={() =>
              run(() => {
                dispatch({ type: "topic/delete", sheetId: sheet.id, topicIds: [menu.topicId] });
                selectTopics([sheet.rootTopic.id]);
              })
            }
          />
        </>
      )}
    </div>
  );
};

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  accent?: boolean;
  isDark: boolean;
  onClick: () => void;
}> = ({ icon, label, danger, accent, isDark, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left transition ${
      danger
        ? isDark
          ? "text-red-400 hover:bg-red-500/15"
          : "text-red-600 hover:bg-red-50"
        : accent
          ? isDark
            ? "font-medium text-[#a5b0ff] hover:bg-[#5e6ad2]/20"
            : "font-medium text-[#4f5bd5] hover:bg-[#4f5bd5]/10"
          : isDark
            ? "text-[#d5d9e2] hover:bg-white/[0.07] hover:text-white"
            : "text-[#2c3340] hover:bg-slate-900/[0.05] hover:text-[#111318]"
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
