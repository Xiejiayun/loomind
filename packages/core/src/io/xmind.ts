/**
 * XMind (.xmind) import/export codec.
 *
 * Compatibility boundary:
 * 1. Native XMind fields first (`structureClass`, per-parent `summaries`/`children.summary`,
 *    `notes`, `labels`, `markers`, `children.detached`, `children.callout`, `relationships`, multi-sheet).
 * 2. Versioned `loomind:v1` extension namespace for Loomind-specific properties that XMind native JSON
 *    cannot losslessly represent (e.g., `spacing`, `task`, summary `brace`, `subtree` boundaries).
 * 3. Fidelity is guaranteed for Loomind self export <-> import on declared fields only; lossless
 *    preservation after editing in third-party XMind clients is not claimed, and native XMind desktop
 *    client compatibility is unverified.
 * 4. Every imported document passes `MindmapDocumentSchema.safeParse` and `validateDocumentInvariants`.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createDocument,
  createRichText,
  createSheet,
  createTopic,
  generateId,
  richTextToPlainText,
  type MindmapBoundary,
  type MindmapDocument,
  type MindmapRelationship,
  type MindmapSheet,
  type MindmapStructure,
  type MindmapSummary,
  type MindmapTopic,
} from "../model/document.js";
import { validateDocumentInvariants } from "../model/invariants.js";
import { MindmapDocumentSchema, MindmapThemeConfigSchema } from "../model/schema.js";
import { imageReader, imageWriter, readTitle, titleRuns, type XMindImage } from "./xmind-content.js";

const LOOMIND_EXT_PROVIDER = "loomind:v1";
const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

interface XMindExtension {
  provider: string;
  content: Record<string, unknown>;
}

interface XMindTopicJson {
  class?: string;
  id: string;
  title: string;
  attributedTitle?: ReturnType<typeof titleRuns>;
  image?: XMindImage;
  structureClass?: string;
  notes?: { plain?: { content?: string } };
  labels?: string[];
  markers?: Array<{ markerId: string }>;
  children?: {
    attached?: XMindTopicJson[];
    detached?: XMindTopicJson[];
    summary?: XMindTopicJson[];
    callout?: XMindTopicJson[];
  };
  position?: { x: number; y: number };
  summaries?: Array<{ id: string; range: string; topicId: string; brace?: MindmapSummary["brace"] }>;
  boundaries?: Array<{ id: string; range: string; title?: string }>;
  extensions?: XMindExtension[];
}

interface XMindSheetJson {
  id: string;
  title: string;
  rootTopic: XMindTopicJson;
  relationships?: Array<{ id: string; end1Id: string; end2Id: string; title?: string }>;
  extensions?: XMindExtension[];
}

function toStructureClass(structure: MindmapStructure, direction: MindmapSheet["direction"]): string {
  switch (structure) {
    case "mindmap":
      return "org.xmind.ui.map.unbalanced";
    case "logic":
      return direction === "rightLeft" ? "org.xmind.ui.logic.left" : "org.xmind.ui.logic.right";
    case "org":
      return direction === "bottomUp" ? "org.xmind.ui.org-chart.up" : "org.xmind.ui.org-chart.down";
    case "brace":
      return direction === "rightLeft" ? "org.xmind.ui.brace.left" : "org.xmind.ui.brace.right";
    case "indented":
      return "org.xmind.ui.tree.right";
    case "timeline":
      return "org.xmind.ui.timeline.horizontal";
    case "fishbone":
      return "org.xmind.ui.fishbone.leftHeaded";
    case "treeTable":
      return "org.xmind.ui.treetable.toptitle";
    case "matrix":
      return "org.xmind.ui.matrix.row";
  }
}

function fromStructureClass(
  structureClass?: string,
): { structure?: MindmapStructure; direction?: MindmapSheet["direction"] } {
  if (!structureClass) return {};
  if (structureClass.includes("logic.left")) return { structure: "logic", direction: "rightLeft" };
  if (structureClass.includes("logic")) return { structure: "logic", direction: "leftRight" };
  if (structureClass.includes("org-chart.up")) return { structure: "org", direction: "bottomUp" };
  if (structureClass.includes("org-chart")) return { structure: "org", direction: "topDown" };
  if (structureClass.includes("brace.left")) return { structure: "brace", direction: "rightLeft" };
  if (structureClass.includes("brace")) return { structure: "brace", direction: "leftRight" };
  if (structureClass.includes("treetable")) return { structure: "treeTable", direction: "topDown" };
  if (structureClass.includes("tree")) return { structure: "indented", direction: "leftRight" };
  if (structureClass.includes("timeline")) return { structure: "timeline", direction: "leftRight" };
  if (structureClass.includes("fishbone")) return { structure: "fishbone", direction: "leftRight" };
  if (structureClass.includes("matrix")) return { structure: "matrix", direction: "topDown" };
  if (structureClass.includes("map")) return { structure: "mindmap", direction: "bilateral" };
  return {};
}

function readLoomindExt(extensions?: XMindExtension[]): Record<string, unknown> | null {
  if (!Array.isArray(extensions)) return null;
  const found = extensions.find((e) => e && e.provider === LOOMIND_EXT_PROVIDER && typeof e.content === "object" && e.content !== null);
  return found ? found.content : null;
}

function topicToXMind(
  topic: MindmapTopic,
  summariesByParent: Map<string, MindmapSummary[]>,
  rangeBoundariesByParent: Map<string, MindmapBoundary[]>,
  images: ReturnType<typeof imageWriter>,
  isRoot = false,
  sheet?: MindmapSheet,
): XMindTopicJson {
  const attached = topic.children.map((c) =>
    topicToXMind(c, summariesByParent, rangeBoundariesByParent, images),
  );
  const out: XMindTopicJson = {
    class: "topic",
    id: topic.id,
    title: richTextToPlainText(topic.title),
  };

  if (isRoot && sheet) {
    out.structureClass = toStructureClass(sheet.structure, sheet.direction);
  }
  if (topic.note?.text) {
    out.notes = { plain: { content: topic.note.text } };
  }
  if (topic.labels && topic.labels.length > 0) {
    out.labels = topic.labels;
  }
  if (topic.markers && topic.markers.length > 0) {
    out.markers = topic.markers.map((markerId) => ({ markerId }));
  }
  if (topic.floatingPos) {
    out.position = { ...topic.floatingPos };
  }

  const extContent: Record<string, unknown> = {};
  const runs = titleRuns(topic.title);
  if (runs) {
    out.attributedTitle = runs;
    extContent.richTitle = topic.title;
  }
  if (topic.image) {
    const image = images.write(topic.image);
    out.image = image.native;
    extContent.image = image.meta;
  }
  if (topic.task) extContent.task = topic.task;
  if (topic.subtitle) extContent.subtitle = topic.subtitle;
  if (topic.collapsed) extContent.collapsed = true;
  if (Object.keys(extContent).length > 0) {
    out.extensions = [{ provider: LOOMIND_EXT_PROVIDER, content: extContent }];
  }
  if (topic.equation) (out.extensions ??= []).push({ provider: "org.xmind.ui.mathJax", content: { content: topic.equation.latex } });

  const childrenObj: NonNullable<XMindTopicJson["children"]> = {};
  if (attached.length > 0) childrenObj.attached = attached;
  if (topic.callout) {
    childrenObj.callout = [
      { id: topic.callout.id, title: richTextToPlainText(topic.callout.title) },
    ];
  }
  if (isRoot && sheet && sheet.floatingTopics.length > 0) {
    childrenObj.detached = sheet.floatingTopics.map((f) =>
      topicToXMind(f, summariesByParent, rangeBoundariesByParent, images),
    );
  }

  // Attach summaries onto their ACTUAL parentId topic (root, nested branch, floating, or summary topic)
  const ownSummaries = summariesByParent.get(topic.id) ?? [];
  if (ownSummaries.length > 0) {
    childrenObj.summary = ownSummaries.map((s) =>
      topicToXMind(s.topic, summariesByParent, rangeBoundariesByParent, images),
    );
    out.summaries = ownSummaries.map((s) => ({
      id: s.id,
      range: `(${s.startIndex},${s.endIndex})`,
      topicId: s.topic.id,
      brace: s.brace,
    }));
  }

  const ownBoundaries = rangeBoundariesByParent.get(topic.id) ?? [];
  if (ownBoundaries.length > 0) {
    out.boundaries = ownBoundaries.map((b) => ({
      id: b.id,
      range:
        b.target.kind === "range"
          ? `(${b.target.startIndex},${b.target.endIndex})`
          : "(0,0)",
      title: b.title,
    }));
  }

  if (Object.keys(childrenObj).length > 0) out.children = childrenObj;
  return out;
}

class IdAllocator {
  private used = new Set<string>();
  private map = new Map<string, string>();

  allocate(rawId: unknown, prefix: string): string {
    const rawStr = typeof rawId === "string" ? rawId.trim() : "";
    if (rawStr && ID_REGEX.test(rawStr) && !this.used.has(rawStr)) {
      this.used.add(rawStr);
      this.map.set(rawStr, rawStr);
      return rawStr;
    }
    const sanitized = rawStr
      .replace(/[^A-Za-z0-9._:-]/g, "-")
      .replace(/^[^A-Za-z0-9]+/, "")
      .slice(0, 56);
    let candidate = sanitized && ID_REGEX.test(sanitized) ? sanitized : generateId(prefix, this.used);
    while (this.used.has(candidate)) {
      candidate = generateId(prefix, this.used);
    }
    this.used.add(candidate);
    if (rawStr && !this.map.has(rawStr)) {
      this.map.set(rawStr, candidate);
    }
    return candidate;
  }

  resolve(rawId: unknown): string | null {
    if (typeof rawId !== "string") return null;
    const trimmed = rawId.trim();
    return this.map.get(trimmed) ?? (this.used.has(trimmed) ? trimmed : null);
  }
}

function parseTaskFromRaw(raw: XMindTopicJson): { status: "todo" | "done" } | undefined {
  const ext = readLoomindExt(raw.extensions);
  if (ext?.task && typeof ext.task === "object") {
    const status = (ext.task as Record<string, unknown>).status;
    if (status === "todo" || status === "done") return { status };
  }
  const markers = raw.markers ?? [];
  for (const m of markers) {
    if (m.markerId === "task-done") return { status: "done" };
    if (m.markerId === "task-start" || m.markerId === "task-oct" || m.markerId === "task-quarter" || m.markerId === "task-half") {
      return { status: "todo" };
    }
  }
  return undefined;
}

function xmindToTopic(
  raw: XMindTopicJson,
  ids: IdAllocator,
  collectedSummaries: MindmapSummary[],
  collectedBoundaries: MindmapBoundary[],
  images: ReturnType<typeof imageReader>,
): MindmapTopic {
  const topicId = ids.allocate(raw.id, "xm");
  const children = (raw.children?.attached ?? []).map((c) =>
    xmindToTopic(c, ids, collectedSummaries, collectedBoundaries, images),
  );
  const calloutRaw = raw.children?.callout?.[0];
  const ext = readLoomindExt(raw.extensions);
  const task = parseTaskFromRaw(raw);

  const sanitizedLabels = Array.isArray(raw.labels)
    ? raw.labels
        .filter((l): l is string => typeof l === "string" && l.length > 0)
        .slice(0, 6)
        .map((l) => l.slice(0, 24))
    : undefined;

  const markers = Array.isArray(raw.markers)
    ? raw.markers.map((m) => m?.markerId).filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;

  const latex = Array.isArray(raw.extensions) ? raw.extensions.find((entry) => entry?.provider === "org.xmind.ui.mathJax")?.content?.content : undefined;
  const title = readTitle(typeof raw.title === "string" ? raw.title : "", raw.attributedTitle, ext?.richTitle);
  const topic = createTopic(topicId, title, {
    children,
    ...(typeof latex === "string" ? { equation: { latex } } : {}),
    ...(raw.image && !(raw.image.isMathJaxImage && typeof latex === "string") ? { image: images.read(raw.image, ext?.image) } : {}),
    ...(raw.notes?.plain?.content ? { note: { format: "markdown", text: raw.notes.plain.content } } : {}),
    ...(sanitizedLabels && sanitizedLabels.length > 0 ? { labels: sanitizedLabels } : {}),
    ...(markers && markers.length > 0 ? { markers } : {}),
    ...(raw.position && typeof raw.position.x === "number" && typeof raw.position.y === "number"
      ? { floatingPos: { x: raw.position.x, y: raw.position.y } }
      : {}),
    ...(calloutRaw
      ? {
          callout: {
            id: ids.allocate(calloutRaw.id, "co"),
            title: createRichText(typeof calloutRaw.title === "string" ? calloutRaw.title : ""),
          },
        }
      : {}),
    ...(task ? { task } : {}),
    ...(typeof ext?.subtitle === "string" ? { subtitle: ext.subtitle } : {}),
    ...(ext?.collapsed === true ? { collapsed: true } : {}),
  });

  // Restore summaries attached to THIS topic (preserving actual parentId, including nested branches!)
  if (Array.isArray(raw.summaries) && raw.summaries.length > 0 && children.length > 0) {
    const summaryTopicsByRawId = new Map<string, MindmapTopic>();
    for (const st of raw.children?.summary ?? []) {
      const converted = xmindToTopic(st, ids, collectedSummaries, collectedBoundaries, images);
      if (typeof st.id === "string" && st.id.trim()) {
        summaryTopicsByRawId.set(st.id.trim(), converted);
      }
      summaryTopicsByRawId.set(converted.id, converted);
    }

    for (const s of raw.summaries) {
      const m = /\((\d+),(\d+)\)/.exec(s.range ?? "");
      const summaryTopic = s.topicId ? summaryTopicsByRawId.get(s.topicId.trim()) : undefined;
      if (!m || !summaryTopic) continue;
      const startIndex = Number(m[1]);
      const endIndex = Number(m[2]);
      if (startIndex < 0 || endIndex < startIndex || endIndex >= children.length) continue;
      const brace: MindmapSummary["brace"] =
        s.brace === "curly" || s.brace === "bracket" || s.brace === "angled" || s.brace === "round"
          ? s.brace
          : "curly";
      collectedSummaries.push({
        id: ids.allocate(s.id, "sum"),
        parentId: topic.id,
        startIndex,
        endIndex,
        brace,
        topic: summaryTopic,
      });
    }
  }

  // Restore range boundaries attached to THIS topic
  if (Array.isArray(raw.boundaries) && raw.boundaries.length > 0 && children.length > 0) {
    for (const b of raw.boundaries) {
      const m = /\((\d+),(\d+)\)/.exec(b.range ?? "");
      if (!m) continue;
      const startIndex = Number(m[1]);
      const endIndex = Number(m[2]);
      if (startIndex < 0 || endIndex < startIndex || endIndex >= children.length) continue;
      collectedBoundaries.push({
        id: ids.allocate(b.id, "bnd"),
        target: { kind: "range", parentId: topic.id, startIndex, endIndex },
        shape: "rounded",
        ...(typeof b.title === "string" ? { title: b.title } : {}),
      });
    }
  }

  return topic;
}

export function exportToXMind(doc: MindmapDocument): Uint8Array {
  const images = imageWriter(doc.assets);
  const contentJson: XMindSheetJson[] = doc.sheets.map((sheet) => {
    const summariesByParent = new Map<string, MindmapSummary[]>();
    for (const s of sheet.summaries) {
      const list = summariesByParent.get(s.parentId) ?? [];
      list.push(s);
      summariesByParent.set(s.parentId, list);
    }

    const rangeBoundariesByParent = new Map<string, MindmapBoundary[]>();
    const subtreeBoundaries: MindmapBoundary[] = [];
    for (const b of sheet.boundaries) {
      if (b.target.kind === "range") {
        const list = rangeBoundariesByParent.get(b.target.parentId) ?? [];
        list.push(b);
        rangeBoundariesByParent.set(b.target.parentId, list);
      } else {
        subtreeBoundaries.push(b);
      }
    }

    const sheetExt: Record<string, unknown> = {
      structure: sheet.structure,
      ...(sheet.id === doc.activeSheetId ? { active: true, documentTheme: doc.theme } : {}),
      direction: sheet.direction,
      spacing: sheet.spacing,
      ...(sheet.theme ? { theme: sheet.theme } : {}),
      ...(subtreeBoundaries.length > 0 ? { subtreeBoundaries } : {}),
    };

    return {
      id: sheet.id,
      class: "sheet",
      title: sheet.title,
      rootTopic: topicToXMind(sheet.rootTopic, summariesByParent, rangeBoundariesByParent, images, true, sheet),
      relationships: sheet.relationships.map((r) => ({
        id: r.id,
        end1Id: r.fromId,
        end2Id: r.toId,
        title: r.title,
      })),
      extensions: [{ provider: LOOMIND_EXT_PROVIDER, content: sheetExt }],
    };
  });

  const manifest = {
    "file-entries": {
      "content.json": {},
      "metadata.json": {},
      ...Object.fromEntries(Object.keys(images.resources).map((path) => [path, {}])),
    },
  };

  return zipSync({
    ...images.resources,
    "content.json": strToU8(JSON.stringify(contentJson, null, 2)),
    "metadata.json": strToU8(JSON.stringify({ creator: { name: "Loomind", version: "2.0" }, dataStructureVersion: "2" })),
    "manifest.json": strToU8(JSON.stringify(manifest)),
  });
}

function collectSheetTopicIds(sheet: { rootTopic: MindmapTopic; floatingTopics: MindmapTopic[]; summaries: MindmapSummary[] }): Set<string> {
  const out = new Set<string>();
  const walk = (t: MindmapTopic) => {
    out.add(t.id);
    for (const c of t.children) walk(c);
  };
  walk(sheet.rootTopic);
  for (const f of sheet.floatingTopics) walk(f);
  for (const s of sheet.summaries) walk(s.topic);
  return out;
}

export function importFromXMind(zipBytes: Uint8Array): MindmapDocument {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new Error("Invalid .xmind archive: failed to unzip");
  }
  const contentEntry = entries["content.json"];
  if (!contentEntry) {
    throw new Error("Invalid .xmind archive: missing content.json");
  }

  let rawSheets: unknown;
  try {
    rawSheets = JSON.parse(strFromU8(contentEntry));
  } catch {
    throw new Error("Invalid .xmind archive: malformed content.json");
  }
  if (!Array.isArray(rawSheets) || rawSheets.length === 0) {
    throw new Error("Invalid .xmind archive: content.json must contain at least one sheet");
  }

  const ids = new IdAllocator();
  const images = imageReader(entries);
  let activeSheetId: string | undefined;
  let documentTheme: MindmapDocument["theme"] | undefined;
  const sheets: MindmapSheet[] = (rawSheets as XMindSheetJson[]).map((rs, idx) => {
    if (!rs || typeof rs !== "object" || !rs.rootTopic || typeof rs.rootTopic !== "object") {
      throw new Error(`Invalid .xmind sheet at index ${idx}: missing rootTopic`);
    }

    const sheetId = ids.allocate(rs.id, `sheet-${idx + 1}`);
    const summaries: MindmapSummary[] = [];
    const boundaries: MindmapBoundary[] = [];

    const rootTopic = xmindToTopic(rs.rootTopic, ids, summaries, boundaries, images);
    const floatingTopics = (rs.rootTopic.children?.detached ?? []).map((f) =>
      xmindToTopic(f, ids, summaries, boundaries, images),
    );

    const sheetTopicIds = collectSheetTopicIds({ rootTopic, floatingTopics, summaries });

    // Restore subtree boundaries from loomind:v1 extension if valid
    const sheetExt = readLoomindExt(rs.extensions);
    if (sheetExt?.active === true && !activeSheetId) {
      activeSheetId = sheetId;
      const theme = MindmapThemeConfigSchema.safeParse(sheetExt.documentTheme);
      if (theme.success) documentTheme = theme.data;
    }
    const sheetTheme = MindmapThemeConfigSchema.partial().safeParse(sheetExt?.theme);
    if (Array.isArray(sheetExt?.subtreeBoundaries)) {
      for (const rawB of sheetExt.subtreeBoundaries as MindmapBoundary[]) {
        if (rawB?.target?.kind === "subtree") {
          const resolvedTarget = ids.resolve(rawB.target.topicId);
          if (resolvedTarget && sheetTopicIds.has(resolvedTarget)) {
            boundaries.push({
              id: ids.allocate(rawB.id, "bnd"),
              target: { kind: "subtree", topicId: resolvedTarget },
              shape: rawB.shape ?? "rounded",
              ...(rawB.title ? { title: rawB.title } : {}),
            });
          }
        }
      }
    }

    const relationships: MindmapRelationship[] = [];
    for (const r of rs.relationships ?? []) {
      const fromId = ids.resolve(r.end1Id);
      const toId = ids.resolve(r.end2Id);
      if (!fromId || !toId || !sheetTopicIds.has(fromId) || !sheetTopicIds.has(toId)) continue;
      relationships.push({
        id: ids.allocate(r.id, "rel"),
        fromId,
        toId,
        ...(typeof r.title === "string" ? { title: r.title } : {}),
      });
    }

    const fromNativeClass = fromStructureClass(rs.rootTopic.structureClass);
    const validStructures = new Set<MindmapStructure>([
      "mindmap", "logic", "org", "brace", "indented", "timeline", "fishbone", "treeTable", "matrix",
    ]);
    const validDirections = new Set<MindmapSheet["direction"]>([
      "bilateral", "leftRight", "rightLeft", "topDown", "bottomUp",
    ]);
    const validSpacings = new Set<MindmapSheet["spacing"]>(["compact", "balanced", "spacious"]);

    const structure: MindmapStructure =
      typeof sheetExt?.structure === "string" && validStructures.has(sheetExt.structure as MindmapStructure)
        ? (sheetExt.structure as MindmapStructure)
        : fromNativeClass.structure ?? "mindmap";
    const direction: MindmapSheet["direction"] =
      typeof sheetExt?.direction === "string" && validDirections.has(sheetExt.direction as MindmapSheet["direction"])
        ? (sheetExt.direction as MindmapSheet["direction"])
        : fromNativeClass.direction ?? "bilateral";
    const spacing: MindmapSheet["spacing"] =
      typeof sheetExt?.spacing === "string" && validSpacings.has(sheetExt.spacing as MindmapSheet["spacing"])
        ? (sheetExt.spacing as MindmapSheet["spacing"])
        : "balanced";

    return createSheet(sheetId, typeof rs.title === "string" && rs.title ? rs.title : `画布 ${idx + 1}`, rootTopic, {
      structure,
      direction,
      spacing,
      ...(sheetTheme.success ? { theme: sheetTheme.data } : {}),
      floatingTopics,
      summaries,
      boundaries,
      relationships,
    });
  });

  const doc = createDocument(sheets, documentTheme);
  if (activeSheetId) doc.activeSheetId = activeSheetId;
  doc.assets = images.assets;
  const parsed = MindmapDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(`Imported .xmind failed schema validation: ${parsed.error.message}`);
  }
  const violations = validateDocumentInvariants(parsed.data);
  if (violations.length > 0) {
    throw new Error(`Imported .xmind failed invariant validation: ${violations.map((v) => v.message).join("; ")}`);
  }
  return parsed.data;
}
