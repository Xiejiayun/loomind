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
  accountControl?: React.ReactNode;
  onOpenTemplates: () => void;
  onOpenAi?: () => void;
  onOpenExport?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  accountControl,
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

  const focusCls = isDark
    ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111317]"
    : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  if (zenMode) {
    return (
      <button
        type="button"
        onClick={() => setZenMode(false)}
        className={`fixed right-4 top-3 z-50 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur ${focusCls} ${
          isDark
            ? "border-zinc-700 bg-[#111317] text-zinc-200 hover:bg-zinc-800"
            : "border-zinc-200 bg-white/95 text-zinc-700 hover:bg-zinc-50"
        }`}
      >
        退出禅模式 (Esc)
      </button>
    );
  }

  const hoverCls = isDark ? "hover:bg-zinc-800 hover:text-white" : "hover:bg-zinc-100 hover:text-zinc-950";
  const borderBtnCls = isDark
    ? "border-zinc-700 bg-[#181b20] text-zinc-200 hover:bg-zinc-800"
    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50";

  return (
    <header
      className={`flex h-11 shrink-0 items-center justify-between border-b px-3 text-xs transition-colors ${
        isDark
          ? "border-zinc-800 bg-[#111317] text-zinc-200"
          : "border-zinc-200 bg-white text-zinc-700"
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
        {accountControl}
        <div className="mr-0.5 hidden items-center gap-1.5 sm:flex" title="Loomind · 已本地自动保存">
          <svg viewBox="0 0 64 64" className="h-6 w-6 shrink-0" fill="none">
            <defs>
              <linearGradient id="ms-bg" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#1B2530" />
                <stop offset="100%" stopColor="#090A0C" />
              </linearGradient>
              <linearGradient id="ms-prism" x1="12" y1="12" x2="52" y2="52" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#38BDF8" />
                <stop offset="55%" stopColor="#94A3B8" />
                <stop offset="100%" stopColor="#E2E8F0" />
              </linearGradient>
              <linearGradient id="ms-ring" x1="14" y1="50" x2="50" y2="14" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.25" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="16" fill="url(#ms-bg)" />
            <ellipse cx="32" cy="32" rx="22" ry="11" transform="rotate(-32 32 32)" stroke="url(#ms-ring)" strokeWidth="2.4" />
            <path
              d="M32 12 C34.6 24 40 29.4 52 32 C40 34.6 34.6 40 32 52 C29.4 40 24 34.6 12 32 C24 29.4 29.4 24 32 12 Z"
              fill="url(#ms-prism)"
              fillOpacity="0.26"
              stroke="url(#ms-prism)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <circle cx="32" cy="32" r="5.2" fill="#FFFFFF" />
            <circle cx="48" cy="18" r="3.2" fill="#E2E8F0" />
            <circle cx="16" cy="46" r="2.8" fill="#7DD3FC" />
          </svg>
        </div>

        <div className={`flex items-center rounded-lg p-0.5 ${isDark ? "bg-zinc-800" : "bg-zinc-100"}`}>
          <button
            type="button"
            onClick={() => setViewMode("canvas")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${focusCls} ${
              viewMode === "canvas"
                ? isDark
                  ? "bg-zinc-700 text-white shadow-xs"
                  : "bg-white text-zinc-950 shadow-xs"
                : isDark
                  ? "text-zinc-400 hover:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" /> 导图
          </button>
          <button
            type="button"
            onClick={() => setViewMode("outline")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${focusCls} ${
              viewMode === "outline"
                ? isDark
                  ? "bg-zinc-700 text-white shadow-xs"
                  : "bg-white text-zinc-950 shadow-xs"
                : isDark
                  ? "text-zinc-400 hover:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            <ListTree className="h-3.5 w-3.5" /> 大纲
          </button>
        </div>

        <div className={`h-4 w-px ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />

        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          className={`rounded p-1.5 disabled:opacity-35 ${hoverCls} ${focusCls}`}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          className={`rounded p-1.5 disabled:opacity-35 ${hoverCls} ${focusCls}`}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onOpenTemplates}
          className={`ml-0.5 flex items-center gap-1 rounded-md border px-2 py-1 font-medium ${borderBtnCls} ${focusCls}`}
        >
          <LayoutGrid className={`h-3.5 w-3.5 ${isDark ? "text-sky-400" : "text-sky-700"}`} /> 模板库
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
              className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${focusCls} ${
                isDark ? "text-zinc-300 hover:bg-zinc-800 hover:text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
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
                isDark ? "border-zinc-800 bg-[#181b20] text-zinc-200" : "border-zinc-200 bg-white text-zinc-700"
              }`}
            >
              <button
                type="button"
                onClick={() => imgInputRef.current?.click()}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls} ${focusCls}`}
              >
                <ImagePlus className="h-3.5 w-3.5 text-sky-600" /> 上传图片
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
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls} ${focusCls}`}
              >
                <Sigma className="h-3.5 w-3.5 text-zinc-500" /> 插入数学公式
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
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls} ${focusCls}`}
              >
                <FileText className="h-3.5 w-3.5 text-zinc-500" /> 添加备注
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
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${hoverCls} ${focusCls}`}
              >
                <Link2 className="h-3.5 w-3.5 text-zinc-500" /> 添加超链接
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
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${focusCls} ${
              isDark
                ? "bg-zinc-100 text-zinc-950 hover:bg-white"
                : "bg-zinc-950 text-white hover:bg-zinc-800"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" /> AI 共创
          </button>
        )}
        <button
          type="button"
          onClick={() => setPitchMode(true)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${hoverCls} ${focusCls}`}
          title="演说模式"
        >
          <Play className="h-3.5 w-3.5" /> 演说
        </button>
        <button
          type="button"
          onClick={() => setZenMode(true)}
          className={`hidden rounded p-1.5 sm:inline-flex ${hoverCls} ${focusCls}`}
          title="禅模式"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {onOpenExport && (
          <button
            type="button"
            onClick={onOpenExport}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 font-medium ${borderBtnCls} ${focusCls}`}
          >
            <Download className="h-3.5 w-3.5" /> 导出
          </button>
        )}
        <button
          type="button"
          onClick={() => setFormatPanelOpen(!formatPanelOpen)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${focusCls} ${
            formatPanelOpen
              ? isDark
                ? "bg-sky-500/15 text-sky-300"
                : "bg-sky-50 text-sky-800"
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
    className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
      isDark
        ? "text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:ring-sky-400 focus-visible:ring-offset-[#111317]"
        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:ring-sky-600 focus-visible:ring-offset-white"
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
