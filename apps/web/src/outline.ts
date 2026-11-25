import { createTopic, generateId, getTemplate, MindmapDocumentSchema, validateDocumentInvariants, type MindmapDocument, type MindmapTopic } from "@mindmap/core";

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
  let count = 0;
  const walk = (item: unknown, depth: number): OutlineNode => {
    if (!item || typeof item !== "object" || depth > MAX_OUTLINE_DEPTH) throw new Error("大纲层级不能超过 6 层。");
    const node = item as { title?: unknown; children?: unknown };
    if (typeof node.title !== "string" || !node.title.trim() || node.title.length > 120 || !Array.isArray(node.children)) {
      throw new Error("大纲包含无效或过长的节点。");
    }
    if (++count > MAX_OUTLINE_NODES) throw new Error("一张导图最多支持 120 个大纲节点。");
    return { title: node.title.trim(), children: node.children.map((child) => walk(child, depth + 1)) };
  };
  return walk(value, 0);
}

export function parseOutline(raw: string): OutlineNode {
  if (raw.length > 16_000) throw new Error("大纲文本超过 16,000 字，请拆成多张导图。");
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
  if (!lines.length) throw new Error("请先粘贴大纲内容。");

  const listOnly = lines[0].bullet;
  const root: OutlineNode = { title: listOnly ? "新导图" : lines[0].title, children: [] };
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
  const tree = validateOutline(outline);
  if (!tree.children.length) throw new Error("大纲至少需要一个一级分支。");
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
  if (validateDocumentInvariants(document).length) throw new Error("大纲无法生成有效导图，请检查层级。");
  return document;
}

export function documentFromTopic(title: string, templateId = "blank-organic"): MindmapDocument {
  const clean = title.trim();
  if (!clean || clean.length > 120) throw new Error("主题需在 1 到 120 字之间。");
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
