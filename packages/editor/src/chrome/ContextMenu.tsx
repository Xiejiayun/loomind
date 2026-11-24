import React, { useEffect } from "react";
import {
  Braces,
  CornerDownRight,
  Focus,
  MessageSquare,
  Plus,
  SquareDashedBottom,
  Trash2,
} from "lucide-react";
import { createRichText, createTopic, findTopicLocation, generateId } from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface ContextMenuProps {
  menu: { topicId: string; x: number; y: number } | null;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ menu, onClose }) => {
  const doc = useMindmapStore((s) => s.doc);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const setEditingTopicId = useMindmapStore((s) => s.setEditingTopicId);
  const setDrillRootId = useMindmapStore((s) => s.setDrillRootId);

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

  return (
    <div
      className="fixed z-50 min-w-[176px] rounded-xl border border-slate-200 bg-white p-1.5 text-xs text-slate-700 shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem
        icon={<CornerDownRight className="h-3.5 w-3.5" />}
        label="插入子主题 (Tab)"
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
          label="插入同级主题 (Enter)"
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
      <div className="my-1 h-px bg-slate-100" />
      <MenuItem
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        label="添加批注 (Callout)"
        onClick={() =>
          run(() =>
            dispatch({
              type: "topic/setCallout",
              sheetId: sheet.id,
              topicId: menu.topicId,
              callout: { id: generateId("co", deletedSet), title: createRichText("批注") },
            }),
          )
        }
      />
      <MenuItem
        icon={<SquareDashedBottom className="h-3.5 w-3.5" />}
        label="添加外框 (Boundary)"
        onClick={() =>
          run(() =>
            dispatch({
              type: "boundary/upsert",
              sheetId: sheet.id,
              boundary: {
                id: generateId("bnd", deletedSet),
                target: { kind: "subtree", topicId: menu.topicId },
                shape: "rounded",
                title: "外框",
              },
            }),
          )
        }
      />
      {!isRoot && (
        <MenuItem
          icon={<Braces className="h-3.5 w-3.5" />}
          label="添加概要 (Summary)"
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
                  topic: createTopic(generateId("sumt", deletedSet), "概要"),
                },
              });
            })
          }
        />
      )}
      {!isRoot && (
        <MenuItem
          icon={<Focus className="h-3.5 w-3.5" />}
          label="聚焦下钻 (F6)"
          onClick={() => run(() => setDrillRootId(menu.topicId))}
        />
      )}
      {!isRoot && (
        <>
          <div className="my-1 h-px bg-slate-100" />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
            label="删除主题"
            danger
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
  onClick: () => void;
}> = ({ icon, label, danger, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100 ${
      danger ? "text-red-600 hover:bg-red-50" : ""
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
