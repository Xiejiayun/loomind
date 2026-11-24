import React, { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import {
  createRichText,
  findTopicLocation,
  generateId,
  richTextToPlainText,
  type MindmapTopic,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface FlatOutlineRow {
  topic: MindmapTopic;
  depth: number;
  parentId: string | null;
}

function flattenTree(root: MindmapTopic): FlatOutlineRow[] {
  const rows: FlatOutlineRow[] = [];
  const walk = (t: MindmapTopic, depth: number, parentId: string | null) => {
    rows.push({ topic: t, depth, parentId });
    if (!t.collapsed) {
      for (const c of t.children) walk(c, depth + 1, t.id);
    }
  };
  walk(root, 0, null);
  return rows;
}

export const OutlinerView: React.FC = () => {
  const doc = useMindmapStore((s) => s.doc);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");

  const sheet = useMemo(
    () => doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0],
    [doc],
  );
  const rows = useMemo(() => flattenTree(sheet.rootTopic), [sheet.rootTopic]);
  const deletedSet = useMemo(() => new Set(doc.deletedIds), [doc.deletedIds]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === sheet.rootTopic.id) return;
    const overLoc = findTopicLocation(sheet, overId);
    if (!overLoc) return;

    if (overLoc.parent) {
      dispatch({
        type: "topic/reparent",
        sheetId: sheet.id,
        topicId: activeId,
        newParentId: overLoc.parent.id,
        index: overLoc.index,
      });
    } else {
      dispatch({
        type: "topic/reparent",
        sheetId: sheet.id,
        topicId: activeId,
        newParentId: overId,
        index: 0,
      });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-2 text-xs text-slate-400">
          <span>全屏大纲视图 · Tab 缩进 · Shift+Tab 升级 · Alt+↑/↓ 排序 · 拖拽重排</span>
          <span>{rows.length} 个主题</span>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((r) => r.topic.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-0.5">
              {rows.map((row) => (
                <OutlineItem
                  key={row.topic.id}
                  row={row}
                  isRoot={row.topic.id === sheet.rootTopic.id}
                  selected={selectedTopicIds.includes(row.topic.id)}
                  editing={editingId === row.topic.id}
                  draftText={draftText}
                  onDraftChange={setDraftText}
                  onSelect={() => selectTopics([row.topic.id])}
                  onStartEdit={() => {
                    setEditingId(row.topic.id);
                    setDraftText(richTextToPlainText(row.topic.title));
                  }}
                  onCommitEdit={() => {
                    dispatch({
                      type: "topic/setTitle",
                      sheetId: sheet.id,
                      topicId: row.topic.id,
                      title: createRichText(draftText),
                    });
                    setEditingId(null);
                  }}
                  onToggleCollapse={() =>
                    dispatch({ type: "topic/toggleCollapse", sheetId: sheet.id, topicId: row.topic.id })
                  }
                  onToggleTask={() =>
                    dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: row.topic.id })
                  }
                  onAddChild={() => {
                    const newId = generateId("t", deletedSet);
                    dispatch({ type: "topic/addChild", sheetId: sheet.id, parentId: row.topic.id, newId });
                    selectTopics([newId]);
                    setEditingId(newId);
                    setDraftText("子主题");
                  }}
                  onKeyAction={(action) => {
                    if (action === "indent") {
                      dispatch({ type: "topic/indent", sheetId: sheet.id, topicId: row.topic.id });
                    } else if (action === "outdent") {
                      dispatch({ type: "topic/outdent", sheetId: sheet.id, topicId: row.topic.id });
                    } else if (action === "up") {
                      dispatch({ type: "topic/reorder", sheetId: sheet.id, topicId: row.topic.id, delta: -1 });
                    } else if (action === "down") {
                      dispatch({ type: "topic/reorder", sheetId: sheet.id, topicId: row.topic.id, delta: 1 });
                    } else if (action === "sibling") {
                      const newId = generateId("t", deletedSet);
                      if (row.topic.id === sheet.rootTopic.id) {
                        dispatch({ type: "topic/addChild", sheetId: sheet.id, parentId: row.topic.id, newId });
                      } else {
                        dispatch({
                          type: "topic/addSibling",
                          sheetId: sheet.id,
                          targetId: row.topic.id,
                          position: "after",
                          newId,
                        });
                      }
                      selectTopics([newId]);
                      setEditingId(newId);
                      setDraftText("新主题");
                    }
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};

interface OutlineItemProps {
  row: FlatOutlineRow;
  isRoot: boolean;
  selected: boolean;
  editing: boolean;
  draftText: string;
  onDraftChange: (v: string) => void;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onToggleCollapse: () => void;
  onToggleTask: () => void;
  onAddChild: () => void;
  onKeyAction: (action: "indent" | "outdent" | "up" | "down" | "sibling") => void;
}

const OutlineItem: React.FC<OutlineItemProps> = ({
  row,
  isRoot,
  selected,
  editing,
  draftText,
  onDraftChange,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onToggleCollapse,
  onToggleTask,
  onAddChild,
  onKeyAction,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: row.topic.id,
    disabled: isRoot,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: row.depth * 24,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (editing) return;
        if (e.key === "Tab") {
          e.preventDefault();
          onKeyAction(e.shiftKey ? "outdent" : "indent");
        } else if (e.altKey && e.key === "ArrowUp") {
          e.preventDefault();
          onKeyAction("up");
        } else if (e.altKey && e.key === "ArrowDown") {
          e.preventDefault();
          onKeyAction("down");
        } else if (e.key === "Enter") {
          e.preventDefault();
          onKeyAction("sibling");
        }
      }}
      tabIndex={0}
      className={`group flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm outline-none ${
        selected ? "bg-blue-50/80 ring-1 ring-blue-300" : "hover:bg-slate-50"
      }`}
    >
      {!isRoot ? (
        <span {...attributes} {...listeners} className="cursor-grab text-slate-300 hover:text-slate-500">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="w-3.5" />
      )}

      {row.topic.children.length > 0 ? (
        <button type="button" onClick={onToggleCollapse} className="text-slate-400 hover:text-slate-700">
          {row.topic.collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      ) : (
        <span className="flex h-4 w-4 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        </span>
      )}

      {row.topic.task && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleTask();
          }}
          className={`flex h-4 w-4 items-center justify-center rounded border ${
            row.topic.task.status === "done"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 bg-white"
          }`}
        >
          {row.topic.task.status === "done" && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
      )}

      <div
        className={`flex-1 ${isRoot ? "text-lg font-bold text-slate-900" : row.depth === 1 ? "font-semibold text-slate-800" : "text-slate-700"} ${
          row.topic.task?.status === "done" ? "line-through opacity-60" : ""
        }`}
        onDoubleClick={onStartEdit}
      >
        {editing ? (
          <input
            value={draftText}
            autoFocus
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitEdit();
              } else if (e.key === "Escape") {
                onCommitEdit();
              }
            }}
            className="w-full rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <span>{richTextToPlainText(row.topic.title)}</span>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddChild();
        }}
        className="rounded p-1 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100"
        title="添加子主题"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
