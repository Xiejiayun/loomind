import React, { useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Braces,
  CornerDownRight,
  Download,
  FileText,
  GitBranch,
  ImagePlus,
  LayoutGrid,
  Link2,
  ListTree,
  Maximize2,
  MessageSquare,
  PanelRight,
  Paperclip,
  Play,
  Plus,
  Redo2,
  Share2,
  Sigma,
  Sparkles,
  SquareDashedBottom,
  Undo2,
} from "lucide-react";
import {
  createRichText,
  createTopic,
  findTopicLocation,
  generateId,
  getPalette,
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
  const imgInputRef = useRef<HTMLInputElement>(null);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const palette = getPalette({ ...doc.theme, ...sheet.theme }.paletteId);
  const isDark = palette.isDark && viewMode === "canvas";
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

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.split(",")[1];
      if (!base64) return;
      const resourceId = generateId("img", deletedSet);
      dispatch({
        type: "topic/setImage",
        sheetId: sheet.id,
        topicId: primaryId,
        image: { resourceId, width: 180, height: 120, pos: "top" },
        asset: {
          resourceId,
          mimeType: (file.type as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml") || "image/png",
          width: 180,
          height: 120,
          sha256: resourceId,
          dataBase64: base64,
        },
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  if (zenMode) {
    return (
      <button
        type="button"
        onClick={() => setZenMode(false)}
        className={`fixed right-4 top-3 z-50 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur ${
          isDark
            ? "border-slate-700 bg-slate-900/90 text-slate-200 hover:bg-slate-800"
            : "border-slate-200 bg-white/90 text-slate-700 hover:bg-white"
        }`}
      >
        退出禅模式 (Esc)
      </button>
    );
  }

  const hoverCls = isDark ? "hover:bg-slate-800 hover:text-white" : "hover:bg-slate-100 hover:text-slate-900";
  const borderBtnCls = isDark
    ? "border-slate-700 bg-slate-800/70 text-slate-200 hover:bg-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <header
      className={`flex h-11 shrink-0 items-center justify-between border-b px-3 text-xs transition-colors ${
        isDark
          ? "border-slate-800 bg-slate-900/95 text-slate-200"
          : "border-slate-200 bg-white text-slate-700"
      }`}
    >
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={handleUploadImage}
      />

      {/* Left: Brand + View switcher + Undo/Redo + Templates */}
      <div className="flex items-center gap-2">
        <div className="mr-0.5 hidden items-center gap-1.5 sm:flex" title="Mindmap Studio · 已本地自动保存">
          <svg viewBox="0 0 32 32" className="h-5 w-5 shrink-0">
            <rect width="32" height="32" rx="8" fill={isDark ? "#1E293B" : "#0F172A"} />
            <path d="M13 16 C9 16 9 10 6 10 M13 16 C9 16 9 22 6 22" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" fill="none" />
            <path d="M19 16 C23 16 23 10 26 10 M19 16 C23 16 23 22 26 22" stroke="#E879F9" strokeWidth="2.2" strokeLinecap="round" fill="none" />
            <rect x="11" y="12" width="10" height="8" rx="4" fill="#FFFFFF" />
          </svg>
        </div>

        <div className={`flex items-center rounded-lg p-0.5 ${isDark ? "bg-slate-800" : "bg-slate-100"}`}>
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "canvas"
                ? isDark
                  ? "bg-slate-700 text-white shadow-xs"
                  : "bg-white text-slate-900 shadow-xs"
                : isDark
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" /> 导图
          </button>
          <button
            type="button"
            onClick={() => setViewMode("outline")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "outline"
                ? isDark
                  ? "bg-slate-700 text-white shadow-xs"
                  : "bg-white text-slate-900 shadow-xs"
                : isDark
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <ListTree className="h-3.5 w-3.5" /> 大纲
          </button>
        </div>

        <div className={`h-4 w-px ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />

        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          className={`rounded p-1.5 disabled:opacity-35 ${hoverCls}`}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          className={`rounded p-1.5 disabled:opacity-35 ${hoverCls}`}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onOpenTemplates}
          className={`ml-0.5 flex items-center gap-1 rounded-md border px-2 py-1 font-medium ${borderBtnCls}`}
        >
          <LayoutGrid className="h-3.5 w-3.5 text-blue-500" /> 模板库
        </button>
      </div>

      {/* Center: Quick Insert Group */}
      <div className="hidden items-center gap-0.5 lg:flex">
        <ToolBtn icon={<Plus className="h-3.5 w-3.5" />} label="主题" onClick={handleAddSibling} isDark={isDark} />
        <ToolBtn icon={<CornerDownRight className="h-3.5 w-3.5" />} label="子主题" onClick={handleAddChild} isDark={isDark} />
        <ToolBtn icon={<Share2 className="h-3.5 w-3.5" />} label="联系" onClick={handleAddRelationship} isDark={isDark} />
        <ToolBtn icon={<SquareDashedBottom className="h-3.5 w-3.5" />} label="外框" onClick={handleAddBoundary} isDark={isDark} />
        <ToolBtn icon={<Braces className="h-3.5 w-3.5" />} label="概要" onClick={handleAddSummary} isDark={isDark} />
        <ToolBtn icon={<MessageSquare className="h-3.5 w-3.5" />} label="批注" onClick={handleAddCallout} isDark={isDark} />

        {/* Insert Popover (Image / Formula / Note / Link) */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${
                isDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Paperclip className="h-3.5 w-3.5" />
              <span>插入</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={6}
              className={`z-50 w-44 rounded-xl border p-1.5 text-xs shadow-xl ${
                isDark ? "border-slate-700 bg-slate-900 text-slate-200" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <button
                type="button"
                onClick={() => imgInputRef.current?.click()}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls}`}
              >
                <ImagePlus className="h-3.5 w-3.5 text-sky-500" /> 上传图片
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: "topic/setEquation",
                    sheetId: sheet.id,
                    topicId: primaryId,
                    latex: "E = mc^2",
                  })
                }
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls}`}
              >
                <Sigma className="h-3.5 w-3.5 text-violet-500" /> 插入数学公式
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: "topic/setNote",
                    sheetId: sheet.id,
                    topicId: primaryId,
                    text: "在此补充节点的详细说明...",
                  })
                }
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls}`}
              >
                <FileText className="h-3.5 w-3.5 text-amber-500" /> 添加备注
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = window.prompt("输入链接地址 (https://...)", "https://");
                  if (url && url.trim().length > 8) {
                    dispatch({
                      type: "topic/setHref",
                      sheetId: sheet.id,
                      topicId: primaryId,
                      href: { kind: "url", target: url.trim() },
                    });
                  }
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls}`}
              >
                <Link2 className="h-3.5 w-3.5 text-emerald-500" /> 添加超链接
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {/* Right: AI / Pitch / Zen / Export / Format */}
      <div className="flex items-center gap-1.5">
        {onOpenAi && (
          <button
            type="button"
            onClick={onOpenAi}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
              isDark
                ? "bg-violet-500/20 text-violet-300 hover:bg-violet-500/30"
                : "bg-violet-50 text-violet-700 hover:bg-violet-100"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" /> AI 共创
          </button>
        )}
        <button
          type="button"
          onClick={() => setPitchMode(true)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${hoverCls}`}
          title="演说模式"
        >
          <Play className="h-3.5 w-3.5" /> 演说
        </button>
        <button
          type="button"
          onClick={() => setZenMode(true)}
          className={`hidden rounded p-1.5 sm:inline-flex ${hoverCls}`}
          title="禅模式"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {onOpenExport && (
          <button
            type="button"
            onClick={onOpenExport}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 font-medium ${borderBtnCls}`}
          >
            <Download className="h-3.5 w-3.5" /> 导出
          </button>
        )}
        <button
          type="button"
          onClick={() => setFormatPanelOpen(!formatPanelOpen)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
            formatPanelOpen
              ? isDark
                ? "bg-blue-500/20 text-blue-300"
                : "bg-blue-50 text-blue-600"
              : hoverCls
          }`}
          title="格式面板"
        >
          <PanelRight className="h-3.5 w-3.5" /> 格式
        </button>
      </div>
    </header>
  );
};

const ToolBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isDark: boolean;
}> = ({ icon, label, onClick, isDark }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${
      isDark
        ? "text-slate-300 hover:bg-slate-800 hover:text-white"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
