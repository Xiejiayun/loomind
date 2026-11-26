import type { RichTextDoc, RichTextMark, RichTextNode, RichTextParagraph } from "@mindmap/core";

export const DEFAULT_HIGHLIGHT_HEX8 = "#FEF08AFF";

const SIMPLE_MARK_TYPES = new Set(["bold", "italic", "strike", "code"] as const);

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number): string {
  return clampByte(n).toString(16).toUpperCase().padStart(2, "0");
}

function parseRgbChannel(raw: string): number | null {
  const token = raw.trim();
  if (token.endsWith("%")) {
    const pct = Number(token.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return (pct / 100) * 255;
  }
  const num = Number(token);
  return Number.isFinite(num) ? num : null;
}

function parseAlphaChannel(raw: string): number | null {
  const token = raw.trim();
  if (token.endsWith("%")) {
    const pct = Number(token.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(1, pct / 100)) * 255;
  }
  const num = Number(token);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(1, num)) * 255;
}

/**
 * Parses hex (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) or CSS rgb()/rgba() color strings
 * into canonical 8-digit uppercase #RRGGBBAA. Returns null for invalid/unsupported inputs.
 */
export function parseCssColorToHex8(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (/^#[0-9A-F]{8}$/.test(upper)) return upper;
  if (/^#[0-9A-F]{6}$/.test(upper)) return `${upper}FF`;
  if (/^#[0-9A-F]{3}$/.test(upper)) {
    const [, r, g, b] = upper;
    return `#${r}${r}${g}${g}${b}${b}FF`;
  }
  if (/^#[0-9A-F]{4}$/.test(upper)) {
    const [, r, g, b, a] = upper;
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
  }

  const rgbMatch = /^rgba?\(\s*([^)]+)\s*\)$/i.exec(trimmed);
  if (!rgbMatch) return null;

  const inner = rgbMatch[1].trim();
  let channels: string[];
  let alphaRaw: string | undefined;

  if (inner.includes(",")) {
    const parts = inner.split(",").map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    channels = parts.slice(0, 3);
    alphaRaw = parts[3];
  } else {
    const slashParts = inner.split("/").map((p) => p.trim());
    if (slashParts.length > 2) return null;
    channels = slashParts[0].split(/\s+/).filter(Boolean);
    if (channels.length !== 3) return null;
    alphaRaw = slashParts[1];
  }

  const r = parseRgbChannel(channels[0]);
  const g = parseRgbChannel(channels[1]);
  const b = parseRgbChannel(channels[2]);
  const a = alphaRaw !== undefined ? parseAlphaChannel(alphaRaw) : 255;
  if (r === null || g === null || b === null || a === null) return null;

  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}${toHexByte(a)}`;
}

function normalizeMark(raw: unknown): RichTextMark | null {
  if (!raw || typeof raw !== "object") return null;
  const mark = raw as Record<string, unknown>;
  const type = mark.type;
  if (typeof type !== "string") return null;

  if (
    type === "bold" ||
    type === "italic" ||
    type === "strike" ||
    type === "code"
  ) {
    return { type };
  }

  const attrs =
    mark.attrs && typeof mark.attrs === "object"
      ? (mark.attrs as Record<string, unknown>)
      : undefined;

  if (type === "textStyle") {
    const color = parseCssColorToHex8(attrs?.color);
    return color ? { type: "textStyle", attrs: { color } } : null;
  }

  if (type === "highlight") {
    const bg =
      parseCssColorToHex8(attrs?.backgroundColor) ??
      parseCssColorToHex8(attrs?.color);
    return bg
      ? { type: "highlight", attrs: { backgroundColor: bg } }
      : { type: "highlight" };
  }

  if (type === "link") {
    const href = typeof attrs?.href === "string" ? attrs.href.trim() : "";
    return href ? { type: "link", attrs: { href } } : null;
  }

  return null;
}

function normalizeInlineContent(rawContent: unknown[]): RichTextParagraph[] {
  const paragraphs: RichTextParagraph[] = [];
  let currentNodes: RichTextNode[] = [];

  const flushParagraph = () => {
    paragraphs.push(
      currentNodes.length > 0
        ? { type: "paragraph", content: currentNodes }
        : { type: "paragraph" },
    );
    currentNodes = [];
  };

  for (const item of rawContent) {
    if (!item || typeof item !== "object") continue;
    const node = item as Record<string, unknown>;

    if (node.type === "hardBreak") {
      flushParagraph();
      continue;
    }

    if (node.type === "text" && typeof node.text === "string") {
      const normalizedMarks = Array.isArray(node.marks)
        ? node.marks.map(normalizeMark).filter((m): m is RichTextMark => m !== null)
        : [];
      currentNodes.push({
        type: "text",
        text: node.text,
        ...(normalizedMarks.length > 0 ? { marks: normalizedMarks } : {}),
      });
    }
  }

  flushParagraph();
  return paragraphs;
}

function collectParagraphsFromBlock(node: unknown, out: RichTextParagraph[]): void {
  if (!node || typeof node !== "object") return;
  const block = node as Record<string, unknown>;
  const content = Array.isArray(block.content) ? block.content : [];

  if (block.type === "paragraph" || block.type === "heading") {
    out.push(...normalizeInlineContent(content));
    return;
  }

  if (content.length > 0) {
    const hasInline = content.some(
      (child) =>
        child &&
        typeof child === "object" &&
        ((child as Record<string, unknown>).type === "text" ||
          (child as Record<string, unknown>).type === "hardBreak"),
    );
    if (hasInline) {
      out.push(...normalizeInlineContent(content));
    } else {
      for (const child of content) {
        collectParagraphsFromBlock(child, out);
      }
    }
  }
}

/**
 * Converts TipTap editor JSON into a schema-compliant canonical RichTextDoc:
 * - Normalizes all color/highlight attributes to 8-digit uppercase #RRGGBBAA
 * - Maps TipTap highlight `attrs.color` -> canonical `attrs.backgroundColor`
 * - Splits `hardBreak` nodes into separate paragraphs without losing text
 * - Strips unknown marks and invalid/null attributes
 */
export function normalizeTipTapJson(json: Record<string, unknown>): RichTextDoc {
  const rawContent = Array.isArray(json.content) ? json.content : [];
  const paragraphs: RichTextParagraph[] = [];

  for (const block of rawContent) {
    collectParagraphsFromBlock(block, paragraphs);
  }

  return {
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  };
}

/**
 * Converts a canonical RichTextDoc into TipTap-compatible JSON so re-entering
 * TopicEditor preserves highlight colors (`backgroundColor` -> TipTap `color`)
 * and all supported marks.
 */
export function richTextDocToTipTapJson(doc: RichTextDoc): Record<string, unknown> {
  return {
    type: "doc",
    content: doc.content.map((p) => ({
      type: "paragraph",
      ...(p.content && p.content.length > 0
        ? {
            content: p.content.map((node) => ({
              type: "text",
              text: node.text,
              ...(node.marks && node.marks.length > 0
                ? {
                    marks: node.marks
                      .map((m) => {
                        if (SIMPLE_MARK_TYPES.has(m.type as "bold" | "italic" | "strike" | "code")) {
                          return { type: m.type };
                        }
                        if (m.type === "highlight") {
                          const color =
                            parseCssColorToHex8(m.attrs?.backgroundColor) ??
                            parseCssColorToHex8(m.attrs?.color) ??
                            DEFAULT_HIGHLIGHT_HEX8;
                          return { type: "highlight", attrs: { color } };
                        }
                        if (m.type === "textStyle") {
                          const color = parseCssColorToHex8(m.attrs?.color);
                          return color ? { type: "textStyle", attrs: { color } } : null;
                        }
                        if (m.type === "link" && m.attrs?.href) {
                          return { type: "link", attrs: { href: m.attrs.href } };
                        }
                        return null;
                      })
                      .filter((m): m is NonNullable<typeof m> => m !== null),
                  }
                : {}),
            })),
          }
        : {}),
    })),
  };
}
