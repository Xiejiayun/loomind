import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Download, FileText, X } from "lucide-react";
import { getPalette, hex8ToCss } from "@mindmap/core";
import { useMindmapStore } from "../context.js";
import { compilePitchDeck } from "./compiler.js";
import { exportPitchToPptx } from "./pptx-export.js";

export const PitchOverlay: React.FC = () => {
  const pitchMode = useMindmapStore((s) => s.pitchMode);
  const setPitchMode = useMindmapStore((s) => s.setPitchMode);
  const doc = useMindmapStore((s) => s.doc);

  const [slideIdx, setSlideIdx] = useState(0);
  const [revealStep, setRevealStep] = useState(1);
  const [notesOpen, setNotesOpen] = useState(false);

  const slides = useMemo(() => (pitchMode ? compilePitchDeck(doc) : []), [doc, pitchMode]);
  const palette = getPalette(doc.theme.paletteId);

  useEffect(() => {
    if (pitchMode) {
      setSlideIdx(0);
      setRevealStep(1);
      setNotesOpen(false);
    }
  }, [pitchMode]);

  useEffect(() => {
    if (!pitchMode || slides.length === 0) return;
    const current = slides[slideIdx];
    const maxSteps = Math.max(1, current?.bullets.length ?? 1);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPitchMode(false);
      } else if (e.key === "n" || e.key === "N") {
        setNotesOpen((v) => !v);
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        if (current?.layout !== "cover" && current?.layout !== "toc-grid" && revealStep < maxSteps) {
          setRevealStep((s) => s + 1);
        } else if (slideIdx < slides.length - 1) {
          setSlideIdx((i) => i + 1);
          setRevealStep(1);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (slideIdx > 0) {
          setSlideIdx((i) => i - 1);
          setRevealStep(99);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pitchMode, slides, slideIdx, revealStep, setPitchMode]);

  if (!pitchMode || slides.length === 0) return null;
  const slide = slides[Math.min(slideIdx, slides.length - 1)];
  const accentCss = hex8ToCss(palette.branches[slide.accentIndex % palette.branches.length]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        backgroundColor: hex8ToCss(palette.canvasBg),
        color: hex8ToCss(palette.textPrimary),
      }}
    >
      {/* Top HUD */}
      <div className="flex items-center justify-between px-6 py-3 text-xs opacity-80">
        <div className="font-mono">
          {slideIdx + 1} / {slides.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-current/20 px-3 py-1 hover:bg-black/5"
          >
            <FileText className="h-3.5 w-3.5" /> 备注 (N)
          </button>
          <button
            type="button"
            onClick={() => void exportPitchToPptx(doc, `${doc.sheets[0].title}.pptx`, slides)}
            className="flex items-center gap-1 rounded-full border border-current/20 px-3 py-1 hover:bg-black/5"
          >
            <Download className="h-3.5 w-3.5" /> 导出 .pptx
          </button>
          <button
            type="button"
            onClick={() => setPitchMode(false)}
            className="rounded-full p-1.5 hover:bg-black/10"
            title="退出 (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Slide Canvas */}
      <div className="relative flex flex-1 items-center justify-center px-12 pb-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-5xl"
          >
            {slide.layout === "cover" && (
              <div className="text-center">
                <div
                  className="mx-auto mb-6 h-1.5 w-20 rounded-full"
                  style={{ backgroundColor: accentCss }}
                />
                <h1 className="text-5xl font-extrabold tracking-tight">{slide.title}</h1>
                {slide.subtitle && (
                  <p className="mt-5 text-xl opacity-70">{slide.subtitle}</p>
                )}
              </div>
            )}

            {slide.layout === "toc-grid" && (
              <div>
                <h2 className="mb-8 text-3xl font-bold">{slide.title}</h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {slide.bullets.map((b, i) => {
                    const bColor = hex8ToCss(palette.branches[i % palette.branches.length]);
                    return (
                      <div
                        key={b.id}
                        className="rounded-2xl border p-5 shadow-xs"
                        style={{
                          backgroundColor: hex8ToCss(palette.cardBg),
                          borderColor: bColor,
                        }}
                      >
                        <div className="mb-2 text-lg font-bold" style={{ color: bColor }}>
                          0{i + 1}. {b.text}
                        </div>
                        <ul className="space-y-1 text-sm opacity-75">
                          {b.subItems.map((sub, si) => (
                            <li key={si}>• {sub}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(slide.layout === "bullet-list" || slide.layout === "split-media") && (
              <div>
                <div className="mb-8 flex items-center gap-3">
                  <span className="h-9 w-2 rounded-full" style={{ backgroundColor: accentCss }} />
                  <div>
                    <h2 className="text-3xl font-bold">{slide.title}</h2>
                    {slide.subtitle && <p className="text-sm opacity-65">{slide.subtitle}</p>}
                  </div>
                </div>

                <div className={slide.layout === "split-media" ? "grid grid-cols-2 gap-8" : ""}>
                  <ul className="space-y-4">
                    {slide.bullets.map((b, i) => {
                      const visible = i < revealStep;
                      return (
                        <li
                          key={b.id}
                          className="transition-opacity duration-300"
                          style={{ opacity: visible ? 1 : 0.16 }}
                        >
                          <div className="flex items-start gap-3 text-xl font-semibold">
                            <span
                              className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: accentCss }}
                            />
                            <span>{b.text}</span>
                          </div>
                          {b.subItems.length > 0 && (
                            <ul className="mt-1.5 ml-6 space-y-1 text-base opacity-75">
                              {b.subItems.map((sub, si) => (
                                <li key={si}>– {sub}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {slide.layout === "split-media" && (
                    <div
                      className="flex flex-col justify-center rounded-2xl border p-6"
                      style={{
                        backgroundColor: hex8ToCss(palette.cardBg),
                        borderColor: hex8ToCss(palette.cardBorder),
                      }}
                    >
                      {slide.imageDataUrl ? (
                        <img
                          src={slide.imageDataUrl}
                          alt=""
                          className="max-h-72 w-full rounded-lg object-contain"
                        />
                      ) : (
                        <div className="whitespace-pre-wrap text-sm leading-relaxed opacity-85">
                          {slide.note}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Controls */}
      <div className="fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-current/15 bg-black/10 px-4 py-1.5 text-xs backdrop-blur">
        <button
          type="button"
          disabled={slideIdx === 0}
          onClick={() => {
            setSlideIdx((i) => Math.max(0, i - 1));
            setRevealStep(99);
          }}
          className="rounded-full p-1 hover:bg-black/10 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span>Space / → 步进下一要点</span>
        <button
          type="button"
          disabled={slideIdx >= slides.length - 1}
          onClick={() => {
            setSlideIdx((i) => Math.min(slides.length - 1, i + 1));
            setRevealStep(1);
          }}
          className="rounded-full p-1 hover:bg-black/10 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Speaker Notes Drawer */}
      {notesOpen && (
        <div className="fixed bottom-16 right-6 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-2xl">
          <div className="mb-2 font-bold text-slate-900">演讲者备注</div>
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {slide.note || "当前页暂无备注"}
          </div>
        </div>
      )}
    </div>
  );
};
