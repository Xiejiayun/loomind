import { richTextToPlainText, type RichTextDoc } from "../model/document.js";

export interface MeasuredText {
  width: number;
  height: number;
  lines: string[];
}

export interface TextMeasureOptions {
  fontSize: number;
  fontWeight: number;
  maxWidth: number;
  fontFamily?: string;
}

export interface TextMeasurer {
  measureRichText(
    doc: RichTextDoc,
    opts: TextMeasureOptions,
  ): MeasuredText;
  measurePlainText(
    text: string,
    opts: TextMeasureOptions,
  ): MeasuredText;
}

function isWideChar(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3400 && code <= 0x4dbf)
  );
}

function estimateStringWidth(text: string, fontSize: number, fontWeight: number): number {
  const weightFactor = fontWeight >= 600 ? 1.05 : 1.0;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isWideChar(code)) {
      w += fontSize * 1.02;
    } else if (text[i] === " ") {
      w += fontSize * 0.32;
    } else {
      w += fontSize * 0.58;
    }
  }
  return w * weightFactor;
}

export class HeadlessTextMeasurer implements TextMeasurer {
  measureRichText(
    doc: RichTextDoc,
    opts: { fontSize: number; fontWeight: number; maxWidth: number },
  ): MeasuredText {
    return this.measurePlainText(richTextToPlainText(doc), opts);
  }

  measurePlainText(
    text: string,
    opts: { fontSize: number; fontWeight: number; maxWidth: number },
  ): MeasuredText {
    const rawLines = (text || " ").split("\n");
    const lines: string[] = [];
    const maxW = Math.max(40, opts.maxWidth);

    for (const raw of rawLines) {
      if (raw.length === 0) {
        lines.push("");
        continue;
      }
      let current = "";
      let currentW = 0;
      for (const ch of raw) {
        const chW = estimateStringWidth(ch, opts.fontSize, opts.fontWeight);
        if (current.length > 0 && currentW + chW > maxW) {
          lines.push(current);
          current = ch;
          currentW = chW;
        } else {
          current += ch;
          currentW += chW;
        }
      }
      if (current.length > 0) lines.push(current);
    }

    const finalLines = lines.length > 0 ? lines : [" "];
    const width = Math.min(
      maxW,
      Math.max(24, ...finalLines.map((l) => estimateStringWidth(l, opts.fontSize, opts.fontWeight))),
    );
    const lineHeight = Math.round(opts.fontSize * 1.4);
    const height = Math.max(lineHeight, finalLines.length * lineHeight);
    return { width: Math.ceil(width), height: Math.ceil(height), lines: finalLines };
  }
}
