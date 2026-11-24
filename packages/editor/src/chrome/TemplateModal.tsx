import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { getPalette, hex8ToCss, TEMPLATES } from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface TemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({ open, onOpenChange }) => {
  const replaceDocument = useMindmapStore((s) => s.replaceDocument);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[720px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-base font-bold text-slate-900">新建思维导图模板</Dialog.Title>
              <Dialog.Description className="text-xs text-slate-500">
                选择一套结构与配色模板立即开始创作
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEMPLATES.map((tpl) => {
              const pal = getPalette(tpl.paletteId);
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    replaceDocument(tpl.create());
                    onOpenChange(false);
                  }}
                  className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 text-left transition hover:border-blue-500 hover:shadow-md"
                >
                  <div
                    className="flex h-24 w-full items-center justify-center p-3"
                    style={{ backgroundColor: hex8ToCss(pal.canvasBg) }}
                  >
                    <div
                      className="rounded-full px-3 py-1 text-[11px] font-bold shadow-xs"
                      style={{
                        backgroundColor: hex8ToCss(pal.rootFill),
                        color: hex8ToCss(pal.rootText),
                      }}
                    >
                      {tpl.structure}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col bg-white p-2.5">
                    <div className="text-xs font-semibold text-slate-800 group-hover:text-blue-600">
                      {tpl.name}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-slate-500">
                      {tpl.description}
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
