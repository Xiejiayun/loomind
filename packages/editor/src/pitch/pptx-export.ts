import PptxGenJS from "pptxgenjs";
import { getPalette, type MindmapDocument } from "@mindmap/core";
import { compilePitchDeck, type PitchSlide } from "./compiler.js";

function hex6(hex8: string): string {
  return hex8.replace("#", "").slice(0, 6).toUpperCase();
}

export async function exportPitchToPptx(
  doc: MindmapDocument,
  filename = "mindmap-pitch.pptx",
  slidesOverride?: PitchSlide[],
): Promise<void> {
  const slides = slidesOverride ?? compilePitchDeck(doc);
  const palette = getPalette(doc.theme.paletteId);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  const bg = hex6(palette.canvasBg);
  const titleColor = hex6(palette.textPrimary);
  const mutedColor = hex6(palette.textMuted);

  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: bg };
    const accent = hex6(palette.branches[s.accentIndex % palette.branches.length]);

    if (s.note) slide.addNotes(s.note);

    if (s.layout === "cover") {
      slide.addText(s.title, {
        x: 0.8,
        y: 2.0,
        w: 8.4,
        h: 1.2,
        fontSize: 38,
        bold: true,
        color: titleColor,
        align: "center",
      });
      if (s.subtitle) {
        slide.addText(s.subtitle, {
          x: 1.2,
          y: 3.3,
          w: 7.6,
          h: 0.6,
          fontSize: 18,
          color: mutedColor,
          align: "center",
        });
      }
      continue;
    }

    // Header
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.55, w: 0.12, h: 0.55, fill: { color: accent } });
    slide.addText(s.title, {
      x: 0.85,
      y: 0.48,
      w: 8.6,
      h: 0.7,
      fontSize: 26,
      bold: true,
      color: titleColor,
    });

    if (s.layout === "toc-grid") {
      const cols = Math.min(3, Math.max(1, s.bullets.length));
      const cardW = (8.8 - (cols - 1) * 0.25) / cols;
      s.bullets.forEach((b, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 0.6 + col * (cardW + 0.25);
        const y = 1.5 + row * 1.65;
        const bAccent = hex6(palette.branches[i % palette.branches.length]);
        slide.addShape(pptx.ShapeType.roundRect, {
          x,
          y,
          w: cardW,
          h: 1.4,
          fill: { color: hex6(palette.cardBg) },
          line: { color: bAccent, width: 1.5 },
        });
        slide.addText(`${i + 1}. ${b.text}`, {
          x: x + 0.15,
          y: y + 0.15,
          w: cardW - 0.3,
          h: 0.45,
          fontSize: 15,
          bold: true,
          color: titleColor,
        });
        if (b.subItems.length > 0) {
          slide.addText(b.subItems.map((x) => `• ${x}`).join("\n"), {
            x: x + 0.15,
            y: y + 0.6,
            w: cardW - 0.3,
            h: 0.7,
            fontSize: 11,
            color: mutedColor,
          });
        }
      });
      continue;
    }

    // Bullet list or Split media
    const bulletW = s.layout === "split-media" ? 4.8 : 8.6;
    if (s.bullets.length > 0) {
      const items = s.bullets.flatMap((b) => [
        { text: b.text, options: { bullet: true, bold: true, fontSize: 18, color: titleColor, breakLine: true } },
        ...b.subItems.map((sub) => ({
          text: `   ${sub}`,
          options: { fontSize: 14, color: mutedColor, breakLine: true },
        })),
      ]);
      slide.addText(items, { x: 0.7, y: 1.45, w: bulletW, h: 3.8, valign: "top" });
    }

    if (s.layout === "split-media") {
      if (s.imageDataUrl) {
        slide.addImage({ data: s.imageDataUrl, x: 5.8, y: 1.5, w: 3.5, h: 3.2 });
      } else if (s.note) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 5.8,
          y: 1.5,
          w: 3.5,
          h: 3.2,
          fill: { color: hex6(palette.cardBg) },
          line: { color: accent, width: 1 },
        });
        slide.addText(s.note, {
          x: 6.0,
          y: 1.7,
          w: 3.1,
          h: 2.8,
          fontSize: 13,
          color: mutedColor,
          valign: "top",
        });
      }
    }
  }

  await pptx.writeFile({ fileName: filename });
}
