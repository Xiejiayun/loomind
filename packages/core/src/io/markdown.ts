import {
  createDocument,
  createSheet,
  createTopic,
  generateId,
  richTextToPlainText,
  type MindmapDocument,
  type MindmapTopic,
} from "../model/document.js";

export function exportToMarkdown(doc: MindmapDocument, sheetId?: string): string {
  const sheet =
    doc.sheets.find((s) => s.id === (sheetId ?? doc.activeSheetId)) ?? doc.sheets[0];
  const lines: string[] = [];

  const walk = (topic: MindmapTopic, depth: number) => {
    const text = richTextToPlainText(topic.title).replace(/\n/g, " ");
    if (depth === 0) {
      lines.push(`# ${text}`);
    } else if (depth === 1) {
      lines.push(`\n## ${text}`);
    } else {
      const indent = "  ".repeat(depth - 2);
      const taskPrefix =
        topic.task?.status === "done"
          ? "[x] "
          : topic.task?.status === "todo"
            ? "[ ] "
            : "";
      lines.push(`${indent}- ${taskPrefix}${text}`);
    }

    if (topic.note?.text) {
      const quoteIndent = depth >= 2 ? "  ".repeat(depth - 1) : "";
      for (const nl of topic.note.text.split("\n")) {
        lines.push(`${quoteIndent}> ${nl}`);
      }
    }

    for (const c of topic.children) walk(c, depth + 1);
  };

  walk(sheet.rootTopic, 0);
  return lines.join("\n").trim() + "\n";
}

export function importFromMarkdown(markdown: string): MindmapDocument {
  const lines = markdown.split(/\r?\n/);
  const root = createTopic("md-root", "思维导图");
  const stack: Array<{ depth: number; topic: MindmapTopic }> = [{ depth: 0, topic: root }];
  let lastTopic = root;
  let rootInitialized = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Blockquote -> attach as note to last topic
    if (trimmed.startsWith("> ")) {
      const noteLine = trimmed.slice(2);
      lastTopic.note = {
        format: "markdown",
        text: lastTopic.note ? `${lastTopic.note.text}\n${noteLine}` : noteLine,
      };
      continue;
    }

    let depth = 1;
    let text = trimmed;
    let task: MindmapTopic["task"] | undefined;

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    const listMatch = /^(\s*)[-*+]\s+(.+)$/.exec(rawLine);

    if (headingMatch) {
      const level = headingMatch[1].length;
      text = headingMatch[2].trim();
      if (level === 1 && !rootInitialized) {
        root.title = createTopic("tmp", text).title;
        rootInitialized = true;
        lastTopic = root;
        continue;
      }
      depth = Math.max(1, level - 1);
    } else if (listMatch) {
      const spaces = listMatch[1].replace(/\t/g, "  ").length;
      depth = Math.floor(spaces / 2) + 2;
      text = listMatch[2].trim();
      const taskMatch = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      if (taskMatch) {
        task = { status: taskMatch[1].toLowerCase() === "x" ? "done" : "todo" };
        text = taskMatch[2];
      }
    } else {
      depth = 1;
    }

    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].topic;
    const node = createTopic(generateId("md"), text, task ? { task } : undefined);
    parent.children.push(node);
    stack.push({ depth, topic: node });
    lastTopic = node;
  }

  return createDocument([createSheet("sheet-md", richTextToPlainText(root.title), root)]);
}
