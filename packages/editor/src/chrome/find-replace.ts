import {
  richTextToPlainText,
  type MindmapCommand,
  type MindmapSheet,
  type MindmapTopic,
  type RichTextDoc,
  type RichTextNode,
  type RichTextParagraph,
} from "@mindmap/core";

export interface SearchOptions {
  caseSensitive?: boolean;
}

export interface TopicSearchMatch {
  topicId: string;
  titleMatches: number;
  subtitleMatches: number;
  noteMatches: number;
  labelMatches: number;
  totalMatches: number;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchRegex(query: string, caseSensitive: boolean): RegExp | null {
  if (!query) return null;
  return new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
}

export function countOccurrences(text: string, query: string, opts?: SearchOptions): number {
  const re = buildSearchRegex(query, Boolean(opts?.caseSensitive));
  if (!re || !text) return 0;
  let count = 0;
  while (re.exec(text) !== null) count += 1;
  return count;
}

export function replaceInPlainString(
  text: string,
  query: string,
  replacement: string,
  opts?: SearchOptions,
): { text: string; count: number } {
  const re = buildSearchRegex(query, Boolean(opts?.caseSensitive));
  if (!re || !text) return { text, count: 0 };
  let count = 0;
  const next = text.replace(re, () => {
    count += 1;
    return replacement;
  });
  return { text: next, count };
}

/**
 * Replaces all occurrences of `query` in a TipTap RichTextDoc while preserving
 * existing inline formatting marks (bold, italic, highlight, color, etc.).
 */
export function replaceInRichText(
  doc: RichTextDoc,
  query: string,
  replacement: string,
  opts?: SearchOptions,
): { doc: RichTextDoc; count: number } {
  const re = buildSearchRegex(query, Boolean(opts?.caseSensitive));
  if (!re) return { doc, count: 0 };

  let totalCount = 0;

  const nextContent: RichTextParagraph[] = doc.content.map((para) => {
    if (!para.content || para.content.length === 0) return para;

    // Build character-level ownership to support matches both within a single run and across mark boundaries
    const fullText = para.content.map((n) => n.text).join("");
    re.lastIndex = 0;
    const matches: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
    }
    if (matches.length === 0) return para;

    totalCount += matches.length;

    // Flatten runs into segments with start/end offsets
    const runs: Array<{ start: number; end: number; node: RichTextNode }> = [];
    let offset = 0;
    for (const node of para.content) {
      runs.push({ start: offset, end: offset + node.text.length, node });
      offset += node.text.length;
    }

    const marksAt = (pos: number) => {
      const r = runs.find((run) => pos >= run.start && pos < run.end);
      return r?.node.marks ? structuredClone(r.node.marks) : undefined;
    };

    const outputNodes: RichTextNode[] = [];
    const appendText = (text: string, marks?: RichTextNode["marks"]) => {
      if (!text) return;
      const prev = outputNodes[outputNodes.length - 1];
      if (prev && JSON.stringify(prev.marks ?? null) === JSON.stringify(marks ?? null)) {
        prev.text += text;
      } else {
        outputNodes.push(marks && marks.length > 0 ? { type: "text", text, marks } : { type: "text", text });
      }
    };

    const appendSliceFromRuns = (sliceStart: number, sliceEnd: number) => {
      if (sliceStart >= sliceEnd) return;
      for (const run of runs) {
        if (run.end <= sliceStart || run.start >= sliceEnd) continue;
        const s = Math.max(sliceStart, run.start) - run.start;
        const e = Math.min(sliceEnd, run.end) - run.start;
        appendText(run.node.text.slice(s, e), run.node.marks ? structuredClone(run.node.marks) : undefined);
      }
    };

    let cursor = 0;
    for (const match of matches) {
      appendSliceFromRuns(cursor, match.start);
      appendText(replacement, marksAt(match.start));
      cursor = match.end;
    }
    appendSliceFromRuns(cursor, fullText.length);

    return outputNodes.length > 0
      ? { type: "paragraph", content: outputNodes }
      : { type: "paragraph" };
  });

  if (totalCount === 0) return { doc, count: 0 };
  return {
    doc: { type: "doc", content: nextContent },
    count: totalCount,
  };
}

/**
 * Searches all topics in a sheet (main tree, floating topics, and summary topics)
 * in pre-order DFS order across titles, subtitles, notes, and labels.
 */
export function findTopicsInSheet(
  sheet: MindmapSheet,
  query: string,
  opts?: SearchOptions,
): TopicSearchMatch[] {
  if (!query) return [];
  const results: TopicSearchMatch[] = [];

  const visit = (topic: MindmapTopic) => {
    const titleMatches = countOccurrences(richTextToPlainText(topic.title), query, opts);
    const subtitleMatches = topic.subtitle ? countOccurrences(topic.subtitle, query, opts) : 0;
    const noteMatches = topic.note?.text ? countOccurrences(topic.note.text, query, opts) : 0;
    const labelMatches = (topic.labels ?? []).reduce((sum, l) => sum + countOccurrences(l, query, opts), 0);
    const totalMatches = titleMatches + subtitleMatches + noteMatches + labelMatches;
    if (totalMatches > 0) {
      results.push({
        topicId: topic.id,
        titleMatches,
        subtitleMatches,
        noteMatches,
        labelMatches,
        totalMatches,
      });
    }
    for (const child of topic.children) visit(child);
  };

  visit(sheet.rootTopic);
  for (const f of sheet.floatingTopics) visit(f);
  for (const s of sheet.summaries) visit(s.topic);

  return results;
}

/**
 * Finds the ancestor IDs of `targetId` in `sheet` (from root down to immediate parent),
 * useful for auto-expanding collapsed branches when jumping to a search match.
 */
export function findAncestorTopicIds(sheet: MindmapSheet, targetId: string): string[] {
  const walk = (node: MindmapTopic, path: string[]): string[] | null => {
    if (node.id === targetId) return path;
    for (const c of node.children) {
      const found = walk(c, [...path, node.id]);
      if (found) return found;
    }
    return null;
  };
  const inMain = walk(sheet.rootTopic, []);
  if (inMain) return inMain;
  for (const f of sheet.floatingTopics) {
    const res = walk(f, []);
    if (res) return res;
  }
  for (const s of sheet.summaries) {
    const res = walk(s.topic, []);
    if (res) return res;
  }
  return [];
}

/**
 * Builds standard undoable MindmapCommands to replace occurrences of `query` in a single topic.
 */
export function buildReplaceCommandsForTopic(
  sheetId: string,
  topic: MindmapTopic,
  query: string,
  replacement: string,
  opts?: SearchOptions,
): { commands: MindmapCommand[]; count: number } {
  const commands: MindmapCommand[] = [];
  let count = 0;

  const titleRes = replaceInRichText(topic.title, query, replacement, opts);
  if (titleRes.count > 0) {
    commands.push({ type: "topic/setTitle", sheetId, topicId: topic.id, title: titleRes.doc });
    count += titleRes.count;
  }

  if (topic.subtitle) {
    const subRes = replaceInPlainString(topic.subtitle, query, replacement, opts);
    if (subRes.count > 0) {
      commands.push({ type: "topic/setSubtitle", sheetId, topicId: topic.id, subtitle: subRes.text });
      count += subRes.count;
    }
  }

  if (topic.note?.text) {
    const noteRes = replaceInPlainString(topic.note.text, query, replacement, opts);
    if (noteRes.count > 0) {
      commands.push({ type: "topic/setNote", sheetId, topicId: topic.id, text: noteRes.text });
      count += noteRes.count;
    }
  }

  if (topic.labels && topic.labels.length > 0) {
    let labelCount = 0;
    const nextLabels = topic.labels.map((l) => {
      const r = replaceInPlainString(l, query, replacement, opts);
      labelCount += r.count;
      return r.text;
    });
    if (labelCount > 0) {
      commands.push({ type: "topic/setLabels", sheetId, topicId: topic.id, labels: nextLabels });
      count += labelCount;
    }
  }

  return { commands, count };
}
