import React, { useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Braces,
  ChevronDown,
  CornerDownRight,
  FileText,
  ImagePlus,
  Link2,
  MessageSquare,
  Plus,
  Share2,
  Sigma,
  Sparkles,
  SquareDashedBottom,
} from "lucide-react";
import {
  createRichText,
  createTopic,
  findTopicLocation,
  generateId,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface CanvasDockProps {
  isDark: boolean;
  onOpenInlineAi?: () => void;
}

export const CanvasDock: React.FC<CanvasDockProps> = ({ isDark, onOpenInlineAi }) => {
  const doc = useMindmapStore((s) => s.doc);
  const zenMode = useMindmapStore((s) => s.zenMode);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const setEditingTopicId = useMindmapStore((s) => s.setEditingTopicId);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];

  if (zenMode) return null;

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

  const hoverCls = isDark
    ? "text-[#d5d9e2] hover:bg-white/[0.08] hover:text-white"
    : "text-[#2c3340] hover:bg-slate-900/[0.06] hover:text-[#111318]";

  const sepCls = isDark ? "mx-1 h-4 w-px shrink-0 bg-white/[0.08]" : "mx-1 h-4 w-px shrink-0 bg-slate-900/[0.08]";
  const groupTitleCls = `px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider ${
    isDark ? "text-[#646b78]" : "text-[#8c95a4]"
  }`;

  return (
    <div
      className={`pointer-events-auto absolute bottom-3 left-1/2 z-30 flex h-9 w-max max-w-[calc(100%-96px)] -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-[9px] border px-1.5 text-[12px] shadow-2xl backdrop-blur-md ${
        isDark
          ? "border-white/[0.1] bg-[#15171c]/95 text-[#f4f5f8]"
          : "border-slate-900/[0.1] bg-white/95 text-[#111318]"
      }`}
      role="toolbar"
      aria-label="画布快捷操作"
    >
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={handleUploadImage}
      />

      <button
        type="button"
        title="插入子主题 (Tab)"
        onClick={handleAddChild}
        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 py-1 font-medium transition ${hoverCls}`}
      >
        <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
        <span>子主题</span>
        <kbd className={`hidden rounded px-1 font-mono text-[10px] opacity-55 sm:inline`}>Tab</kbd>
      </button>

      <button
        type="button"
        title="插入同级主题 (Enter)"
        onClick={handleAddSibling}
        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 py-1 font-medium transition ${hoverCls}`}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span>同级</span>
      </button>

      <div className={sepCls} />

      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2.5 py-1 font-medium transition ${hoverCls}`}
          >
            <span>添加元素</span>
            <ChevronDown className="h-3 w-3 opacity-65" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            sideOffset={8}
            className={`z-50 w-48 rounded-[10px] border p-1 text-xs shadow-2xl ${
              isDark
                ? "border-white/[0.12] bg-[#15171c] text-[#f4f5f8]"
                : "border-slate-900/[0.1] bg-white text-[#111318]"
            }`}
          >
            <div className={groupTitleCls}>结构标注</div>
            <PopItem icon={<Share2 className="h-3.5 w-3.5" />} label="节点联系" onClick={handleAddRelationship} hoverCls={hoverCls} />
            <PopItem icon={<SquareDashedBottom className="h-3.5 w-3.5" />} label="分支外框" onClick={handleAddBoundary} hoverCls={hoverCls} />
            <PopItem icon={<Braces className="h-3.5 w-3.5" />} label="分支概要" onClick={handleAddSummary} hoverCls={hoverCls} />
            <PopItem icon={<MessageSquare className="h-3.5 w-3.5" />} label="节点批注" onClick={handleAddCallout} hoverCls={hoverCls} />

            <div className={`my-1 h-px ${isDark ? "bg-white/[0.075]" : "bg-slate-900/[0.08]"}`} />
            <div className={groupTitleCls}>富媒体内容</div>
            <PopItem icon={<ImagePlus className="h-3.5 w-3.5" />} label="上传图片" onClick={() => imgInputRef.current?.click()} hoverCls={hoverCls} />
            <PopItem
              icon={<Sigma className="h-3.5 w-3.5" />}
              label="数学公式"
              onClick={() => dispatch({ type: "topic/setEquation", sheetId: sheet.id, topicId: primaryId, latex: "E = mc^2" })}
              hoverCls={hoverCls}
            />
            <PopItem
              icon={<FileText className="h-3.5 w-3.5" />}
              label="长备注"
              onClick={() => dispatch({ type: "topic/setNote", sheetId: sheet.id, topicId: primaryId, text: "在此补充节点的详细说明..." })}
              hoverCls={hoverCls}
            />
            <PopItem
              icon={<Link2 className="h-3.5 w-3.5" />}
              label="超链接"
              onClick={() => {
                const url = window.prompt("输入链接地址 (https://...)", "https://");
                if (url && url.trim().length > 8) {
                  dispatch({ type: "topic/setHref", sheetId: sheet.id, topicId: primaryId, href: { kind: "url", target: url.trim() } });
                }
              }}
              hoverCls={hoverCls}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {onOpenInlineAi && (
        <>
          <div className={sepCls} />
          <button
            type="button"
            onClick={onOpenInlineAi}
            title="节点 AI 快捷指令 (⇧⌘J)"
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2.5 py-1 font-medium transition ${
              isDark
                ? "bg-white/[0.08] text-[#f4f5f8] hover:bg-white/[0.14]"
                : "bg-slate-900/[0.07] text-[#111318] hover:bg-slate-900/[0.12]"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-80" />
            <span>AI 扩展</span>
          </button>
        </>
      )}
    </div>
  );
};

const PopItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  hoverCls: string;
}> = ({ icon, label, onClick, hoverCls }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left transition ${hoverCls}`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
