import { richTextToPlainText, type MeasuredText, type RichTextDoc, type TextMeasurer } from "@mindmap/core";

export class DomTextMeasurer implements TextMeasurer {
  private ctx: CanvasRenderingContext2D | null = null;
  private fontFamily: string;

  constructor(fontFamily?: string) {
    if (typeof document !== "undefined") {
      const computed = window.getComputedStyle(document.body).fontFamily;
      this.fontFamily =
        fontFamily ??
        (computed && computed.length > 0
          ? computed
          : 'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif');
      const canvas = document.createElement("canvas");
      this.ctx = canvas.getContext("2d");
    } else {
      this.fontFamily = fontFamily ?? "sans-serif";
    }
  }

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

    if (this.ctx) {
      this.ctx.font = `${opts.fontWeight} ${opts.fontSize}px ${this.fontFamily}`;
    }

    const measureStr = (s: string) => {
      if (this.ctx) return this.ctx.measureText(s).width * 1.04;
      return s.length * opts.fontSize * 0.78;
    };

    for (const raw of rawLines) {
      if (raw.length === 0) {
        lines.push("");
        continue;
      }
      if (measureStr(raw) <= maxW) {
        lines.push(raw);
        continue;
      }
      let cur = "";
      for (const ch of raw) {
        const next = cur + ch;
        if (cur.length > 0 && measureStr(next) > maxW) {
          lines.push(cur);
          cur = ch;
        } else {
          cur = next;
        }
      }
      if (cur.length > 0) lines.push(cur);
    }

    const finalLines = lines.length > 0 ? lines : [" "];
    const width = Math.min(maxW, Math.max(24, ...finalLines.map(measureStr)));
    const lineHeight = Math.round(opts.fontSize * 1.42);
    const height = Math.max(lineHeight, finalLines.length * lineHeight);
    return { width: Math.ceil(width) + 4, height: Math.ceil(height), lines: finalLines };
  }
}
