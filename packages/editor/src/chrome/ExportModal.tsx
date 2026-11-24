import React, { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FileUp, X } from "lucide-react";
import {
  exportToMarkdown,
  exportToOpml,
  exportToXMind,
  importFromMarkdown,
  importFromOpml,
  importFromXMind,
  type MindmapLayoutResult,
} from "@mindmap/core";
import {
  downloadBlob,
  exportToPngFile,
  exportToSvgFile,
  exportToVectorPdf,
} from "../canvas/export-raster.js";
import { useMindmapStore } from "../context.js";
import { exportPitchToPptx } from "../pitch/pptx-export.js";

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: MindmapLayoutResult;
}

export const ExportModal: React.FC<ExportModalProps> = ({ open, onOpenChange, layout }) => {
  const doc = useMindmapStore((s) => s.doc);
  const replaceDocument = useMindmapStore((s) => s.replaceDocument);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const baseName = sheet.title.replace(/[\\/:*?"<>|]/g, "_") || "mindmap";

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".xmind")) {
        const buf = new Uint8Array(await file.arrayBuffer());
        replaceDocument(importFromXMind(buf));
      } else if (name.endsWith(".opml") || name.endsWith(".xml")) {
        replaceDocument(importFromOpml(await file.text()));
      } else {
        replaceDocument(importFromMarkdown(await file.text()));
      }
      setStatus(`已成功导入 ${file.name}`);
      onOpenChange(false);
    } catch (err) {
      setStatus(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = "";
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-base font-bold text-slate-900">导入与导出</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                支持 XMind 互通、矢量 PDF/SVG、高清图片、大纲文档与 PowerPoint 演示文稿
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Import drop button */}
          <div className="mb-5 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xmind,.md,.markdown,.opml,.xml"
              className="hidden"
              onChange={(e) => void handleImportFile(e)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-blue-400 hover:text-blue-600"
            >
              <FileUp className="h-4 w-4 text-blue-600" /> 导入本地文件（.xmind / .md / .opml）
            </button>
          </div>

          {/* Export Grid with format badges */}
          <div className="mb-2 text-[11px] font-semibold text-slate-500">导出当前画布</div>
          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <ExportBtn
              badge="XMIND"
              badgeClass="bg-red-50 text-red-600"
              label="XMind 工作簿"
              desc="完整保留层级、备注与概要"
              onClick={() => {
                const bytes = exportToXMind(doc);
                downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }), `${baseName}.xmind`);
              }}
            />
            <ExportBtn
              badge="PDF"
              badgeClass="bg-rose-50 text-rose-600"
              label="真矢量 PDF"
              desc="无限放大清晰，文字可搜索复制"
              onClick={() => void exportToVectorPdf(doc, layout, `${baseName}.pdf`)}
            />
            <ExportBtn
              badge="PNG 2×"
              badgeClass="bg-sky-50 text-sky-600"
              label="高清图片 (2×)"
              desc="带画布底色，适合分享与嵌入"
              onClick={() => void exportToPngFile(doc, layout, { scale: 2, filename: `${baseName}@2x.png` })}
            />
            <ExportBtn
              badge="PNG 3×"
              badgeClass="bg-cyan-50 text-cyan-700"
              label="透明背景超清 (3×)"
              desc="透明底色，适合 PPT 与排版贴图"
              onClick={() =>
                void exportToPngFile(doc, layout, {
                  scale: 3,
                  transparentBg: true,
                  filename: `${baseName}@3x-transparent.png`,
                })
              }
            />
            <ExportBtn
              badge="SVG"
              badgeClass="bg-amber-50 text-amber-700"
              label="纯矢量 SVG"
              desc="兼容 Figma / Illustrator 二次编辑"
              onClick={() => exportToSvgFile(doc, layout, `${baseName}.svg`)}
            />
            <ExportBtn
              badge="PPTX"
              badgeClass="bg-orange-50 text-orange-600"
              label="演说幻灯片"
              desc="一键生成可编辑 PowerPoint 文稿"
              onClick={() => void exportPitchToPptx(doc, `${baseName}.pptx`)}
            />
            <ExportBtn
              badge="MD"
              badgeClass="bg-slate-100 text-slate-700"
              label="Markdown 大纲"
              desc="双向同步标题层级、任务与备注"
              onClick={() => {
                const md = exportToMarkdown(doc);
                downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${baseName}.md`);
              }}
            />
            <ExportBtn
              badge="OPML"
              badgeClass="bg-emerald-50 text-emerald-700"
              label="OPML 2.0"
              desc="通用大纲格式，跨软件无损迁移"
              onClick={() => {
                const opml = exportToOpml(doc);
                downloadBlob(new Blob([opml], { type: "text/xml;charset=utf-8" }), `${baseName}.opml`);
              }}
            />
          </div>

          {status && <div className="mt-3 text-center text-xs text-blue-600">{status}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const ExportBtn: React.FC<{
  badge: string;
  badgeClass: string;
  label: string;
  desc: string;
  onClick: () => void;
}> = ({ badge, badgeClass, label, desc, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-3 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-left transition hover:border-blue-500 hover:bg-blue-50/30 hover:shadow-xs"
  >
    <span className={`flex h-9 w-12 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-bold ${badgeClass}`}>
      {badge}
    </span>
    <div className="min-w-0">
      <div className="font-semibold text-slate-800">{label}</div>
      <div className="mt-0.5 truncate text-[10px] text-slate-500">{desc}</div>
    </div>
  </button>
);
