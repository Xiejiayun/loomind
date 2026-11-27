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
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  GripVertical,
  HelpCircle,
  ListChecks,
  Maximize2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  createRichText,
  findTopicLocation,
  generateId,
  getPalette,
  richTextToPlainText,
  type MindmapTopic,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";

export interface OutlinerViewProps {
  isDark?: boolean;
  variant?: "full" | "sidebar";
  readOnly?: boolean;
  onSelectTopic?: (topicId: string) => void;
  onExpandFullscreen?: () => void;
  onClose?: () => void;
}

interface FlatOutlineRow {
  topic: MindmapTopic;
  depth: number;
  parentId: string | null;
  branchColor: string | null;
  hiddenDescendantCount: number;
}

function countDescendants(topic: MindmapTopic): number {
  let count = 0;
  for (const child of topic.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

function collectVisibleIds(
  root: MindmapTopic,
  query: string,
  tasksOnly: boolean,
): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q && !tasksOnly) return null;

  const visible = new Set<string>();
  const walk = (topic: MindmapTopic): boolean => {
    const title = richTextToPlainText(topic.title).toLowerCase();
    const note = (topic.note?.text ?? "").toLowerCase();
    const labels = (topic.labels ?? []).join(" ").toLowerCase();
    const textOk = !q || title.includes(q) || note.includes(q) || labels.includes(q);
    const taskOk = !tasksOnly || Boolean(topic.task);
    const selfMatch = textOk && taskOk;

    let childMatch = false;
    for (const c of topic.children) {
      if (walk(c)) childMatch = true;
    }

    if (selfMatch || childMatch) {
      visible.add(topic.id);
      return true;
    }
    return false;
  };

  walk(root);
  visible.add(root.id);
  return visible;
}

function flattenTree(
  root: MindmapTopic,
  branchColors: string[],
  visibleIds: Set<string> | null,
): FlatOutlineRow[] {
  const rows: FlatOutlineRow[] = [];
  const walk = (t: MindmapTopic, depth: number, parentId: string | null, branchColor: string | null) => {
    if (visibleIds && !visibleIds.has(t.id)) return;
    const forceExpand = Boolean(visibleIds);
    const collapsed = !forceExpand && Boolean(t.collapsed);
    rows.push({
      topic: t,
      depth,
      parentId,
      branchColor,
      hiddenDescendantCount: collapsed ? countDescendants(t) : 0,
    });
    if (!collapsed) {
      for (let i = 0; i < t.children.length; i++) {
        const c = t.children[i];
        const nextColor =
          depth === 0
            ? branchColors[i % Math.max(1, branchColors.length)] ?? null
            : branchColor;
        walk(c, depth + 1, t.id, nextColor);
      }
    }
  };
  walk(root, 0, null, null);
  return rows;
}

function collectCollapsibleTopicIds(root: MindmapTopic): { ids: string[]; anyExpanded: boolean } {
  const ids: string[] = [];
  let anyExpanded = false;
  const walk = (t: MindmapTopic, depth: number) => {
    if (depth > 0 && t.children.length > 0) {
      ids.push(t.id);
      if (!t.collapsed) anyExpanded = true;
    }
    for (const c of t.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return { ids, anyExpanded };
}

export const OutlinerView: React.FC<OutlinerViewProps> = ({
  isDark = false,
  variant = "full",
  readOnly = false,
  onSelectTopic,
  onExpandFullscreen,
  onClose,
}) => {
  const doc = useMindmapStore((s) => s.doc);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const { t } = useEditorI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tasksOnly, setTasksOnly] = useState(false);
  const [openNoteIds, setOpenNoteIds] = useState<Record<string, boolean>>({});

  const sheet = useMemo(
    () => doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0],
    [doc],
  );
  const palette = useMemo(
    () => getPalette({ ...doc.theme, ...sheet.theme }.paletteId, isDark ? "dark" : "light"),
    [doc.theme, sheet.theme, isDark],
  );
  const visibleIds = useMemo(
    () => collectVisibleIds(sheet.rootTopic, searchQuery, tasksOnly),
    [sheet.rootTopic, searchQuery, tasksOnly],
  );
  const rows = useMemo(
    () => flattenTree(sheet.rootTopic, palette.branches, visibleIds),
    [sheet.rootTopic, palette.branches, visibleIds],
  );
  const { ids: collapsibleIds, anyExpanded } = useMemo(
    () => collectCollapsibleTopicIds(sheet.rootTopic),
    [sheet.rootTopic],
  );
  const deletedSet = useMemo(() => new Set(doc.deletedIds), [doc.deletedIds]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const isSidebar = variant === "sidebar";
  const indentStep = isSidebar ? 16 : 24;

  const handleToggleExpandAll = () => {
    const targetCollapsed = anyExpanded;
    for (const id of collapsibleIds) {
      const loc = findTopicLocation(sheet, id);
      if (loc && Boolean(loc.topic.collapsed) !== targetCollapsed) {
        dispatch({ type: "topic/toggleCollapse", sheetId: sheet.id, topicId: id });
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (readOnly) return;
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

  const borderCls = isDark ? "border-white/[0.075]" : "border-slate-900/[0.08]";
  const subtleTextCls = isDark ? "text-[#9ca3b0]" : "text-[#525b6b]";
  const mutedTextCls = isDark ? "text-[#646b78]" : "text-[#8c95a4]";

  const toolbar = (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        isSidebar
          ? `shrink-0 border-b px-2.5 py-2 ${borderCls}`
          : `mb-5 justify-between border-b pb-3 ${borderCls}`
      }`}
    >
      {!isSidebar && (
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${isDark ? "text-[#f4f5f8]" : "text-slate-800"}`}>
            {t.outliner.fullTitle}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
              isDark ? "bg-white/[0.07] text-[#9ca3b0]" : "bg-slate-100 text-slate-600"
            }`}
          >
            {t.outliner.totalTopics(rows.length)}
          </span>
        </div>
      )}

      <div className={`flex items-center gap-1 ${isSidebar ? "w-full" : "flex-wrap"}`}>
        {/* Filter input */}
        <div
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11.5px] ${
            isDark
              ? "border-white/[0.09] bg-[#101114] text-[#f4f5f8] focus-within:border-white/[0.22]"
              : "border-slate-900/[0.1] bg-white text-[#111318] focus-within:border-slate-900/[0.25]"
          }`}
        >
          <Search className={`h-3 w-3 shrink-0 ${mutedTextCls}`} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.outliner.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[11.5px] outline-none placeholder:text-[#646b78]"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label={t.outliner.clearSearchAria}
              onClick={() => setSearchQuery("")}
              className={`rounded p-0.5 ${subtleTextCls} hover:opacity-100`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Tasks only filter */}
        <button
          type="button"
          onClick={() => setTasksOnly((v) => !v)}
          title={t.outliner.tasksOnly}
          aria-pressed={tasksOnly}
          className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border transition ${
            tasksOnly
              ? isDark
                ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-300"
                : "border-emerald-500/40 bg-emerald-50 text-emerald-700"
              : isDark
                ? "border-white/[0.08] text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white"
                : "border-slate-900/[0.08] text-[#525b6b] hover:bg-slate-100"
          }`}
        >
          <ListChecks className="h-3.5 w-3.5" />
        </button>

        {/* Expand / Collapse all */}
        {collapsibleIds.length > 0 && (
          <button
            type="button"
            onClick={handleToggleExpandAll}
            title={anyExpanded ? t.outliner.collapseAll : t.outliner.expandAll}
            className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border transition ${
              isDark
                ? "border-white/[0.08] text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white"
                : "border-slate-900/[0.08] text-[#525b6b] hover:bg-slate-100"
            }`}
          >
            {anyExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {/* Shortcuts tooltip */}
        <span
          title={t.outliner.shortcutsHint}
          className={`inline-grid h-6 w-6 shrink-0 cursor-help place-items-center rounded-[5px] ${mutedTextCls} hover:opacity-100`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </span>

        {isSidebar && onExpandFullscreen && (
          <button
            type="button"
            onClick={onExpandFullscreen}
            title={t.outliner.openFullscreen}
            className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border transition ${
              isDark
                ? "border-white/[0.08] text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white"
                : "border-slate-900/[0.08] text-[#525b6b] hover:bg-slate-100"
            }`}
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        )}

        {isSidebar && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t.outliner.closeSidebarAria}
            className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-[5px] transition ${
              isDark ? "text-[#9ca3b0] hover:bg-white/[0.07] hover:text-white" : "text-[#525b6b] hover:bg-slate-100"
            }`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  const listBody = (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={rows.map((r) => r.topic.id)} strategy={verticalListSortingStrategy}>
        {rows.length === 0 ? (
          <p className={`py-8 text-center text-xs ${mutedTextCls}`}>{t.outliner.noMatches}</p>
        ) : (
          <div className={isSidebar ? "space-y-0.5" : "space-y-1"}>
            {rows.map((row) => {
              const isRoot = row.topic.id === sheet.rootTopic.id;
              const noteOpen = Boolean(openNoteIds[row.topic.id]);
              return (
                <OutlineItem
                  key={row.topic.id}
                  row={row}
                  isRoot={isRoot}
                  isDark={isDark}
                  isSidebar={isSidebar}
                  indentStep={indentStep}
                  readOnly={readOnly}
                  selected={selectedTopicIds.includes(row.topic.id)}
                  editing={!readOnly && editingId === row.topic.id}
                  draftText={draftText}
                  noteOpen={noteOpen}
                  onDraftChange={setDraftText}
                  onSelect={() => {
                    selectTopics([row.topic.id]);
                    onSelectTopic?.(row.topic.id);
                  }}
                  onStartEdit={() => {
                    if (readOnly) return;
                    setEditingId(row.topic.id);
                    setDraftText(richTextToPlainText(row.topic.title));
                  }}
                  onCommitEdit={() => {
                    if (readOnly) {
                      setEditingId(null);
                      return;
                    }
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
                  onToggleTask={() => {
                    if (readOnly) return;
                    dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: row.topic.id });
                  }}
                  onToggleNote={() =>
                    setOpenNoteIds((prev) => ({ ...prev, [row.topic.id]: !prev[row.topic.id] }))
                  }
                  onSaveNote={(text) => {
                    if (readOnly) return;
                    dispatch({ type: "topic/setNote", sheetId: sheet.id, topicId: row.topic.id, text });
                  }}
                  onAddChild={() => {
                    if (readOnly) return;
                    const newId = generateId("t", deletedSet);
                    dispatch({ type: "topic/addChild", sheetId: sheet.id, parentId: row.topic.id, newId });
                    selectTopics([newId]);
                    onSelectTopic?.(newId);
                    setEditingId(newId);
                    setDraftText(t.outliner.defaultSubtopic);
                  }}
                  onKeyAction={(action) => {
                    if (readOnly) return;
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
                      if (isRoot) {
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
                      onSelectTopic?.(newId);
                      setEditingId(newId);
                      setDraftText(t.outliner.defaultNewTopic);
                    }
                  }}
                  addSubtopicTitle={t.outliner.addSubtopicTitle}
                  toggleNoteTitle={t.outliner.toggleNoteTitle}
                  notePlaceholder={t.outliner.notePlaceholder}
                />
              );
            })}
          </div>
        )}
      </SortableContext>
    </DndContext>
  );

  if (isSidebar) {
    return (
      <div className="editor-outline-sidebar flex min-h-0 flex-1 flex-col overflow-hidden">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">{listBody}</div>
        <div
          className={`flex shrink-0 items-center justify-between border-t px-3 py-1.5 text-[10.5px] ${borderCls} ${mutedTextCls}`}
        >
          <span>{t.outliner.totalTopics(rows.length)}</span>
          <span className="truncate">Tab / ⇧Tab · Alt+↑↓</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`editor-outline flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 ${
        isDark ? "bg-[#0e1014] text-[#f4f5f8]" : "bg-[#f6f7f9] text-[#111318]"
      }`}
    >
      <div
        className={`mx-auto max-w-3xl rounded-xl border px-5 py-6 sm:px-8 sm:py-7 ${
          isDark
            ? "border-white/[0.08] bg-[#14171d] shadow-2xl"
            : "border-slate-900/[0.08] bg-white shadow-xs"
        }`}
      >
        {toolbar}
        {listBody}
      </div>
    </div>
  );
};

interface OutlineItemProps {
  row: FlatOutlineRow;
  isRoot: boolean;
  isDark: boolean;
  isSidebar: boolean;
  indentStep: number;
  readOnly: boolean;
  selected: boolean;
  editing: boolean;
  draftText: string;
  noteOpen: boolean;
  onDraftChange: (v: string) => void;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onToggleCollapse: () => void;
  onToggleTask: () => void;
  onToggleNote: () => void;
  onSaveNote: (text: string) => void;
  onAddChild: () => void;
  onKeyAction: (action: "indent" | "outdent" | "up" | "down" | "sibling") => void;
  addSubtopicTitle: string;
  toggleNoteTitle: string;
  notePlaceholder: string;
}

const OutlineItem: React.FC<OutlineItemProps> = ({
  row,
  isRoot,
  isDark,
  isSidebar,
  indentStep,
  readOnly,
  selected,
  editing,
  draftText,
  noteOpen,
  onDraftChange,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onToggleCollapse,
  onToggleTask,
  onToggleNote,
  onSaveNote,
  onAddChild,
  onKeyAction,
  addSubtopicTitle,
  toggleNoteTitle,
  notePlaceholder,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: row.topic.id,
    disabled: isRoot || readOnly,
  });

  const hasNote = Boolean(row.topic.note?.text?.trim());
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{ paddingLeft: row.depth * indentStep + (isSidebar ? 4 : 6) }}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (editing || readOnly) return;
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
        className={`group relative flex items-center gap-1.5 rounded-[7px] pr-1.5 outline-none transition-colors ${
          isRoot && !isSidebar
            ? `mb-2 border-b pb-3 pt-1 ${isDark ? "border-white/[0.08]" : "border-slate-900/[0.08]"}`
            : isSidebar
              ? "py-1.5 text-[12.5px]"
              : "py-2 text-sm"
        } ${
          selected
            ? isDark
              ? "bg-white/[0.09] ring-1 ring-white/[0.18]"
              : "bg-blue-50/90 ring-1 ring-blue-300/80"
            : isDark
              ? "hover:bg-white/[0.045]"
              : "hover:bg-slate-100/80"
        }`}
      >
        {/* Vertical tree-indent guide lines */}
        {row.depth > 0 &&
          Array.from({ length: row.depth }).map((_, idx) => (
            <span
              key={idx}
              className={`pointer-events-none absolute top-0 bottom-0 w-px ${
                isDark ? "bg-white/[0.075]" : "bg-slate-200/80"
              }`}
              style={{ left: idx * indentStep + (isSidebar ? 11 : 14) }}
            />
          ))}

        {/* Drag handle */}
        {!isRoot && !readOnly ? (
          <span
            {...attributes}
            {...listeners}
            className={`cursor-grab opacity-0 transition group-hover:opacity-75 hover:!opacity-100 ${
              isDark ? "text-[#9ca3b0]" : "text-slate-400"
            }`}
          >
            <GripVertical className="h-3 w-3" />
          </span>
        ) : (
          !isSidebar && <span className="w-3" />
        )}

        {/* Collapse / branch dot */}
        {row.topic.children.length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            className={`rounded p-0.5 transition ${
              isDark
                ? "text-[#9ca3b0] hover:bg-white/[0.09] hover:text-white"
                : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
            }`}
          >
            {row.topic.collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor:
                  row.depth === 1 && row.branchColor
                    ? row.branchColor
                    : isDark
                      ? "rgba(255,255,255,0.32)"
                      : "rgba(100,116,139,0.55)",
              }}
            />
          </span>
        )}

        {/* Branch color dot on level-1 nodes with children */}
        {row.depth === 1 && row.topic.children.length > 0 && row.branchColor && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: row.branchColor }}
            aria-hidden="true"
          />
        )}

        {/* Task checkbox */}
        {row.topic.task && (
          <button
            type="button"
            disabled={readOnly}
            onClick={(e) => {
              e.stopPropagation();
              onToggleTask();
            }}
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
              row.topic.task.status === "done"
                ? "border-emerald-500 bg-emerald-500 text-white"
                : isDark
                  ? "border-white/25 bg-transparent"
                  : "border-slate-300 bg-white"
            }`}
          >
            {row.topic.task.status === "done" && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          </button>
        )}

        {/* Title */}
        <div
          className={`min-w-0 flex-1 ${
            isRoot
              ? isSidebar
                ? `font-semibold ${isDark ? "text-white" : "text-slate-900"}`
                : `text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`
              : row.depth === 1
                ? `font-semibold ${isDark ? "text-[#f4f5f8]" : "text-slate-800"}`
                : isDark
                  ? "text-[#cfd5e2]"
                  : "text-slate-700"
          } ${row.topic.task?.status === "done" ? "line-through opacity-55" : ""}`}
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
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  onCommitEdit();
                }
              }}
              className={`w-full rounded border px-1.5 py-0.5 text-[12.5px] outline-none ${
                isDark
                  ? "border-indigo-400/60 bg-[#0b0c0e] text-white"
                  : "border-blue-400 bg-white text-slate-900"
              }`}
            />
          ) : (
            <span className="block truncate">{richTextToPlainText(row.topic.title)}</span>
          )}
        </div>

        {/* Labels (full mode or compact pill) */}
        {!isSidebar && row.topic.labels && row.topic.labels.length > 0 && (
          <div className="hidden items-center gap-1 sm:flex">
            {row.topic.labels.slice(0, 2).map((lbl) => (
              <span
                key={lbl}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  isDark ? "bg-white/[0.08] text-[#b4bccb]" : "bg-slate-100 text-slate-600"
                }`}
              >
                {lbl}
              </span>
            ))}
          </div>
        )}

        {/* Collapsed hidden descendants badge */}
        {row.hiddenDescendantCount > 0 && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              isDark ? "bg-white/[0.08] text-[#9ca3b0]" : "bg-slate-200/80 text-slate-600"
            }`}
          >
            +{row.hiddenDescendantCount}
          </span>
        )}

        {/* Inline note toggle */}
        {(hasNote || !readOnly) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleNote();
            }}
            title={toggleNoteTitle}
            className={`shrink-0 rounded p-1 transition ${
              hasNote || noteOpen
                ? isDark
                  ? "text-indigo-300 opacity-90 hover:bg-white/[0.08]"
                  : "text-indigo-600 opacity-90 hover:bg-slate-200/70"
                : isDark
                  ? "text-[#9ca3b0] opacity-0 hover:bg-white/[0.08] hover:text-white group-hover:opacity-100"
                  : "text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100"
            }`}
          >
            <FileText className="h-3 w-3" />
          </button>
        )}

        {/* Quick add child */}
        {!readOnly && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild();
            }}
            className={`shrink-0 rounded p-1 opacity-0 transition group-hover:opacity-100 ${
              isDark
                ? "text-[#9ca3b0] hover:bg-white/[0.08] hover:text-white"
                : "text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            }`}
            title={addSubtopicTitle}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Inline expandable note editor / preview */}
      {noteOpen && (
        <div
          style={{ marginLeft: row.depth * indentStep + (isSidebar ? 22 : 34) }}
          className="mb-1.5 mt-1 pr-2"
        >
          {readOnly ? (
            <div
              className={`rounded-[6px] border px-2.5 py-1.5 text-[11.5px] whitespace-pre-wrap ${
                isDark
                  ? "border-white/[0.08] bg-white/[0.03] text-[#b4bccb]"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              {row.topic.note?.text || ""}
            </div>
          ) : (
            <textarea
              rows={2}
              defaultValue={row.topic.note?.text ?? ""}
              placeholder={notePlaceholder}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => onSaveNote(e.target.value)}
              className={`block w-full resize-y rounded-[6px] border px-2.5 py-1.5 text-[11.5px] leading-relaxed outline-none ${
                isDark
                  ? "border-white/[0.1] bg-[#0b0c0e] text-[#d5d9e2] focus:border-white/[0.24]"
                  : "border-slate-200 bg-slate-50 text-slate-700 focus:border-slate-400"
              }`}
            />
          )}
        </div>
      )}
    </div>
  );
};
