import { computeSheetLayout } from "../layout/engine.js";
import type { MindmapLayoutResult } from "../layout/types.js";
import {
  richTextToPlainText,
  type MindmapDocument,
  type MindmapTopic,
} from "../model/document.js";
import { collectAllTopics } from "../model/invariants.js";
import { getThemePalette } from "../theme/palettes.js";
import { hex8ToCss } from "../theme/tokens.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Pure vector SVG serializer with ZERO <foreignObject>.
 * All text is emitted as native <text>/<tspan> elements so svg2pdf.js produces
 * crisp, searchable, selectable vector PDFs.
 */
export function serializeToSvg(
  doc: MindmapDocument,
  opts?: { sheetId?: string; layout?: MindmapLayoutResult; transparentBg?: boolean; padding?: number },
): string {
  const sheet =
    doc.sheets.find((s) => s.id === (opts?.sheetId ?? doc.activeSheetId)) ?? doc.sheets[0];
  const layout = opts?.layout ?? computeSheetLayout(doc, sheet.id);
  const theme = { ...doc.theme, ...sheet.theme };
  const palette = getThemePalette(theme);
  const topicMap = collectAllTopics(sheet);

  const pad = opts?.padding ?? 48;
  const vx = Math.floor(layout.bounds.x - pad);
  const vy = Math.floor(layout.bounds.y - pad);
  const vw = Math.ceil(layout.bounds.width + pad * 2);
  const vh = Math.ceil(layout.bounds.height + pad * 2);

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}">`,
  );

  if (!opts?.transparentBg) {
    lines.push(`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${hex8ToCss(palette.canvasBg)}" />`);
  }
  if (Array.from(layout.nodes.values()).some((node) => node.fillPattern === "hachure")) {
    lines.push('<defs><pattern id="topic-hachure" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><path d="M 0 0 V 13" stroke="white" stroke-opacity="0.38" stroke-width="2"/></pattern></defs>');
  }

  // Boundaries
  for (const b of layout.boundaries) {
    lines.push(
      `<path d="${b.svgPath}" fill="${hex8ToCss(b.fillColor)}" stroke="${hex8ToCss(b.strokeColor)}" stroke-width="1.6" stroke-dasharray="6 4" />`,
    );
    if (b.badgeBox && b.title) {
      lines.push(
        `<rect x="${b.badgeBox.x}" y="${b.badgeBox.y}" width="${b.badgeBox.width}" height="${b.badgeBox.height}" rx="6" fill="${hex8ToCss(b.badgeColor)}" />`,
      );
      lines.push(
        `<text x="${b.badgeBox.x + b.badgeBox.width / 2}" y="${b.badgeBox.y + 15}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="600" fill="#FFFFFF">${escapeXml(b.title)}</text>`,
      );
    }
  }

  // Edges
  for (const e of layout.edges) {
    if (e.fillPath) {
      lines.push(`<path d="${e.fillPath}" fill="${hex8ToCss(e.color)}" />`);
    } else {
      lines.push(
        `<path d="${e.svgPath}" fill="none" stroke="${hex8ToCss(e.color)}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`,
      );
    }
  }

  // Summaries
  for (const s of layout.summaries) {
    lines.push(
      `<path d="${s.bracePath}" fill="none" stroke="${hex8ToCss(s.color)}" stroke-width="2" stroke-linecap="round" />`,
    );
  }

  // Relationships
  for (const r of layout.relationships) {
    const dash = r.dash === "dashed" ? ` stroke-dasharray="6 4"` : r.dash === "dotted" ? ` stroke-dasharray="2 4"` : "";
    lines.push(
      `<path d="${r.svgPath}" fill="none" stroke="${hex8ToCss(r.color)}" stroke-width="${r.strokeWidth}"${dash} />`,
    );
    if (r.labelPos && r.title) {
      lines.push(
        `<text x="${r.labelPos.x}" y="${r.labelPos.y}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#0F172A">${escapeXml(r.title)}</text>`,
      );
    }
  }

  // Topics (pure SVG rect/line + <text>/<tspan>)
  for (const [id, node] of layout.nodes) {
    const topic: MindmapTopic | undefined = topicMap.get(id);
    if (!topic) continue;
    const b = node.contentBox;
    const fillCss = node.underlineMode ? "none" : hex8ToCss(node.fillColor);
    const strokeCss = hex8ToCss(node.strokeColor);
    const textCss = hex8ToCss(node.textColor);

    if (topic.callout && node.calloutBox) {
      const cb = node.calloutBox;
      lines.push(
        `<rect x="${cb.x}" y="${cb.y}" width="${cb.width}" height="${cb.height}" rx="8" fill="#FEF3C7" stroke="#FCD34D" stroke-width="1" />`,
      );
      lines.push(
        `<text x="${cb.x + cb.width / 2}" y="${cb.y + cb.height / 2 + 4}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#78350F">${escapeXml(richTextToPlainText(topic.callout.title))}</text>`,
      );
    }

    if (node.underlineMode) {
      if (!node.underlineDrawnByEdge) {
        lines.push(
          `<line x1="${b.x}" y1="${b.y + b.height - 1}" x2="${b.x + b.width}" y2="${b.y + b.height - 1}" stroke="${strokeCss}" stroke-width="${Math.max(1.2, node.strokeWidth)}" />`,
        );
      }
    } else {
      const rx = Math.min(node.cornerRadius, b.height / 2);
      const sw = node.strokeWidth > 0 ? ` stroke="${strokeCss}" stroke-width="${node.strokeWidth}"` : "";
      lines.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${rx}" fill="${fillCss}"${sw} />`,
      );
      if (node.fillPattern === "hachure") lines.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${rx}" fill="url(#topic-hachure)" />`);
    }

    const textLines = richTextToPlainText(topic.title).split("\n");
    const lineH = Math.round(node.fontSize * 1.4);
    const startY = b.y + (b.height - textLines.length * lineH) / 2 + node.fontSize;
    const textX = b.x + (node.depth === 0 ? b.width / 2 : 12);
    const anchor = node.depth === 0 ? "middle" : "start";

    lines.push(
      `<text x="${textX}" y="${startY}" text-anchor="${anchor}" font-family="${escapeXml(node.fontFamily ?? "sans-serif")}" font-size="${node.fontSize}" font-weight="${node.fontWeight}" fill="${textCss}">` +
        textLines
          .map((line, i) => `<tspan x="${textX}" dy="${i === 0 ? 0 : lineH}">${escapeXml(line)}</tspan>`)
          .join("") +
        `</text>`,
    );
  }

  lines.push(`</svg>`);
  return lines.join("\n");
}
