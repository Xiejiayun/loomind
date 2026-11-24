import {
  createDocument,
  createSheet,
  createTopic,
  generateId,
  richTextToPlainText,
  type MindmapDocument,
  type MindmapTopic,
} from "../model/document.js";

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;");
}

function unescapeAttr(s: string): string {
  return s
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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

/** Zero-DOM regex/stack OPML 2.0 parser (works identically in Node & Browser) */
export function importFromOpml(xml: string): MindmapDocument {
  const tagRe = /<(\/?)outline\b([^>]*?)(\/?)>/gi;
  const attrRe = /([A-Za-z0-9_:-]+)="([^"]*)"/g;

  const stack: MindmapTopic[] = [];
  let root: MindmapTopic | null = null;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const isClose = match[1] === "/";
    const attrsRaw = match[2];
    const isSelfClose = match[3] === "/";

    if (isClose) {
      stack.pop();
      continue;
    }

    const attrs: Record<string, string> = {};
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrsRaw)) !== null) {
      attrs[am[1]] = unescapeAttr(am[2]);
    }

    const topic = createTopic(generateId("opml"), attrs.text ?? "节点", {
      ...(attrs._note ? { note: { format: "markdown", text: attrs._note } } : {}),
    });

    if (stack.length === 0) {
      root = topic;
    } else {
      stack[stack.length - 1].children.push(topic);
    }

    if (!isSelfClose) stack.push(topic);
  }

  const finalRoot = root ?? createTopic("opml-root", "OPML 导入");
  return createDocument([createSheet("sheet-opml", richTextToPlainText(finalRoot.title), finalRoot)]);
}
