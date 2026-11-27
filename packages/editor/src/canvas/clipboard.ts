import {
  collectAllTopics,
  createTopic,
  findTopicLocation,
  generateId,
  InlineAssetSchema,
  MindmapTopicSchema,
  richTextToPlainText,
  type InlineAsset,
  type MindmapSheet,
  type MindmapTopic,
} from "@mindmap/core";

export const LOOMIND_CLIPBOARD_MIME = "application/x-loomind-topics";
const CLIPBOARD_FORMAT = "loomind-topics-v1";
const MAX_PASTED_TEXT_NODES = 200;

export interface SerializedTopicClipboard {
  format: typeof CLIPBOARD_FORMAT;
  topics: MindmapTopic[];
  assets: Record<string, InlineAsset>;
}

export interface ClipboardBundle {
  json: string;
  text: string;
}

let internalClipboard: ClipboardBundle | null = null;

export function setInternalTopicClipboard(bundle: ClipboardBundle | null): void {
  internalClipboard = bundle;
}

export function getInternalTopicClipboard(): ClipboardBundle | null {
  return internalClipboard;
}

function collectReferencedAssetIds(topic: MindmapTopic, out: Set<string>): void {
  if (topic.image?.resourceId) out.add(topic.image.resourceId);
  for (const child of topic.children) collectReferencedAssetIds(child, out);
}

function isTopicAncestor(ancestor: MindmapTopic, targetId: string): boolean {
  for (const child of ancestor.children) {
    if (child.id === targetId || isTopicAncestor(child, targetId)) return true;
  }
  return false;
}

function topicsToMarkdownLines(topics: MindmapTopic[]): string {
  const lines: string[] = [];
  const walk = (topic: MindmapTopic, depth: number) => {
    const title = richTextToPlainText(topic.title).replace(/\n+/g, " ").trim();
    const taskPrefix =
      topic.task?.status === "done"
        ? "[x] "
        : topic.task?.status === "todo"
          ? "[ ] "
          : "";
    const indent = "  ".repeat(depth);
    lines.push(depth === 0 && topics.length === 1 && topic.children.length === 0 && !taskPrefix
      ? title
      : `${indent}- ${taskPrefix}${title}`);
    if (topic.note?.text) {
      const noteIndent = "  ".repeat(depth + 1);
      for (const noteLine of topic.note.text.split("\n")) {
        lines.push(`${noteIndent}> ${noteLine}`);
      }
    }
    for (const child of topic.children) walk(child, depth + 1);
  };
  for (const t of topics) walk(t, 0);
  return lines.join("\n");
}

/**
 * Serializes selected topics (deduplicating descendants whose ancestor is also selected)
 * along with any inline image assets they reference.
 */
export function serializeTopicsForClipboard(
  sheet: MindmapSheet,
  topicIds: string[],
  assets: Record<string, InlineAsset>,
): ClipboardBundle | null {
  const resolved: MindmapTopic[] = [];
  const seen = new Set<string>();
  for (const id of topicIds) {
    if (seen.has(id)) continue;
    const loc = findTopicLocation(sheet, id);
    if (!loc) continue;
    seen.add(id);
    resolved.push(loc.topic);
  }
  if (resolved.length === 0) return null;

  // Exclude any topic that is a descendant of another selected topic
  const roots = resolved.filter(
    (candidate) => !resolved.some((other) => other.id !== candidate.id && isTopicAncestor(other, candidate.id)),
  );

  const assetIds = new Set<string>();
  for (const t of roots) collectReferencedAssetIds(t, assetIds);
  const subsetAssets: Record<string, InlineAsset> = {};
  for (const id of assetIds) {
    if (assets[id]) subsetAssets[id] = assets[id];
  }

  const payload: SerializedTopicClipboard = {
    format: CLIPBOARD_FORMAT,
    topics: roots,
    assets: subsetAssets,
  };

  return {
    json: JSON.stringify(payload),
    text: topicsToMarkdownLines(roots),
  };
}

/**
 * Deep-clones a topic subtree with fresh unique IDs, avoiding both `deletedIds`
 * and `takenIds`, and stripping canvas-specific floating/manual positioning.
 */
export function cloneTopicWithFreshIds(
  topic: MindmapTopic,
  deletedIds: ReadonlySet<string>,
  takenIds: Set<string>,
): MindmapTopic {
  const nextId = (prefix: string) => {
    let id = generateId(prefix, deletedIds);
    while (takenIds.has(id)) {
      id = generateId(prefix, deletedIds);
    }
    takenIds.add(id);
    return id;
  };

  const cloneRecursive = (src: MindmapTopic): MindmapTopic => {
    const cloned: MindmapTopic = {
      ...structuredClone(src),
      id: nextId("t"),
      children: src.children.map(cloneRecursive),
    };
    delete cloned.floatingPos;
    delete cloned.manualOffset;
    if (cloned.callout) {
      cloned.callout = { ...cloned.callout, id: nextId("co") };
    }
    return cloned;
  };

  return cloneRecursive(topic);
}

/**
 * Parses multi-line plain text or Markdown (headings, bullet/numbered lists,
 * checkboxes, indentation, blockquotes as notes) into MindmapTopic subtrees.
 */
export function parsePastedTextToTopics(
  rawText: string,
  deletedIds: ReadonlySet<string>,
  takenIds: Set<string>,
): MindmapTopic[] {
  const rawLines = rawText.split(/\r?\n/);
  const roots: MindmapTopic[] = [];
  const stack: Array<{ level: number; topic: MindmapTopic }> = [];
  let lastTopic: MindmapTopic | null = null;
  let activeHeadingLevel = 0;
  let count = 0;

  const nextId = () => {
    let id = generateId("t", deletedIds);
    while (takenIds.has(id)) {
      id = generateId("t", deletedIds);
    }
    takenIds.add(id);
    return id;
  };

  // Detect base indentation for plain indented text so uniform leading spaces don't shift levels
  const nonEmptyIndents: number[] = [];
  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    const expanded = raw.replace(/\t/g, "  ");
    const indent = /^\s*/.exec(expanded)?.[0].length ?? 0;
    nonEmptyIndents.push(indent);
  }
  const minIndent = nonEmptyIndents.length > 0 ? Math.min(...nonEmptyIndents) : 0;

  for (const rawLine of rawLines) {
    if (count >= MAX_PASTED_TEXT_NODES) break;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Blockquote attaches as markdown note to the previous topic
    if (trimmed.startsWith("> ") && lastTopic) {
      const noteLine = trimmed.slice(2);
      lastTopic.note = {
        format: "markdown",
        text: lastTopic.note ? `${lastTopic.note.text}\n${noteLine}` : noteLine,
      };
      continue;
    }

    const expanded = rawLine.replace(/\t/g, "  ");
    const headingMatch = /^(\s*)(#{1,6})\s+(.+)$/.exec(expanded);
    const listMatch = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(expanded);

    let level = 0;
    let text = trimmed;
    let task: MindmapTopic["task"] | undefined;

    if (headingMatch) {
      level = headingMatch[2].length - 1;
      activeHeadingLevel = level + 1;
      text = headingMatch[3].trim();
    } else if (listMatch) {
      const relIndent = Math.max(0, listMatch[1].length - minIndent);
      level = activeHeadingLevel + Math.floor(relIndent / 2);
      text = listMatch[2].trim();
      const taskMatch = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      if (taskMatch) {
        task = { status: taskMatch[1].toLowerCase() === "x" ? "done" : "todo" };
        text = taskMatch[2].trim();
      }
    } else {
      const rawIndent = /^\s*/.exec(expanded)?.[0].length ?? 0;
      const relIndent = Math.max(0, rawIndent - minIndent);
      level = activeHeadingLevel + Math.floor(relIndent / 2);
    }

    if (!text) continue;
    const node = createTopic(nextId(), text, task ? { task } : undefined);
    count += 1;

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].topic.children.push(node);
    }
    stack.push({ level, topic: node });
    lastTopic = node;
  }

  return roots;
}

function parseLoomindJson(
  rawJson: string,
  deletedIds: ReadonlySet<string>,
  takenIds: Set<string>,
): { topics: MindmapTopic[]; assets: Record<string, InlineAsset> } | null {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || typeof parsed !== "object" || (parsed as { format?: unknown }).format !== CLIPBOARD_FORMAT) {
      return null;
    }
    const rawTopics = (parsed as { topics?: unknown }).topics;
    if (!Array.isArray(rawTopics) || rawTopics.length === 0) return null;

    const validTopics: MindmapTopic[] = [];
    for (const item of rawTopics) {
      const res = MindmapTopicSchema.safeParse(item);
      if (!res.success) return null;
      validTopics.push(cloneTopicWithFreshIds(res.data, deletedIds, takenIds));
    }

    const validAssets: Record<string, InlineAsset> = {};
    const rawAssets = (parsed as { assets?: unknown }).assets;
    if (rawAssets && typeof rawAssets === "object") {
      for (const [k, v] of Object.entries(rawAssets as Record<string, unknown>)) {
        const res = InlineAssetSchema.safeParse(v);
        if (res.success) validAssets[k] = res.data;
      }
    }

    return { topics: validTopics, assets: validAssets };
  } catch {
    return null;
  }
}

export function buildTakenTopicIds(sheet: MindmapSheet): Set<string> {
  const taken = new Set<string>();
  for (const id of collectAllTopics(sheet).keys()) taken.add(id);
  for (const t of collectAllTopics(sheet).values()) {
    if (t.callout) taken.add(t.callout.id);
  }
  return taken;
}

/**
 * Deserializes pasted clipboard content: prefers Loomind structured JSON (direct or matched
 * against internal fallback clipboard), falling back to multi-line / Markdown outline parsing.
 */
export function deserializeClipboardPayload(opts: {
  customJson?: string | null;
  plainText?: string | null;
  internalFallback?: ClipboardBundle | null;
  deletedIds: ReadonlySet<string>;
  takenIds: Set<string>;
}): { topics: MindmapTopic[]; assets: Record<string, InlineAsset> } | null {
  const { customJson, plainText, internalFallback, deletedIds, takenIds } = opts;

  if (customJson) {
    const fromCustom = parseLoomindJson(customJson, deletedIds, takenIds);
    if (fromCustom) return fromCustom;
  }

  const trimmedText = plainText?.trim() ?? "";

  if (internalFallback && (!trimmedText || trimmedText === internalFallback.text.trim())) {
    const fromInternal = parseLoomindJson(internalFallback.json, deletedIds, takenIds);
    if (fromInternal) return fromInternal;
  }

  if (trimmedText) {
    // Also support pasting raw Loomind JSON if system clipboard stripped custom MIME
    if (trimmedText.startsWith("{")) {
      const maybeJson = parseLoomindJson(trimmedText, deletedIds, takenIds);
      if (maybeJson) return maybeJson;
    }
    const topics = parsePastedTextToTopics(plainText ?? trimmedText, deletedIds, takenIds);
    if (topics.length > 0) return { topics, assets: {} };
  }

  return null;
}
