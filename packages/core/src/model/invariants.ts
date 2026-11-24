import type { MindmapDocument, MindmapSheet, MindmapTopic } from "./document.js";

export interface InvariantViolation {
  code:
    | "DUPLICATE_ID"
    | "DELETED_ID_REUSED"
    | "INVALID_ACTIVE_SHEET"
    | "INVALID_SUMMARY_RANGE"
    | "INVALID_HEX_COLOR"
    | "DANGLING_REFERENCE";
  message: string;
}

const HEX8 = /^#[0-9A-F]{8}$/;

export function collectAllTopics(sheet: MindmapSheet): Map<string, MindmapTopic> {
  const map = new Map<string, MindmapTopic>();
  const visit = (t: MindmapTopic) => {
    map.set(t.id, t);
    for (const c of t.children) visit(c);
  };
  visit(sheet.rootTopic);
  for (const f of sheet.floatingTopics) visit(f);
  for (const s of sheet.summaries) visit(s.topic);
  return map;
}

export function validateDocumentInvariants(doc: MindmapDocument): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const deleted = new Set(doc.deletedIds);
  const seenIds = new Set<string>();

  const registerId = (id: string, kind: string) => {
    if (deleted.has(id)) {
      violations.push({
        code: "DELETED_ID_REUSED",
        message: `${kind} id "${id}" is in deletedIds`,
      });
    }
    if (seenIds.has(id)) {
      violations.push({
        code: "DUPLICATE_ID",
        message: `Duplicate ${kind} id "${id}"`,
      });
    }
    seenIds.add(id);
  };

  const checkColor = (color: string | undefined, ctx: string) => {
    if (color !== undefined && !HEX8.test(color)) {
      violations.push({
        code: "INVALID_HEX_COLOR",
        message: `${ctx} has non-normalized hex color "${color}"`,
      });
    }
  };

  if (!doc.sheets.some((s) => s.id === doc.activeSheetId)) {
    violations.push({
      code: "INVALID_ACTIVE_SHEET",
      message: `activeSheetId "${doc.activeSheetId}" not found in sheets`,
    });
  }

  for (const sheet of doc.sheets) {
    registerId(sheet.id, "sheet");
    const topicMap = new Map<string, MindmapTopic>();

    const walkTopic = (topic: MindmapTopic) => {
      registerId(topic.id, "topic");
      topicMap.set(topic.id, topic);
      if (topic.style) {
        checkColor(topic.style.fillColor, `topic(${topic.id}).style.fillColor`);
        checkColor(topic.style.strokeColor, `topic(${topic.id}).style.strokeColor`);
        checkColor(topic.style.textColor, `topic(${topic.id}).style.textColor`);
      }
      if (topic.callout) {
        registerId(topic.callout.id, "callout");
      }
      for (const child of topic.children) walkTopic(child);
    };

    walkTopic(sheet.rootTopic);
    for (const f of sheet.floatingTopics) walkTopic(f);
    for (const s of sheet.summaries) {
      registerId(s.id, "summary");
      walkTopic(s.topic);
    }

    for (const s of sheet.summaries) {
      const parent = topicMap.get(s.parentId);
      if (
        !parent ||
        s.startIndex < 0 ||
        s.endIndex < s.startIndex ||
        s.endIndex >= parent.children.length
      ) {
        violations.push({
          code: "INVALID_SUMMARY_RANGE",
          message: `Summary "${s.id}" has invalid range [${s.startIndex}, ${s.endIndex}] for parent "${s.parentId}"`,
        });
      }
    }

    for (const b of sheet.boundaries) {
      registerId(b.id, "boundary");
      if (b.style) {
        checkColor(b.style.fillColor, `boundary(${b.id}).style.fillColor`);
        checkColor(b.style.strokeColor, `boundary(${b.id}).style.strokeColor`);
        checkColor(b.style.badgeColor, `boundary(${b.id}).style.badgeColor`);
      }
    }

    for (const r of sheet.relationships) {
      registerId(r.id, "relationship");
      if (!topicMap.has(r.fromId) || !topicMap.has(r.toId)) {
        violations.push({
          code: "DANGLING_REFERENCE",
          message: `Relationship "${r.id}" references missing topic (${r.fromId} -> ${r.toId})`,
        });
      }
      if (r.style) checkColor(r.style.strokeColor, `relationship(${r.id}).style.strokeColor`);
    }
  }

  return violations;
}
