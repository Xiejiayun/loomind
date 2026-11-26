import { createTopic, generateId, getTemplate, MindmapDocumentSchema, validateDocumentInvariants, type MindmapDocument, type MindmapTopic } from "@mindmap/core";
import { getWebMessages } from "./i18n.js";

export interface OutlineNode {
  title: string;
  children: OutlineNode[];
}

export const MAX_OUTLINE_NODES = 120;
export const MAX_OUTLINE_DEPTH = 6;

export function outlineNodeCount(node: OutlineNode): number {
  return 1 + node.children.reduce((total, child) => total + outlineNodeCount(child), 0);
}

export function validateOutline(value: unknown): OutlineNode {
  const err = getWebMessages().errors;
  let count = 0;
  const walk = (item: unknown, depth: number): OutlineNode => {
    if (!item || typeof item !== "object" || depth > MAX_OUTLINE_DEPTH) throw new Error(err.outlineMaxDepth);
    const node = item as { title?: unknown; children?: unknown };
    if (typeof node.title !== "string" || !node.title.trim() || node.title.length > 120 || !Array.isArray(node.children)) {
      throw new Error(err.outlineInvalidNode);
    }
    if (++count > MAX_OUTLINE_NODES) throw new Error(err.outlineMaxNodes);
    return { title: node.title.trim(), children: node.children.map((child) => walk(child, depth + 1)) };
  };
  return walk(value, 0);
}

export function parseOutline(raw: string): OutlineNode {
  const err = getWebMessages().errors;
  if (raw.length > 16_000) throw new Error(err.outlineMaxChars);
  const lines = raw.split(/\r?\n/).map((source) => {
    const line = source.replace(/\t/g, "  ");
    const heading = /^(\s*)(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    return {
      title: (heading?.[3] ?? bullet?.[2] ?? line.trim()).trim(),
      indent: (heading?.[1] ?? bullet?.[1] ?? /^\s*/.exec(line)?.[0] ?? "").length,
      heading: heading?.[2].length ?? 0,
      bullet: !!bullet,
    };
  }).filter((line) => line.title);
  if (!lines.length) throw new Error(err.outlineEmpty);

  const listOnly = lines[0].bullet;
  const root: OutlineNode = { title: listOnly ? err.outlineDefaultRoot : lines[0].title, children: [] };
  const rootHeading = lines[0].heading || 1;
  const stack: Array<{ level: number; node: OutlineNode }> = [{ level: 0, node: root }];
  let activeHeadingLevel = 0;
  for (const line of lines.slice(listOnly ? 0 : 1)) {
    let level: number;
    if (line.heading) {
      level = Math.max(1, line.heading - rootHeading);
      activeHeadingLevel = level;
    } else if (line.bullet) {
      level = activeHeadingLevel + 1 + Math.floor(line.indent / 2);
    } else {
      level = activeHeadingLevel + Math.max(1, Math.floor(line.indent / 2));
    }
    level = Math.min(level, stack[stack.length - 1].level + 1);
    while (stack[stack.length - 1].level >= level) stack.pop();
    const node: OutlineNode = { title: line.title, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level, node });
  }
  return validateOutline(root);
}

export function documentFromOutline(outline: OutlineNode, templateId: string): MindmapDocument {
  const err = getWebMessages().errors;
  const tree = validateOutline(outline);
  if (!tree.children.length) throw new Error(err.outlineNeedsBranch);
  const template = getTemplate(templateId).create();
  const topic = (node: OutlineNode): MindmapTopic => createTopic(generateId("topic"), node.title, {
    children: node.children.map(topic),
  });
  const sheet = {
    ...template.sheets[0],
    id: generateId("sheet"),
    title: tree.title,
    rootTopic: topic(tree),
    floatingTopics: [],
    boundaries: [],
    summaries: [],
    relationships: [],
  };
  const document = MindmapDocumentSchema.parse({
    ...template,
    activeSheetId: sheet.id,
    sheets: [sheet],
    assets: {},
    deletedIds: [],
  });
  if (validateDocumentInvariants(document).length) throw new Error(err.outlineInvalidTree);
  return document;
}

export function documentFromTopic(title: string, templateId = "blank-organic"): MindmapDocument {
  const clean = title.trim();
  if (!clean || clean.length > 120) throw new Error(getWebMessages().errors.topicLength);
  const template = getTemplate(templateId).create();
  const sheet = {
    ...template.sheets[0],
    id: generateId("sheet"),
    title: clean,
    rootTopic: createTopic(generateId("topic"), clean),
    floatingTopics: [],
    boundaries: [],
    summaries: [],
    relationships: [],
  };
  return MindmapDocumentSchema.parse({ ...template, activeSheetId: sheet.id, sheets: [sheet], assets: {}, deletedIds: [] });
}
