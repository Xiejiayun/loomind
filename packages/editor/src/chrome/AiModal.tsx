import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X } from "lucide-react";
import { getPalette } from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface AiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AiModal: React.FC<AiModalProps> = ({ open, onOpenChange }) => {
  const doc = useMindmapStore((s) => s.doc);
  const viewMode = useMindmapStore((s) => s.viewMode);

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const isDark = getPalette({ ...doc.theme, ...sheet.theme }.paletteId).isDark && viewMode === "canvas";
  const focusCls = isDark
    ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111317]"
    : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-50 backdrop-blur-xs ${isDark ? "bg-black/70" : "bg-zinc-950/45"}`} />
        <Dialog.Content className={`fixed left-1/2 top-1/2 z-50 w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-2xl ${
          isDark ? "border-zinc-800 bg-[#111317] text-zinc-100" : "border-zinc-200 bg-white text-zinc-900"
        }`}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${isDark ? "bg-zinc-800 text-sky-300" : "bg-zinc-100 text-sky-700"}`}>
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <Dialog.Title className={`text-base font-semibold ${isDark ? "text-zinc-100" : "text-zinc-950"}`}>AI 共创即将开放</Dialog.Title>
                <Dialog.Description className={`text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
                  从主题或大纲生成导图、扩展节点等功能尚未开放。
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close aria-label="关闭提示" className={`rounded-lg p-1.5 transition ${focusCls} ${
              isDark ? "text-zinc-400 hover:bg-zinc-800 hover:text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            }`}>
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className={`rounded-xl border p-4 ${
            isDark ? "border-zinc-800 bg-[#181b20]" : "border-zinc-200 bg-zinc-50"
          }`}>
            <p className={`font-mono text-[10px] font-semibold tracking-[0.12em] ${isDark ? "text-sky-300" : "text-sky-700"}`}>
              COMING SOON
            </p>
            <p className={`mt-2 text-sm font-medium ${isDark ? "text-zinc-100" : "text-zinc-900"}`}>
              现在可以继续编辑导图
            </p>
            <p className={`mt-1 text-xs leading-5 ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              使用顶部的「导图 / 大纲」视图整理内容。AI 功能开放后将在这里使用。
            </p>
          </div>

          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${focusCls} ${
                  isDark ? "bg-zinc-100 text-zinc-950 hover:bg-white" : "bg-zinc-950 text-white hover:bg-zinc-800"
                }`}
              >
                继续编辑
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
