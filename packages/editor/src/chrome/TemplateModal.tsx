import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { getPalette, getTemplateInfo, hex8ToCss, TEMPLATES } from "@mindmap/core";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";
import { StructureIcon } from "./structure-icons.js";

interface TemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({ open, onOpenChange }) => {
  const replaceDocument = useMindmapStore((s) => s.replaceDocument);
  const { locale, t } = useEditorI18n();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[760px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-base font-bold text-slate-900">{t.templateModal.title}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                {t.templateModal.desc}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            {TEMPLATES.map((tpl) => {
              const pal = getPalette(tpl.paletteId);
              const info = getTemplateInfo(tpl.id, locale, tpl);
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    replaceDocument(tpl.create());
                    onOpenChange(false);
                  }}
                  className="group flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white text-left shadow-2xs transition hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-md"
                >
                  <div
                    className="relative flex h-28 w-full items-center justify-center border-b border-slate-200/60 p-3"
                    style={{ backgroundColor: hex8ToCss(pal.canvasBg) }}
                  >
                    <StructureIcon
                      structure={tpl.structure}
                      rootColor={hex8ToCss(pal.rootFill)}
                      accentColor={hex8ToCss(pal.branches[0])}
                      secondaryColor={hex8ToCss(pal.branches[1] ?? pal.branches[0])}
                      className="h-14 w-24 transition-transform duration-200 group-hover:scale-105"
                    />
                    <span
                      className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-2xs"
                      style={{
                        backgroundColor: pal.isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.88)",
                        color: pal.isDark ? "#F8FAFC" : "#334155",
                      }}
                    >
                      {t.structures[tpl.structure]}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col bg-white p-3">
                    <div className="text-xs font-semibold text-slate-800 group-hover:text-blue-600">
                      {info.name}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                      {info.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
