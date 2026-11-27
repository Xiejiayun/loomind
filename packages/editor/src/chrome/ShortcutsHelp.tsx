import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { HelpCircle } from "lucide-react";
import { useEditorI18n } from "../i18n.js";

export const ShortcutsHelp: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const { t } = useEditorI18n();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={t.shortcuts.buttonTitle}
          className={`absolute bottom-3 left-3 z-30 flex h-8 w-8 items-center justify-center rounded-[7px] border transition max-sm:top-2 max-sm:bottom-auto max-sm:left-2 max-sm:size-11 ${
            isDark
              ? "border-white/[0.1] bg-[#15171c]/90 text-[#9ca3b0] hover:border-white/[0.18] hover:bg-[#1c1f26] hover:text-white"
              : "border-slate-900/[0.1] bg-white/95 text-[#525b6b] hover:border-slate-900/[0.18] hover:text-[#111318]"
          }`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className={`z-50 w-64 rounded-[10px] border p-3.5 text-xs shadow-2xl ${
            isDark
              ? "border-white/[0.12] bg-[#15171c] text-[#f4f5f8]"
              : "border-slate-900/[0.1] bg-white text-[#111318]"
          }`}
        >
          <div className="mb-2.5 text-[12px] font-semibold">{t.shortcuts.heading}</div>
          <div className="space-y-1.5">
            {t.shortcuts.items.map(([k, desc]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className={isDark ? "text-[#9ca3b0]" : "text-[#525b6b]"}>{desc}</span>
                <kbd
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    isDark
                      ? "border-white/[0.1] bg-[#1c1f26] text-[#d5d9e2]"
                      : "border-slate-900/[0.1] bg-[#f7f8fa] text-[#2c3340]"
                  }`}
                >
                  {k}
                </kbd>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
