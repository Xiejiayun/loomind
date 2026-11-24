import React from "react";
import {
  Braces,
  CornerDownRight,
  GitBranch,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  PanelRight,
  Plus,
  Redo2,
  Share2,
  Sparkles,
  SquareDashedBottom,
  Undo2,
  ListTree,
  Play,
  Download,
} from "lucide-react";
import {
  createRichText,
  createTopic,
  findTopicLocation,
  generateId,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface TopToolbarProps {
  onOpenTemplates: () => void;
  onOpenAi?: () => void;
  onOpenExport?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  onOpenTemplates,
  onOpenAi,
  onOpenExport,
}) => {
  const doc = useMindmapStore((s) => s.doc);
  const viewMode = useMindmapStore((s) => s.viewMode);
  const setViewMode = useMindmapStore((s) => s.setViewMode);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const setZenMode = useMindmapStore((s) => s.setZenMode);
  const setPitchMode = useMindmapStore((s) => s.setPitchMode);
  const formatPanelOpen = useMindmapStore((s) => s.formatPanelOpen);
  const setFormatPanelOpen = useMindmapStore((s) => s.setFormatPanelOpen);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const setEditingTopicId = useMindmapStore((s) => s.setEditingTopicId);
  const canUndo = useMindmapStore((s) => s.canUndo);
  const canRedo = useMindmapStore((s) => s.canRedo);
  const undo = useMindmapStore((s) => s.undo);
  const redo = useMindmapStore((s) => s.redo);
  const dispatch = useMindmapStore((s) => s.dispatch);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const primaryId = selectedTopicIds[0] ?? sheet.rootTopic.id;
  const deletedSet = new Set(doc.deletedIds);

  const handleAddChild = () => {
    const newId = generateId("t", deletedSet);
    dispatch({ type: "topic/addChild", sheetId: sheet.id, parentId: primaryId, newId });
    selectTopics([newId]);
    requestAnimationFrame(() => setEditingTopicId(newId));
  };

  const handleAddSibling = () => {
    if (primaryId === sheet.rootTopic.id) {
      handleAddChild();
      return;
    }
    const newId = generateId("t", deletedSet);
    dispatch({
      type: "topic/addSibling",
      sheetId: sheet.id,
      targetId: primaryId,
      position: "after",
      newId,
    });
    selectTopics([newId]);
    requestAnimationFrame(() => setEditingTopicId(newId));
  };

  const handleAddBoundary = () => {
    dispatch({
      type: "boundary/upsert",
      sheetId: sheet.id,
      boundary: {
        id: generateId("bnd", deletedSet),
        target: { kind: "subtree", topicId: primaryId },
        shape: "rounded",
        title: "外框",
      },
    });
  };

  const handleAddSummary = () => {
    const loc = findTopicLocation(sheet, primaryId);
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
  };

  const handleAddCallout = () => {
    dispatch({
      type: "topic/setCallout",
      sheetId: sheet.id,
      topicId: primaryId,
      callout: { id: generateId("co", deletedSet), title: createRichText("批注说明") },
    });
  };

  const handleAddRelationship = () => {
    const fromId = selectedTopicIds[0] ?? sheet.rootTopic.id;
    const toId =
      selectedTopicIds[1] ??
      sheet.rootTopic.children.find((c) => c.id !== fromId)?.id;
    if (!toId) return;
    dispatch({
      type: "relationship/upsert",
      sheetId: sheet.id,
      relationship: {
        id: generateId("rel", deletedSet),
        fromId,
        toId,
        title: "关联",
      },
    });
  };

  if (zenMode) {
    return (
      <button
        type="button"
        onClick={() => setZenMode(false)}
        className="fixed right-4 top-3 z-50 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-md backdrop-blur hover:bg-white"
      >
        退出禅模式 (Esc)
      </button>
    );
  }

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 text-xs text-slate-700">
      {/* Left: View switcher + Undo/Redo + Templates */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg bg-slate-100 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "canvas" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" /> 导图
          </button>
          <button
            type="button"
            onClick={() => setViewMode("outline")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "outline" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <ListTree className="h-3.5 w-3.5" /> 大纲
          </button>
        </div>

        <div className="h-4 w-px bg-slate-200" />

        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-35"
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-35"
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onOpenTemplates}
          className="ml-1 flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-medium hover:bg-slate-50"
        >
          <LayoutGrid className="h-3.5 w-3.5 text-blue-600" /> 模板库
        </button>
      </div>

      {/* Center: Quick Insert Group */}
      <div className="hidden items-center gap-1 md:flex">
        <ToolBtn icon={<Plus className="h-3.5 w-3.5" />} label="主题" onClick={handleAddSibling} />
        <ToolBtn icon={<CornerDownRight className="h-3.5 w-3.5" />} label="子主题" onClick={handleAddChild} />
        <ToolBtn icon={<Share2 className="h-3.5 w-3.5" />} label="联系" onClick={handleAddRelationship} />
        <ToolBtn icon={<SquareDashedBottom className="h-3.5 w-3.5" />} label="外框" onClick={handleAddBoundary} />
        <ToolBtn icon={<Braces className="h-3.5 w-3.5" />} label="概要" onClick={handleAddSummary} />
        <ToolBtn icon={<MessageSquare className="h-3.5 w-3.5" />} label="批注" onClick={handleAddCallout} />
      </div>

      {/* Right: AI / Pitch / Zen / Format / Export */}
      <div className="flex items-center gap-1.5">
        {onOpenAi && (
          <button
            type="button"
            onClick={onOpenAi}
            className="flex items-center gap-1 rounded-md bg-violet-50 px-2.5 py-1 font-medium text-violet-700 hover:bg-violet-100"
          >
            <Sparkles className="h-3.5 w-3.5" /> AI 共创
          </button>
        )}
        <button
          type="button"
          onClick={() => setPitchMode(true)}
          className="flex items-center gap-1 rounded-md px-2 py-1 font-medium hover:bg-slate-100"
          title="演说模式"
        >
          <Play className="h-3.5 w-3.5" /> 演说
        </button>
        <button
          type="button"
          onClick={() => setZenMode(true)}
          className="rounded p-1.5 hover:bg-slate-100"
          title="禅模式"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {onOpenExport && (
          <button
            type="button"
            onClick={onOpenExport}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-medium hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" /> 导出
          </button>
        )}
        <button
          type="button"
          onClick={() => setFormatPanelOpen(!formatPanelOpen)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${
            formatPanelOpen ? "bg-blue-50 text-blue-600" : "hover:bg-slate-100"
          }`}
          title="格式面板"
        >
          <PanelRight className="h-3.5 w-3.5" /> 格式
        </button>
      </div>
    </header>
  );
};

const ToolBtn: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({
  icon,
  label,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  >
    {icon}
    <span>{label}</span>
  </button>
);
