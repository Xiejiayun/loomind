import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  createDocument,
  createRichText,
  createSheet,
  createTopic,
  generateId,
  richTextToPlainText,
  type MindmapDocument,
  type MindmapSheet,
  type MindmapTopic,
} from "../model/document.js";

interface XMindTopicJson {
  id: string;
  title: string;
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
  summaries?: Array<{ id: string; range: string; topicId: string }>;
  boundaries?: Array<{ id: string; range: string; title?: string }>;
}

interface XMindSheetJson {
  id: string;
  title: string;
  rootTopic: XMindTopicJson;
  relationships?: Array<{ id: string; end1Id: string; end2Id: string; title?: string }>;
}

function topicToXMind(topic: MindmapTopic, isRoot = false, sheet?: MindmapSheet): XMindTopicJson {
  const attached = topic.children.map((c) => topicToXMind(c));
  const out: XMindTopicJson = {
    id: topic.id,
    title: richTextToPlainText(topic.title),
  };
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

  const childrenObj: NonNullable<XMindTopicJson["children"]> = {};
  if (attached.length > 0) childrenObj.attached = attached;
  if (topic.callout) {
    childrenObj.callout = [
      { id: topic.callout.id, title: richTextToPlainText(topic.callout.title) },
    ];
  }
  if (isRoot && sheet) {
    if (sheet.floatingTopics.length > 0) {
      childrenObj.detached = sheet.floatingTopics.map((f) => topicToXMind(f));
    }
    if (sheet.summaries.length > 0) {
      childrenObj.summary = sheet.summaries.map((s) => topicToXMind(s.topic));
      out.summaries = sheet.summaries.map((s) => ({
        id: s.id,
        range: `(${s.startIndex},${s.endIndex})`,
        topicId: s.topic.id,
      }));
    }
    if (sheet.boundaries.length > 0) {
      out.boundaries = sheet.boundaries
        .filter((b) => b.target.kind === "range")
        .map((b) => ({
          id: b.id,
          range:
            b.target.kind === "range"
              ? `(${b.target.startIndex},${b.target.endIndex})`
              : "(0,0)",
          title: b.title,
        }));
    }
  }
  if (Object.keys(childrenObj).length > 0) out.children = childrenObj;
  return out;
}

function xmindToTopic(raw: XMindTopicJson): MindmapTopic {
  const children = (raw.children?.attached ?? []).map(xmindToTopic);
  const calloutRaw = raw.children?.callout?.[0];
  return createTopic(raw.id || generateId("xm"), raw.title ?? "", {
    children,
    ...(raw.notes?.plain?.content ? { note: { format: "markdown", text: raw.notes.plain.content } } : {}),
    ...(raw.labels?.length ? { labels: raw.labels.slice(0, 6) } : {}),
    ...(raw.markers?.length ? { markers: raw.markers.map((m) => m.markerId) } : {}),
    ...(raw.position ? { floatingPos: raw.position } : {}),
    ...(calloutRaw ? { callout: { id: calloutRaw.id || generateId("co"), title: createRichText(calloutRaw.title ?? "") } } : {}),
  });
}

export function exportToXMind(doc: MindmapDocument): Uint8Array {
  const contentJson: XMindSheetJson[] = doc.sheets.map((sheet) => ({
    id: sheet.id,
    title: sheet.title,
    rootTopic: topicToXMind(sheet.rootTopic, true, sheet),
    relationships: sheet.relationships.map((r) => ({
      id: r.id,
      end1Id: r.fromId,
      end2Id: r.toId,
      title: r.title,
    })),
  }));

  const manifest = {
    "file-entries": {
      "content.json": {},
      "metadata.json": {},
    },
  };

  return zipSync({
    "content.json": strToU8(JSON.stringify(contentJson, null, 2)),
    "metadata.json": strToU8(JSON.stringify({ creator: { name: "Mindmap Studio", version: "2.0" } })),
    "manifest.json": strToU8(JSON.stringify(manifest)),
  });
}

export function importFromXMind(zipBytes: Uint8Array): MindmapDocument {
  const entries = unzipSync(zipBytes);
  const contentEntry = entries["content.json"];
  if (!contentEntry) {
    throw new Error("Invalid .xmind archive: missing content.json");
  }

  const rawSheets = JSON.parse(strFromU8(contentEntry)) as XMindSheetJson[];
  const sheets: MindmapSheet[] = rawSheets.map((rs, idx) => {
    const rootTopic = xmindToTopic(rs.rootTopic);
    const floatingTopics = (rs.rootTopic.children?.detached ?? []).map(xmindToTopic);
    const summaryTopics = new Map(
      (rs.rootTopic.children?.summary ?? []).map((st) => [st.id, xmindToTopic(st)]),
    );

    const summaries = (rs.rootTopic.summaries ?? [])
      .map((s) => {
        const m = /\((\d+),(\d+)\)/.exec(s.range);
        const topic = summaryTopics.get(s.topicId);
        if (!m || !topic) return null;
        return {
          id: s.id || generateId("sum"),
          parentId: rootTopic.id,
          startIndex: Number(m[1]),
          endIndex: Number(m[2]),
          brace: "curly" as const,
          topic,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const relationships = (rs.relationships ?? []).map((r) => ({
      id: r.id || generateId("rel"),
      fromId: r.end1Id,
      toId: r.end2Id,
      title: r.title,
    }));

    return createSheet(rs.id || `sheet-${idx + 1}`, rs.title || `画布 ${idx + 1}`, rootTopic, {
      floatingTopics,
      summaries,
      relationships,
    });
  });

  return createDocument(sheets);
}
