import React, { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, FileUp, X } from "lucide-react";
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-base font-bold text-slate-900">导入与导出</Dialog.Title>
              <Dialog.Description className="text-xs text-slate-500">
                支持 .xmind、Markdown、OPML、纯矢量 SVG/PDF、高清 PNG 及 PPTX
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Import */}
          <div className="mb-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
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
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-100"
            >
              <FileUp className="h-4 w-4 text-blue-600" /> 导入文件 (.xmind / .md / .opml)
            </button>
          </div>

          {/* Export Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <ExportBtn
              label=".xmind 文件"
              desc="XMind 兼容压缩包"
              onClick={() => {
                const bytes = exportToXMind(doc);
                downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }), `${baseName}.xmind`);
              }}
            />
            <ExportBtn
              label="真矢量 PDF"
              desc="文字可搜索复制"
              onClick={() => void exportToVectorPdf(doc, layout, `${baseName}.pdf`)}
            />
            <ExportBtn
              label="高清 PNG (2×)"
              desc="透明/实底高清位图"
              onClick={() => void exportToPngFile(doc, layout, { scale: 2, filename: `${baseName}@2x.png` })}
            />
            <ExportBtn
              label="纯矢量 SVG"
              desc="零 foreignObject"
              onClick={() => exportToSvgFile(doc, layout, `${baseName}.svg`)}
            />
            <ExportBtn
              label="Markdown (.md)"
              desc="保留任务与备注"
              onClick={() => {
                const md = exportToMarkdown(doc);
                downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${baseName}.md`);
              }}
            />
            <ExportBtn
              label="OPML 2.0"
              desc="大纲软件互通"
              onClick={() => {
                const opml = exportToOpml(doc);
                downloadBlob(new Blob([opml], { type: "text/xml;charset=utf-8" }), `${baseName}.opml`);
              }}
            />
            <ExportBtn
              label="演说文稿 (.pptx)"
              desc="PptxGenJS 可编辑幻灯片"
              onClick={() => void exportPitchToPptx(doc, `${baseName}.pptx`)}
            />
            <ExportBtn
              label="超清透明 PNG (3×)"
              desc="适合演示文档贴图"
              onClick={() =>
                void exportToPngFile(doc, layout, {
                  scale: 3,
                  transparentBg: true,
                  filename: `${baseName}@3x-transparent.png`,
                })
              }
            />
          </div>

          {status && <div className="mt-3 text-center text-xs text-blue-600">{status}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const ExportBtn: React.FC<{ label: string; desc: string; onClick: () => void }> = ({
  label,
  desc,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-blue-500 hover:bg-blue-50/40"
  >
    <div>
      <div className="font-semibold text-slate-800">{label}</div>
      <div className="text-[10px] text-slate-400">{desc}</div>
    </div>
    <Download className="h-3.5 w-3.5 text-slate-400" />
  </button>
);
