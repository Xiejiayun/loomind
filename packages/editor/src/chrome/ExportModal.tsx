import React, { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FileUp, X } from "lucide-react";
import {
  exportToMarkdown,
  exportToOpml,
  exportToXMind,
  importLoomindBackup,
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
import { useEditorI18n } from "../i18n.js";
import { exportPitchToPptx } from "../pitch/pptx-export.js";

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: MindmapLayoutResult;
  readOnly: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({ open, onOpenChange, layout, readOnly }) => {
  const doc = useMindmapStore((s) => s.doc);
  const replaceDocument = useMindmapStore((s) => s.replaceDocument);
  const { t } = useEditorI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const baseName = sheet.title.replace(/[\\/:*?"<>|]/g, "_") || "mindmap";

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || readOnly) return;
    setStatus(null);
    try {
      const name = file.name.toLowerCase();
      const imported = name.endsWith(".json") ? importLoomindBackup(await file.text())
        : name.endsWith(".xmind") ? importFromXMind(new Uint8Array(await file.arrayBuffer()))
        : name.endsWith(".opml") || name.endsWith(".xml") ? importFromOpml(await file.text())
        : importFromMarkdown(await file.text());
      if (!window.confirm(t.exportModal.replaceConfirm)) return;
      replaceDocument(imported);
      setStatus(t.exportModal.importSuccess(file.name));
      onOpenChange(false);
    } catch (err) {
      setStatus(t.exportModal.importError(err instanceof Error ? err.message : String(err)));
    } finally {
      input.value = "";
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-base font-bold text-slate-900">{t.exportModal.title}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                {t.exportModal.desc}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Import drop button */}
          {!readOnly && <div className="mb-5 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-3">
            <input
              ref={fileRef}
              type="file"
              accept=".json,.xmind,.md,.markdown,.opml,.xml"
              className="hidden"
              onChange={(e) => void handleImportFile(e)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-blue-400 hover:text-blue-600"
            >
              <FileUp className="h-4 w-4 text-blue-600" /> {t.exportModal.importBtn}
            </button>
          </div>}

          {/* Export Grid with format badges */}
          <div className="mb-2 text-[11px] font-semibold text-slate-500">{t.exportModal.exportHeading}</div>
          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <ExportBtn
              badge="JSON"
              badgeClass="bg-indigo-50 text-indigo-600"
              label={t.exportModal.backupLabel}
              desc={t.exportModal.backupDesc}
              onClick={() => downloadBlob(new Blob([JSON.stringify(doc)], { type: "application/json" }), `${baseName}.loomind.json`)}
            />
            <ExportBtn
              badge="XMIND"
              badgeClass="bg-red-50 text-red-600"
              label={t.exportModal.xmindLabel}
              desc={t.exportModal.xmindDesc}
              onClick={() => {
                const bytes = exportToXMind(doc);
                downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }), `${baseName}.xmind`);
              }}
            />
            <ExportBtn
              badge="PDF"
              badgeClass="bg-rose-50 text-rose-600"
              label={t.exportModal.pdfLabel}
              desc={t.exportModal.pdfDesc}
              onClick={() => void exportToVectorPdf(doc, layout, `${baseName}.pdf`)}
            />
            <ExportBtn
              badge="PNG 2×"
              badgeClass="bg-sky-50 text-sky-600"
              label={t.exportModal.png2xLabel}
              desc={t.exportModal.png2xDesc}
              onClick={() => void exportToPngFile(doc, layout, { scale: 2, filename: `${baseName}@2x.png` })}
            />
            <ExportBtn
              badge="PNG 3×"
              badgeClass="bg-cyan-50 text-cyan-700"
              label={t.exportModal.png3xLabel}
              desc={t.exportModal.png3xDesc}
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
              label={t.exportModal.svgLabel}
              desc={t.exportModal.svgDesc}
              onClick={() => exportToSvgFile(doc, layout, `${baseName}.svg`)}
            />
            <ExportBtn
              badge="PPTX"
              badgeClass="bg-orange-50 text-orange-600"
              label={t.exportModal.pptxLabel}
              desc={t.exportModal.pptxDesc}
              onClick={() => void exportPitchToPptx(doc, `${baseName}.pptx`)}
            />
            <ExportBtn
              badge="MD"
              badgeClass="bg-slate-100 text-slate-700"
              label={t.exportModal.mdLabel}
              desc={t.exportModal.mdDesc}
              onClick={() => {
                const md = exportToMarkdown(doc);
                downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${baseName}.md`);
              }}
            />
            <ExportBtn
              badge="OPML"
              badgeClass="bg-emerald-50 text-emerald-700"
              label={t.exportModal.opmlLabel}
              desc={t.exportModal.opmlDesc}
              onClick={() => {
                const opml = exportToOpml(doc);
                downloadBlob(new Blob([opml], { type: "text/xml;charset=utf-8" }), `${baseName}.opml`);
              }}
            />
          </div>

          {status && <div role="status" className="mt-3 text-center text-xs text-blue-600">{status}</div>}
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
