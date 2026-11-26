import {
  createDocument,
  createSheet,
  createTopic,
  generateId,
  richTextToPlainText,
  type MindmapDocument,
  type MindmapTopic,
} from "../model/document.js";
import { validateDocumentInvariants } from "../model/invariants.js";
import { MindmapDocumentSchema } from "../model/schema.js";

const DEFAULT_MULTI_ROOT_TITLE = "OPML 导入";

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractHeadTitle(xml: string): string | null {
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(xml);
  if (!headMatch) return null;
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(headMatch[1]);
  if (!titleMatch) return null;
  const title = unescapeXml(titleMatch[1]).trim();
  return title.length > 0 ? title : null;
}

export function exportToOpml(doc: MindmapDocument, sheetId?: string): string {
  const sheet =
    doc.sheets.find((s) => s.id === (sheetId ?? doc.activeSheetId)) ?? doc.sheets[0];

  const renderNode = (topic: MindmapTopic, indent: string): string => {
    const text = escapeAttr(richTextToPlainText(topic.title));
    const noteAttr = topic.note?.text ? ` _note="${escapeAttr(topic.note.text)}"` : "";
    if (topic.children.length === 0) {
      return `${indent}<outline text="${text}"${noteAttr} />`;
    }
    const inner = topic.children.map((c) => renderNode(c, `${indent}  `)).join("\n");
    return `${indent}<outline text="${text}"${noteAttr}>\n${inner}\n${indent}</outline>`;
  };

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<opml version="2.0">\n` +
    `  <head><title>${escapeAttr(sheet.title)}</title></head>\n` +
    `  <body>\n` +
    `${renderNode(sheet.rootTopic, "    ")}\n` +
    `  </body>\n` +
    `</opml>\n`
  );
}

/**
 * Zero-DOM stack OPML 2.0 parser (works identically in Node & Browser):
 * - 0 top-level <outline> or malformed/unbalanced tags: throws explicit Error.
 * - 1 top-level <outline>: preserves single root & its exact text (even if <head><title> differs).
 * - >=2 top-level <outline>: preserves all top-level outlines in order under a synthetic root
 *   titled by <head><title> (or default "OPML 导入").
 */
export function importFromOpml(xml: string): MindmapDocument {
  if (typeof xml !== "string" || xml.trim().length === 0) {
    throw new Error("Invalid OPML: empty document");
  }

  // Strip XML comments so commented-out <outline> tags are ignored
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");

  // Match <outline ...> or </outline>, respecting quoted attribute values that may contain '>'
  const tagRe = /<(\/)?outline\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  const attrRe = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  const stack: MindmapTopic[] = [];
  const topLevel: MindmapTopic[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(cleaned)) !== null) {
    const isClose = match[1] === "/";
    const rawBody = (match[2] ?? "").trimEnd();
    const isSelfClose = rawBody.endsWith("/");
    const attrsRaw = isSelfClose ? rawBody.slice(0, -1) : rawBody;

    if (isClose) {
      if (isSelfClose) {
        throw new Error("Invalid OPML: malformed closing </outline/> tag");
      }
      if (stack.length === 0) {
        throw new Error("Invalid OPML: unexpected closing </outline> tag");
      }
      stack.pop();
      continue;
    }

    const attrs: Record<string, string> = {};
    attrRe.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrsRaw)) !== null) {
      const value = am[2] !== undefined ? am[2] : (am[3] ?? "");
      attrs[am[1]] = unescapeXml(value);
    }

    const topic = createTopic(generateId("opml"), attrs.text ?? "节点", {
      ...(attrs._note ? { note: { format: "markdown", text: attrs._note } } : {}),
    });

    if (stack.length === 0) {
      topLevel.push(topic);
    } else {
      stack[stack.length - 1].children.push(topic);
    }

    if (!isSelfClose) stack.push(topic);
  }

  if (stack.length > 0) {
    throw new Error("Invalid OPML: unclosed <outline> tag");
  }
  if (topLevel.length === 0) {
    throw new Error("Invalid OPML: no <outline> elements found");
  }

  let finalRoot: MindmapTopic;
  if (topLevel.length === 1) {
    finalRoot = topLevel[0];
  } else {
    const syntheticTitle = extractHeadTitle(cleaned) ?? DEFAULT_MULTI_ROOT_TITLE;
    finalRoot = createTopic(generateId("opml-root"), syntheticTitle, {
      children: topLevel,
    });
  }

  const doc = createDocument([createSheet("sheet-opml", richTextToPlainText(finalRoot.title), finalRoot)]);
  const parsed = MindmapDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(`Imported OPML failed schema validation: ${parsed.error.message}`);
  }
  const violations = validateDocumentInvariants(parsed.data);
  if (violations.length > 0) {
    throw new Error(`Imported OPML failed invariant validation: ${violations.map((v) => v.message).join("; ")}`);
  }
  return parsed.data;
}
